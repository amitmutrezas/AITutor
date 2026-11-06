# Unstuck

An AI coding tutor that gives hints, not answers. A learner works an exercise in the browser and, when stuck, climbs a five-level ladder: Nudge, Concept, Locate, Scaffold, Reveal. The early levels can't leak the solution because the model never sees it. Built for adults switching careers into software.

Open source under the MIT license. Contributions are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## How it works

- **Hint ladder.** Levels 1 and 2 are free. Levels 3, 4 and 5 cost 1, 2 and 3 credits. The costs live in `lib/config`.
- **Solution firewall.** Prompts for levels 1 to 3 never contain the reference solution, and a leak check runs on levels 1 to 4. If the model fails, times out or trips the check, the learner gets a stored fallback hint and isn't charged.
- **Credits.** Integers, counted only in `lib/credits`, inside a database transaction. The model never decides a balance.
- **Runner.** Learner code runs in a sandboxed Web Worker in the browser, never on the server.
- **Exercises.** JavaScript at launch, TypeScript later. Each exercise in `content/exercises/` has to pass its own tests before it can go live (`pnpm exercises:verify`).
- **Accounts and plans.** Supabase for sign-in and data, Razorpay for subscriptions. A mock payments mode (`PAYMENTS_MODE=mock`) lets you try the plans flow with no real payment.

## Run it locally

You need Node.js and pnpm.

```bash
pnpm install
cp .env.example .env.local   # then fill in the values you have
pnpm dev
```

Open http://localhost:3000. Without Supabase values the account and hint routes answer 503 on purpose; the exercise pages and the in-browser runner still work. For payments, use test mode only: set `PAYMENTS_MODE=mock`, or Razorpay test keys. Never put live keys in a file you might commit.

### Environment variables

The names are in `.env.example`. The ones that matter first:

| Name | What it's for |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public Supabase client settings |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Never expose it to the browser |
| `ANTHROPIC_API_KEY`, `HINT_MODEL_LOW`, `HINT_MODEL_HIGH` | Live hints. Without them the stored fallback hints are used |
| `PAYMENTS_MODE` | `mock` for simulated checkout, unset for the real Razorpay path |
| `RAZORPAY_*` | Test-mode keys, plan ids and webhook secret |
| `CRON_SECRET` | Protects the credit cleanup cron |

### Database

SQL lives in `supabase/migrations/`, applied in order (`0001_init.sql`, then `0002_accounts_credits_payments.sql`). Run them against a Supabase project with `supabase db push`, or paste them into the SQL editor. After that, add `<your site url>/auth/confirm` to the project's redirect URLs.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the dev server |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript check |
| `pnpm lint` | ESLint, zero warnings allowed |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright) |
| `pnpm exercises:verify` | Check that every exercise passes its own tests |
| `pnpm evals:product` | Product evals, such as leak check recall |

## Deploying

The app deploys to Vercel. Set the environment variables above in the project settings. `vercel.json` runs the credit cleanup cron once a day, which fits the Hobby plan; on Pro you can run it more often.

## Where things are

- `app/`: routes and UI. `app/api/` holds server routes only.
- `lib/hints/`: prompt builder, ladder, leak check and fallbacks. The core of the product.
- `lib/credits/`, `lib/payments/`, `lib/account/`, `lib/auth/`: credits, Razorpay, account deletion and sign-in.
- `lib/runner/`: the sandboxed code runner.
- `content/exercises/`: exercise JSON.
- `intent/`: why we're building this, the requirements (`SPEC.md`) and the plan.
- `POLICY.md`: rules that always hold. `REVIEW.md` and `AGENTS.md`: how pull requests are reviewed.
- `evals/`, `metrics/`: evals and the numbers we watch.

## License

[MIT](LICENSE).
