# Database (Supabase Postgres)

Schema lives in `supabase/migrations/0001_init.sql`. Row level security is on for every table.

| Table | Purpose | Who writes |
| --- | --- | --- |
| `profiles` | One row per `auth.users` user (id, email) | server |
| `plans` | Plan name and `monthly_credits` | server |
| `subscriptions` | A user's plan and Razorpay subscription state | server (webhook) |
| `credit_ledger` | Integer credit grants and spends (`delta`), the source of truth for balance | server, in a transaction via `lib/credits` |
| `hint_log` | One row per hint: level, `code_hash`, tokens, fallback flag. **No code column** (N3) | server |
| `saved_code` | A learner's latest code per exercise, `unique(user_id, exercise_id)` | the learner (own rows) |
| `exercises` | Full exercise incl. `reference_solution` and `fallback_hints` | service role only |
| `exercises_public` (view) | Live exercises without `reference_solution` or `fallback_hints` | read by anyone |

## Rules

- **Hint code must select explicit columns.** Never `select *` on `exercises`, and never select `reference_solution` in any path that serves levels 1-3. Use the `ExerciseForHint` type from `lib/exercises/schema.ts`, which has no `referenceSolution` field.
- Learners read their own `credit_ledger` and `hint_log` but cannot write them. Balance is the sum of `delta`, computed in `lib/credits`; the model never decides it.
- Never log learner code. Store and log a hash.
- Tests never call a database.
