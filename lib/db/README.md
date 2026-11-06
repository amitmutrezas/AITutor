# Database (Supabase Postgres)

Schema lives in `supabase/migrations/0001_init.sql`. Row level security is on for every table.

| Table                     | Purpose                                                                              | Who writes                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `profiles`                | One row per `auth.users` user (id, email)                                            | server                                                                                 |
| `plans`                   | Plan name and `monthly_credits`                                                      | server                                                                                 |
| `subscriptions`           | A user's plan and Razorpay subscription state                                        | server (webhook)                                                                       |
| `credit_ledger`           | Integer credit grants and spends (`delta`), the source of truth for balance          | server, in a transaction via `lib/credits`                                             |
| `hint_log`                | One row per hint: level, `code_hash`, tokens, fallback flag. **No code column** (N3) | server                                                                                 |
| `saved_code`              | A learner's latest code per exercise, `unique(user_id, exercise_id)`                 | server, via `saved_code_*` functions (the learner can also write own rows through RLS) |
| `credit_balances`         | One integer balance per user, `check (balance >= 0)` (0002)                          | server, via `credits_*` functions                                                      |
| `payment_events`          | Processed Razorpay event ids, primary key = idempotency claim (0002)                 | server, in `payments_apply_event`                                                      |
| `exercises`               | Full exercise incl. `reference_solution` and `fallback_hints`                        | service role only                                                                      |
| `exercises_public` (view) | Live exercises without `reference_solution` or `fallback_hints`                      | read by anyone                                                                         |

## Rules

- **Hint code must select explicit columns.** Never `select *` on `exercises`, and never select `reference_solution` in any path that serves levels 1-3. Use the `ExerciseForHint` type from `lib/exercises/schema.ts`, which has no `referenceSolution` field.
- Learners read their own `credit_ledger` and `hint_log` but cannot write them. Balance is the sum of `delta`, computed in `lib/credits`; the model never decides it.
- Never log learner code. Store and log a hash.
- Tests never call a database.

## Migration 0002 (M5)

All app access to the database goes through SECURITY DEFINER functions executable by the service role only
(`lib/db/rpc.ts` is the single surface; adapters live in `lib/credits`, `lib/payments`, `lib/saved-code`,
`lib/account`, `lib/hints/hint-log.ts`). Unit tests use in-memory fakes of those ports.

- Credits: `credits_reserve` (one conditional UPDATE, never below zero, returns a reservation id), `credits_release`
  (by reservation id, idempotent), `credits_settle_hint` (hash-only hint log row + reservation marked settled in one
  transaction), `credits_reconcile` (releases reservations still `reserved` after `CREDITS.reservationTimeoutSeconds`;
  run at the start of every reserve for that user and callable with the service role from a cron), `credits_reset`
  (renewal, no rollover), `credits_get_balance`. Reservations live in `credit_reservations` (reserved/settled/released).
- Payments: `payments_claim_checkout`, `payments_attach_subscription`, `payments_abandon_checkout`,
  `payments_apply_event`, `payments_live_subscription`. One live subscription per user (partial unique index).
- Saved code: `saved_code_upsert`, `saved_code_list`, `saved_code_delete`, `saved_code_delete_all`.
- Account: `account_get`; deletion is three calls: `account_begin_delete(user)` (locks the profile, sets
  `profiles.deleting_at` + `deleting_token`, returns `{token, live}`, or `{in_progress: true}` if another deletion holds
  a marker younger than 10 minutes, or null for no account), then the Razorpay cancel, then `account_delete(user, token)`
  (deletes `auth.users`; everything cascades). On a failed cancel, `account_cancel_delete(user, token)` clears the
  marker only if the token is still the caller's (compare-and-set, returns boolean). The marker is a 10-minute lease:
  `account_delete` rejects a lapsed one, and `payments_claim_checkout` / `payments_attach_subscription` clear a lapsed
  marker (token included), so a stalled deletion can never cascade a later subscription.
- Auth: `supabase.auth.signOut()` resolves with `{ error }`; `lib/auth/supabase-provider.ts` turns that into a thrown
  error, so `/api/auth/signout` returns 500 and the account page does not redirect.
- Checkout also has `payments_close_checkout` (closes a superseded row once its Razorpay subscription is cancelled).
  Internal helpers, not granted to any role: `_credits_lock_balance` and `_credits_release_locked`.
- Lock order for all of the above: see `lib/payments/README.md`.
- `hint_log_record` stores the code hash only (N3).
- Exercise ids in `hint_log` and `saved_code` are no longer foreign keys: exercises are content files for now.

Env vars (names only, see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
(public), `SUPABASE_SERVICE_ROLE_KEY` (server only).
