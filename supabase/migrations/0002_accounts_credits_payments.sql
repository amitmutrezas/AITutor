-- 0002_accounts_credits_payments (M5): profiles trigger, credit balances with atomic reserve/release/reset,
-- durable payment state with event dedupe, saved-code and account functions.
-- 0001 is not rewritten. Every function below is SECURITY DEFINER and executable by the service role only;
-- the app server calls them through lib/credits, lib/payments and lib/saved-code (POLICY 3.1, 3.3).
-- Credits are integers. The model never decides a balance (POLICY 5.2).

-- ---------------------------------------------------------------------------
-- Exercises are content files for now (content/exercises), not rows, so ids in hint_log and
-- saved_code cannot be foreign keys into public.exercises. The API validates ids (Zod).
-- ---------------------------------------------------------------------------
alter table public.hint_log drop constraint if exists hint_log_exercise_id_fkey;
alter table public.saved_code drop constraint if exists saved_code_exercise_id_fkey;

-- ---------------------------------------------------------------------------
-- Profiles follow auth.users
-- ---------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, email)
  select id, coalesce(email, '') from auth.users
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Plans: rows exist for the foreign key. The monthly amount actually granted is passed in by the app
-- from lib/config (single source of truth), so these zeros are informational only.
-- ---------------------------------------------------------------------------
insert into public.plans (id, name, monthly_credits) values
  ('free', 'Free', 0), ('basic', 'Basic', 0), ('advanced', 'Advanced', 0)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Credit balances: one row per user. Row-level locking on UPDATE makes reserve atomic:
