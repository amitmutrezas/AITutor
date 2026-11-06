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

-- Set while an account deletion is in progress (account_begin_delete). payments_claim_checkout and
-- payments_attach_subscription refuse while it is recent, so no checkout can start between "list the
-- live subscriptions to cancel" and the cascade. It expires after 10 minutes if a deletion is abandoned.
alter table public.profiles add column deleting_at timestamptz;

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

-- Every reservation has an id and a status, so a reservation that was never released or settled
-- (crash, DB blip) can be found and given back later (credits_reconcile). Status moves only
-- reserved -> settled, released or expired (a renewal reset closes it with no refund), and only once.
create table public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  cost integer not null check (cost > 0),
  status text not null default 'reserved' check (status in ('reserved', 'settled', 'released', 'expired')),
  hint_log_id uuid references public.hint_log (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index credit_reservations_open_idx on public.credit_reservations (created_at) where status = 'reserved';
alter table public.credit_reservations enable row level security; -- no policies: service role only
revoke all on public.credit_reservations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- LOCK ORDER (one order, everywhere; see also lib/payments/README.md). A transaction takes locks only
-- in this order and may skip levels, so two transactions can never wait on each other in a cycle:
--   1. profiles row            (account_begin_delete, account_cancel_delete, account_delete,
--                               payments_claim_checkout, payments_attach_subscription)
--   2. subscriptions rows      (payments_claim_checkout, payments_apply_event, account_delete)
--   3. credit_balances row     (_credits_lock_balance: reserve, release, settle, reconcile, reset)
--   4. credit_reservations rows (release, settle, reconcile, reset, account_delete)
--   5. payment_events          (payments_apply_event, inserted last)
-- Functions that only know a reservation id first read its user_id WITHOUT a lock, take the balance
-- lock (3), and only then lock the reservation row (4).
-- ---------------------------------------------------------------------------

-- Takes the per-user balance row lock (level 3). Creates the row at zero if missing.
create function public._credits_lock_balance(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.credit_balances (user_id, balance) values (p_user, 0) on conflict (user_id) do nothing;
  perform 1 from public.credit_balances where user_id = p_user for update;
end $$;

-- Releases one reservation. The caller MUST hold the balance lock for the reservation's user.
-- p_min_age_seconds, when set, only releases reservations at least that old (reconcile).
create function public._credits_release_locked(p_reservation uuid, p_min_age_seconds integer default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_res public.credit_reservations%rowtype;
begin
  select * into v_res from public.credit_reservations where id = p_reservation for update;
  if not found or v_res.status <> 'reserved' then
    return false;
  end if;
  if p_min_age_seconds is not null and v_res.created_at >= now() - make_interval(secs => p_min_age_seconds) then
    return false;
  end if;
  update public.credit_reservations set status = 'released', resolved_at = now() where id = v_res.id;
  update public.credit_balances set balance = balance + v_res.cost, updated_at = now() where user_id = v_res.user_id;
  insert into public.credit_ledger (user_id, delta, reason) values (v_res.user_id, v_res.cost, 'hint_release');
  return true;
end $$;

-- Gives back one reservation. Idempotent: returns true only the first time (status was 'reserved').
create function public.credits_release(p_reservation uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  select user_id into v_user from public.credit_reservations where id = p_reservation; -- unlocked read
  if not found then
    return false;
  end if;
  perform public._credits_lock_balance(v_user);
  return public._credits_release_locked(p_reservation);
end $$;

-- Releases reservations still 'reserved' after p_timeout_seconds (optionally for one user). Idempotent.
-- Each candidate is released under its user's balance lock; candidates are visited in a fixed order
-- (user, age) so two concurrent reconciles cannot deadlock. Returns how many were released.
create function public.credits_reconcile(p_timeout_seconds integer, p_user uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  c record;
  v_count integer := 0;
begin
  for c in
    select id, user_id from public.credit_reservations
     where status = 'reserved'
       and created_at < now() - make_interval(secs => p_timeout_seconds)
       and (p_user is null or user_id = p_user)
     order by user_id, created_at, id
  loop
    perform public._credits_lock_balance(c.user_id);
    if public._credits_release_locked(c.id, p_timeout_seconds) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- Takes p_cost credits if the balance covers it and returns the reservation id, or null and changes nothing (C2).
-- Takes the balance lock first, then gives back this user's stale reservations, so a lost release heals on
-- the next request. The conditional UPDATE cannot take the balance below zero.
create function public.credits_reserve(p_user uuid, p_cost integer, p_timeout_seconds integer) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if p_cost is null or p_cost <= 0 then
    raise exception 'cost must be a positive integer';
  end if;
  perform public._credits_lock_balance(p_user);
  perform public.credits_reconcile(p_timeout_seconds, p_user);
  update public.credit_balances
     set balance = balance - p_cost, updated_at = now()
   where user_id = p_user and balance >= p_cost;
  if not found then
    return null;
  end if;
  insert into public.credit_reservations (user_id, cost) values (p_user, p_cost) returning id into v_id;
  insert into public.credit_ledger (user_id, delta, reason) values (p_user, -p_cost, 'hint_reserve');
  return v_id;
end $$;

-- C3: ONE transaction records the hash-only hint log row and marks the reservation settled (the charge
-- stands). Returns false, changing nothing, if the reservation is no longer 'reserved' (released by
-- reconciliation or expired by a renewal reset); the caller then treats the hint as uncharged. Any error
-- rolls back both writes.
create function public.credits_settle_hint(
  p_reservation uuid, p_exercise text, p_level integer, p_code_hash text,
  p_tokens_in integer, p_tokens_out integer, p_fallback boolean
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_res public.credit_reservations%rowtype;
  v_log uuid;
begin
  select user_id into v_user from public.credit_reservations where id = p_reservation; -- unlocked read
  if not found then
    return false;
  end if;
  perform public._credits_lock_balance(v_user);
  select * into v_res from public.credit_reservations where id = p_reservation for update;
  if not found or v_res.status <> 'reserved' then
    return false;
  end if;
  insert into public.hint_log (user_id, exercise_id, level, code_hash, tokens_in, tokens_out, fallback)
  values (v_res.user_id, p_exercise, p_level, p_code_hash, p_tokens_in, p_tokens_out, p_fallback)
  returning id into v_log;
  update public.credit_reservations
     set status = 'settled', hint_log_id = v_log, resolved_at = now()
   where id = v_res.id;
  return true;
end $$;

-- Sets the balance to p_amount (C4: renewal resets, no rollover) and expires open reservations without
-- refund. The ledger records the difference.
create function public.credits_reset(p_user uuid, p_amount integer, p_reason text) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_old integer;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be a non-negative integer';
  end if;
  -- Balance lock FIRST (the same as reserve, release, settle and reconcile), so a concurrent reserve either
  -- commits before this point (and its reservation is expired below) or waits and then sees the new balance.
  perform public._credits_lock_balance(p_user);
  -- C4: reservations from the old cycle are closed WITHOUT refund, in this same transaction, so a later
  -- release or reconcile cannot add old-cycle credits on top of the new allowance.
  update public.credit_reservations set status = 'expired', resolved_at = now()
   where user_id = p_user and status = 'reserved';
  select balance into v_old from public.credit_balances where user_id = p_user;
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
--   {outcome: 'account_deleting'}                      refuse: the account is being deleted
--   {outcome: 'supersede', row_id, razorpay_subscription_id}  an unpaid/halted subscription for another plan
--                                                      exists: cancel it at Razorpay, then payments_close_checkout, then claim again
create function public.payments_claim_checkout(p_user uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.subscriptions%rowtype;
  v_id uuid;
  v_deleting timestamptz;
begin
  -- Level 1 lock: serialises with account deletion (account_begin_delete takes the same row lock).
  select deleting_at into v_deleting from public.profiles where id = p_user for update;
  if not found or (v_deleting is not null and v_deleting > now() - interval '10 minutes') then
    return jsonb_build_object('outcome', 'account_deleting');
  end if;
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
    -- A halted row or a pending checkout for another plan that exists at Razorpay must be cancelled THERE
    -- first. Nothing changes locally until the caller confirms with payments_close_checkout, so a failed
    -- Razorpay cancel leaves the old row (and the learner's state) exactly as it was.
    if v_row.razorpay_subscription_id is not null then
      return jsonb_build_object(
        'outcome', 'supersede', 'row_id', v_row.id,
        'razorpay_subscription_id', v_row.razorpay_subscription_id);
    end if;
    -- A claim that never reached Razorpay (stale, or for another plan): safe to close locally.
    update public.subscriptions set status = 'cancelled', updated_at = now() where id = v_row.id;
  end if;
  begin
    insert into public.subscriptions (user_id, plan_id, status) values (p_user, p_plan, 'pending')
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('outcome', 'in_progress');
  end;
  return jsonb_build_object('outcome', 'claimed', 'claim_id', v_id);
end $$;

-- Closes a pending or halted row AFTER its Razorpay subscription was cancelled there.
create function public.payments_close_checkout(p_row uuid) returns void
language sql security definer set search_path = public as $$
  update public.subscriptions set status = 'cancelled', updated_at = now()
   where id = p_row and status in ('pending', 'halted');
$$;

-- Stores the Razorpay subscription id on the caller's still-pending claim. Returns FALSE when it matched no
-- row (claim gone, closed, already attached, or the account is being deleted): the caller must then treat
-- the new Razorpay subscription as unattached (cancel it). Takes the profile lock first (level 1).
create function public.payments_attach_subscription(p_claim uuid, p_razorpay_subscription_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
  v_deleting timestamptz;
begin
  select user_id into v_user from public.subscriptions where id = p_claim; -- unlocked read
  if not found then
    return false;
  end if;
  select deleting_at into v_deleting from public.profiles where id = v_user for update;
  if not found or (v_deleting is not null and v_deleting > now() - interval '10 minutes') then
    return false;
  end if;
  update public.subscriptions
     set razorpay_subscription_id = p_razorpay_subscription_id, updated_at = now()
   where id = p_claim and status = 'pending' and razorpay_subscription_id is null;
  return found;
end $$;

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
--   'unknown_subscription' (no row has this subscription id yet: the event id is NOT claimed, caller retries),
--   'mismatch' (the subscription belongs to another user: claimed, nothing applied), 'stale' (cancelled already, or older than
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
  if p_kind = 'ignore' then
    insert into public.payment_events (event_id, kind) values (p_event_id, p_kind)
    on conflict (event_id) do nothing;
    if not found then
      return 'duplicate';
    end if;
    return 'ignored';
  end if;
  if p_status not in ('active', 'halted', 'cancelled') then
    raise exception 'invalid status';
  end if;

  -- Find the subscription BEFORE claiming the event id. An event can arrive after Razorpay created the
  -- subscription but before payments_attach_subscription stored its id; claiming it then would make the
  -- retry a "duplicate" and the learner would never get the plan. Unknown means: claim nothing, retry later.
  select * into v_row from public.subscriptions
   where razorpay_subscription_id = p_razorpay_subscription_id for update;
  if not found then
    return 'unknown_subscription';
  end if;

  insert into public.payment_events (event_id, kind) values (p_event_id, p_kind)
  on conflict (event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;
  if v_row.user_id <> p_user then
    return 'mismatch';
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

-- Step 1 of deletion. Takes the profile lock, sets the deleting marker (so no checkout can start or attach
-- from now on) and returns the live subscription to cancel at Razorpay: {live: {...} | null}.
-- Returns null if the account does not exist.
create function public.account_begin_delete(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.profiles where id = p_user for update;
  if not found then
    return null;
  end if;
  update public.profiles set deleting_at = now() where id = p_user;
  return jsonb_build_object('live', (
    select to_jsonb(s) from (
      select razorpay_subscription_id, status, plan_id from public.subscriptions
       where user_id = p_user and status in ('pending', 'active', 'halted')
    ) s));
end $$;

-- Called when the Razorpay cancel failed: the account stays, checkout is allowed again.
create function public.account_cancel_delete(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update public.profiles set deleting_at = null where id = p_user;
$$;

-- Step 2: only after account_begin_delete. Locks everything in the documented order, then deletes
-- auth.users; the cascade removes profile, balance, reservations, ledger, hint log, saved code, subscriptions.
create function public.account_delete(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_deleting timestamptz;
begin
  select deleting_at into v_deleting from public.profiles where id = p_user for update;
  if not found then
    return;
  end if;
  if v_deleting is null then
    raise exception 'account_begin_delete must run first';
  end if;
  perform 1 from public.subscriptions where user_id = p_user for update;
  perform 1 from public.credit_balances where user_id = p_user for update;
  perform 1 from public.credit_reservations where user_id = p_user for update;
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
       'credits_reconcile', 'credits_settle_hint', '_credits_lock_balance', '_credits_release_locked',
       'hint_log_record', 'payments_claim_checkout', 'payments_attach_subscription',
       'payments_abandon_checkout', 'payments_close_checkout', 'payments_apply_event', 'payments_live_subscription',
       'saved_code_upsert', 'saved_code_list', 'saved_code_delete', 'saved_code_delete_all',
       'account_get', 'account_begin_delete', 'account_cancel_delete', 'account_delete')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
