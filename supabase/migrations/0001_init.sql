-- 0001_init: core tables, row level security, public exercise view.
-- Writes to credit_ledger, hint_log, subscriptions and exercises are made by server code with the
-- service role only (credits are counted in lib/credits inside a transaction; the model never sets a balance).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create table public.plans (
  id text primary key,
  name text not null,
  monthly_credits integer not null check (monthly_credits >= 0)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  plan_id text not null references public.plans (id),
  status text not null check (status in ('active', 'past_due', 'canceled')),
  razorpay_subscription_id text unique,
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);
create index subscriptions_user_id_idx on public.subscriptions (user_id);

create table public.exercises (
  id text primary key,
  title text not null,
  statement text not null,
  language text not null check (language in ('javascript', 'typescript')),
  starter_code text not null,
  tests text not null,
  reference_solution text not null, -- service role only; never select this in hint code for levels 1-3
  fallback_hints text[] not null check (array_length(fallback_hints, 1) = 5),
  status text not null default 'draft' check (status in ('draft', 'verified', 'live')),
  created_at timestamptz not null default now()
);

create table public.hint_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id text not null references public.exercises (id),
  level smallint not null check (level between 1 and 5),
  code_hash text not null, -- hash only; learner code is never logged (N3)
  tokens_in integer not null default 0,
  tokens_out integer not null default 0,
  fallback boolean not null default false,
  created_at timestamptz not null default now()
);
create index hint_log_user_id_idx on public.hint_log (user_id, created_at desc);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  delta integer not null, -- integer credits; positive grants, negative spends
  reason text not null,
  hint_log_id uuid references public.hint_log (id),
  created_at timestamptz not null default now()
);
create index credit_ledger_user_id_idx on public.credit_ledger (user_id, created_at desc);

create table public.saved_code (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  exercise_id text not null references public.exercises (id),
  code text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, exercise_id)
);

-- Row level security
alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.exercises enable row level security;
alter table public.hint_log enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.saved_code enable row level security;

create policy "profiles: read own" on public.profiles for select to authenticated using (id = auth.uid());
create policy "plans: read all" on public.plans for select to authenticated, anon using (true);
create policy "subscriptions: read own" on public.subscriptions for select to authenticated using (user_id = auth.uid());
create policy "hint_log: read own" on public.hint_log for select to authenticated using (user_id = auth.uid());
create policy "credit_ledger: read own" on public.credit_ledger for select to authenticated using (user_id = auth.uid());

create policy "saved_code: read own" on public.saved_code for select to authenticated using (user_id = auth.uid());
create policy "saved_code: insert own" on public.saved_code for insert to authenticated with check (user_id = auth.uid());
create policy "saved_code: update own" on public.saved_code for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "saved_code: delete own" on public.saved_code for delete to authenticated using (user_id = auth.uid());

-- exercises has no policy for anon/authenticated: only the service role (which bypasses RLS) can read the table.
revoke all on public.exercises from anon, authenticated;
-- Learners cannot write ledger, hint log or subscriptions.
revoke insert, update, delete on public.hint_log, public.credit_ledger, public.subscriptions, public.plans, public.profiles from anon, authenticated;

-- Public view: live rows only, no reference_solution and no fallback_hints (level 5 reveals the answer).
-- Runs with the view owner's rights so it can read the locked-down table.
create view public.exercises_public as
  select id, title, statement, language, starter_code, tests
  from public.exercises
  where status = 'live';
grant select on public.exercises_public to anon, authenticated;