-- concurrent reservations serialise on the row and the balance >= cost check is re-evaluated.
-- credit_ledger (0001) stays the audit trail; balance never goes below zero.
-- ---------------------------------------------------------------------------
create table public.credit_balances (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table public.credit_balances enable row level security;
create policy "credit_balances: read own" on public.credit_balances for select to authenticated
  using (user_id = auth.uid());
revoke insert, update, delete on public.credit_balances from anon, authenticated;

create function public.credits_get_balance(p_user uuid) returns integer
language sql security definer set search_path = public as $$
  select coalesce((select balance from public.credit_balances where user_id = p_user), 0);
$$;

-- Takes p_cost credits if the balance covers it. Returns false and changes nothing otherwise (C2).
create function public.credits_reserve(p_user uuid, p_cost integer) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'cost must be a positive integer';
  end if;
  update public.credit_balances
     set balance = balance - p_cost, updated_at = now()
   where user_id = p_user and balance >= p_cost;
  if not found then
    return false;
  end if;
  insert into public.credit_ledger (user_id, delta, reason) values (p_user, -p_cost, 'hint_reserve');
  return true;
end $$;

-- Gives back a reservation (failed hint, fallback, free cache hit). C3: a failed hint is not charged.
create function public.credits_release(p_user uuid, p_cost integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'cost must be a positive integer';
  end if;
  insert into public.credit_balances (user_id, balance) values (p_user, p_cost)
  on conflict (user_id) do update set balance = public.credit_balances.balance + excluded.balance, updated_at = now();
  insert into public.credit_ledger (user_id, delta, reason) values (p_user, p_cost, 'hint_release');
end $$;

-- Sets the balance to p_amount (C4: renewal resets, no rollover). The ledger records the difference.
create function public.credits_reset(p_user uuid, p_amount integer, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_old integer;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be a non-negative integer';
  end if;
  insert into public.credit_balances (user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  select balance into v_old from public.credit_balances where user_id = p_user for update;
  update public.credit_balances set balance = p_amount, updated_at = now() where user_id = p_user;
  insert into public.credit_ledger (user_id, delta, reason) values (p_user, p_amount - v_old, coalesce(p_reason, 'reset'));
  return p_amount;
end $$;

-- ---------------------------------------------------------------------------
-- Hint log: hash only, never code (N3).
-- ---------------------------------------------------------------------------
create function public.hint_log_record(
  p_user uuid, p_exercise text, p_level integer, p_code_hash text,
  p_tokens_in integer, p_tokens_out integer, p_fallback boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  insert into public.hint_log (user_id, exercise_id, level, code_hash, tokens_in, tokens_out, fallback)
  values (p_user, p_exercise, p_level, p_code_hash, p_tokens_in, p_tokens_out, p_fallback)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Payments: subscription lifecycle and processed webhook events
-- ---------------------------------------------------------------------------
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
update public.subscriptions set status = 'cancelled' where status = 'canceled';
update public.subscriptions set status = 'halted' where status = 'past_due';
alter table public.subscriptions
  add constraint subscriptions_status_check check (status in ('pending', 'active', 'halted', 'cancelled'));
alter table public.subscriptions add column updated_at timestamptz not null default now();
alter table public.subscriptions add column last_event_at timestamptz;

-- At most one live (pending, active or halted) subscription per user: this is what makes
-- "subscribe" idempotent and defines the learner's current subscription for webhook checks.
create unique index subscriptions_one_live_per_user on public.subscriptions (user_id)
  where status in ('pending', 'active', 'halted');

create table public.payment_events (
  event_id text primary key, -- Razorpay X-Razorpay-Event-Id: the unique key is the idempotency claim (P2)
  kind text not null,
  processed_at timestamptz not null default now()
);
alter table public.payment_events enable row level security; -- no policies: service role only
revoke all on public.payment_events from anon, authenticated;

-- Claims a checkout attempt before Razorpay is called. Returns jsonb:
--   {outcome: 'claimed', claim_id}                     caller creates the Razorpay subscription, then attaches its id
--   {outcome: 'reuse', razorpay_subscription_id}       an unpaid checkout for the same plan exists: reuse it
--   {outcome: 'active_exists'}                         refuse: the learner already has an active subscription
--   {outcome: 'in_progress'}                           another request is creating the checkout right now
-- 'superseded_subscription_id' is set when an unpaid checkout for another plan was closed.
create function public.payments_claim_checkout(p_user uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.subscriptions%rowtype;
  v_id uuid;
  v_superseded text;
begin
  select * into v_row from public.subscriptions
   where user_id = p_user and status in ('pending', 'active', 'halted') for update;
  if found then
    if v_row.status = 'active' then
      return jsonb_build_object('outcome', 'active_exists');
    end if;
    if v_row.status = 'pending' and v_row.plan_id = p_plan then
      if v_row.razorpay_subscription_id is not null then
        return jsonb_build_object('outcome', 'reuse', 'razorpay_subscription_id', v_row.razorpay_subscription_id);
      end if;
      if v_row.created_at > now() - interval '2 minutes' then
        return jsonb_build_object('outcome', 'in_progress');
      end if;
    end if;
    -- halted, a pending checkout for another plan, or a stale claim that never reached Razorpay: close it.
    v_superseded := v_row.razorpay_subscription_id;
    update public.subscriptions set status = 'cancelled', updated_at = now() where id = v_row.id;
  end if;
  begin
    insert into public.subscriptions (user_id, plan_id, status) values (p_user, p_plan, 'pending')
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'in_progress');
  end;
  return jsonb_build_object('outcome', 'claimed', 'claim_id', v_id, 'superseded_subscription_id', v_superseded);
end $$;

create function public.payments_attach_subscription(p_claim uuid, p_razorpay_subscription_id text) returns void
language sql security definer set search_path = public as $$
  update public.subscriptions
     set razorpay_subscription_id = p_razorpay_subscription_id, updated_at = now()
   where id = p_claim and status = 'pending' and razorpay_subscription_id is null;
$$;

-- Releases a claim when Razorpay could not create the subscription.
create function public.payments_abandon_checkout(p_claim uuid) returns void
language sql security definer set search_path = public as $$
  update public.subscriptions set status = 'cancelled', updated_at = now()
   where id = p_claim and status = 'pending' and razorpay_subscription_id is null;
$$;

-- One transaction: claim the event id, check it belongs to the learner's current subscription,
-- apply lifecycle ordering, change plan/status and reset credits. Any error rolls all of it back
-- (including the event claim) so Razorpay's retry can succeed. Returns:
--   'duplicate' (event id already processed), 'ignored' (event we do not act on),
--   'unknown_subscription' (not the learner's subscription), 'stale' (cancelled already, or older than
--   the last applied event), 'applied'.
-- p_status: active | halted | cancelled. p_credits: when not null and the status is active, the balance is
-- reset to this amount (renewal, C4). p_event_at is the event's own timestamp (Razorpay created_at), or null.
create function public.payments_apply_event(
  p_event_id text, p_kind text, p_user uuid, p_plan text, p_razorpay_subscription_id text,
  p_status text, p_credits integer, p_event_at timestamptz
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_row public.subscriptions%rowtype;
begin
  insert into public.payment_events (event_id, kind) values (p_event_id, p_kind)
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;
  if p_kind = 'ignore' then
    return 'ignored';
  end if;
  if p_status not in ('active', 'halted', 'cancelled') then
    raise exception 'invalid status';
  end if;

  select * into v_row from public.subscriptions
   where razorpay_subscription_id = p_razorpay_subscription_id for update;
  if not found or v_row.user_id <> p_user then
    return 'unknown_subscription';
  end if;
  -- Cancelled is terminal, and a closed row is no longer the learner's current subscription.
  if v_row.status = 'cancelled' then
    return 'stale';
  end if;
  if p_event_at is not null and v_row.last_event_at is not null and p_event_at < v_row.last_event_at then
    return 'stale';
  end if;

  update public.subscriptions
     set status = p_status, plan_id = p_plan, updated_at = now(),
         last_event_at = coalesce(p_event_at, last_event_at)
   where id = v_row.id;
  if p_status = 'active' and p_credits is not null then
    perform public.credits_reset(p_user, p_credits, 'subscription_renewal');
  end if;
  return 'applied';
end $$;

-- The learner's live subscription (pending, active or halted), or null. Used to cancel at Razorpay before account deletion.
create function public.payments_live_subscription(p_user uuid) returns jsonb
language sql security definer set search_path = public as $$
  select to_jsonb(s) from (
    select razorpay_subscription_id, status, plan_id from public.subscriptions
     where user_id = p_user and status in ('pending', 'active', 'halted')
  ) s;
$$;

-- ---------------------------------------------------------------------------
-- Saved code (A2): latest code per user and exercise.
-- ---------------------------------------------------------------------------
create function public.saved_code_upsert(p_user uuid, p_exercise text, p_code text) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  v_at timestamptz;
begin
  insert into public.saved_code (user_id, exercise_id, code) values (p_user, p_exercise, p_code)
  on conflict (user_id, exercise_id) do update set code = excluded.code, updated_at = now()
  returning updated_at into v_at;
  return v_at;
end $$;

create function public.saved_code_list(p_user uuid)
returns table (exercise_id text, code text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select s.exercise_id, s.code, s.updated_at from public.saved_code s
   where s.user_id = p_user order by s.updated_at desc;
$$;

create function public.saved_code_delete(p_user uuid, p_exercise text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.saved_code where user_id = p_user and exercise_id = p_exercise;
  return found;
end $$;

create function public.saved_code_delete_all(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  delete from public.saved_code where user_id = p_user;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Account (A3, POLICY 2.3): summary and deletion. Deleting the auth user cascades to profile,
-- balance, ledger, hint log, saved code and subscriptions.
-- ---------------------------------------------------------------------------
create function public.account_get(p_user uuid) returns jsonb
language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'email', p.email,
    'plan_id', coalesce((select s.plan_id from public.subscriptions s where s.user_id = p.id and s.status = 'active'), 'free'),
    'balance', public.credits_get_balance(p.id)
  ) from public.profiles p where p.id = p_user;
$$;

create function public.account_delete(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = p_user;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: functions are callable by the service role only.
-- ---------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (
       'handle_new_user', 'credits_get_balance', 'credits_reserve', 'credits_release', 'credits_reset',
       'hint_log_record', 'payments_claim_checkout', 'payments_attach_subscription',
       'payments_abandon_checkout', 'payments_apply_event', 'payments_live_subscription',
       'saved_code_upsert', 'saved_code_list', 'saved_code_delete', 'saved_code_delete_all',
       'account_get', 'account_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
