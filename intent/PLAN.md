# Plan: Unstuck MVP (from INTENT.md and SPEC.md, 2026-11-05)

Status: **DRAFT. Not approved. No implementation starts until Amit approves this file in the project thread.**
After approval: a commit titled "plan: approved" updates this line, and only then do build sessions begin.

## Proposed stack (confirm or change)

- Next.js (App Router) + TypeScript on Node, deployed on Vercel. [from Amit's note]
- pnpm, ESLint, Prettier, Vitest for unit tests, Playwright for smoke tests, Zod for validation. [proposal]
- Postgres with auth: Supabase [proposal; Amit has the connector, not yet confirmed as the choice].
- Razorpay subscriptions plus webhook. [confirmed provider]
- LLM calls through the Anthropic API from server routes. Model is an env var. Small fast model for levels 1-3, stronger one for 4-5 [proposal].
- In-browser execution: sandboxed Web Worker for JavaScript exercises. [assumption]

## Files that change (new repo, everything is new)

```
app/                      routes: landing, auth, exercises, workspace, plans, account, terms, refund, privacy
app/api/hint/route.ts     hint endpoint (credits, firewall, leak check)
app/api/razorpay/webhook/route.ts
lib/hints/                prompt builder, ladder config, leak check, fallbacks
lib/credits/              plan config, atomic deduction
lib/exercises/            schema, verify runner, loader
lib/db/                   schema, migrations, queries
lib/runner/               worker sandbox + test harness
content/exercises/        generated exercises (json) + verify output
scripts/generate-exercises.ts, scripts/verify-exercises.ts
tests/, evals/            unit tests, product evals (leak recall), agent evals
```

## Order of work

Each milestone ends in a PR that passes CI and review (REVIEW.md). Milestones marked (P) can run in parallel worktrees once M0 and M1 land.

0. **M0 Scaffold.** Next.js + TS + lint + test + CI wired to `package.json` scripts the hooks and workflows already call (`lint`, `typecheck`, `test`, `build`). Vercel preview connected. No secrets.
1. **M1 Data and exercise schema.** DB schema, exercise schema, `exercises:verify`. Proof: verify passes on one hand-written seed exercise and fails on a broken one.
2. **M2 Hint core (P).** Ladder config, prompt builder with firewall, leak check, fallbacks, hint route without credits. Proof: acceptance 2 and 3.
3. **M3 Runner and workspace (P).** Editor, worker sandbox, test results UI. Proof: Playwright smoke steps 1-3.
4. **M4 Exercises.** Generate 6 to 8 exercises, verify, human read-through, set live. Proof: acceptance 1.
5. **M5 Accounts, credits, saved code.** Auth, credit deduction, saved code and delete. Proof: acceptance 4, saved-code tests.
6. **M6 Payments (P).** Plans, Razorpay test-mode checkout, webhook. Proof: acceptance 5. Live keys only with Amit's go-ahead.
7. **M7 Pages and polish.** Landing, plans, account, policy pages, analytics events, accessibility pass. Proof: acceptance 6 and 8.
8. **M8 Launch.** README, LICENSE, CONTRIBUTING, pre-launch hint audit (acceptance 7), Vercel production deploy behind the production gate hook. Amit approves the deploy.

Parallel plan: M0 and M1 serial, one session. Then 3 worktree sessions: hint core (M2), runner and workspace (M3), payments (M6). A `verifier` subagent runs the app before any session reports done. Auth and credits (M5) wait for M2 and M3.

## Risks

- Razorpay activation and KYC can outlast the build. Mitigation: test mode first; live keys are a config switch.
- In-browser execution and exercise correctness are the two likeliest slips. If they slip, cut the exercise count to 4 before cutting the leak check.
- LLM cost with no baseline. Mitigation: token logging from M2, per-user rate limit, small model at low levels.
- Legal text needs a qualified reviewer. Mitigation: ship the pages as drafts behind a flag until reviewed; do not switch on live payments before that.
- Scope creep from the Out list. Mitigation: SPEC.md section 1 is the contract; changes need a SPEC.md commit first.

## Proof

Acceptance criteria 1 to 8 in SPEC.md, all green in CI except 7 (human audit) and the live payment test.

## Decisions needed from Amit

1. Exercise language: JavaScript only, TypeScript only, or both. Default if no answer: JavaScript.
2. Plan prices and monthly credit amounts. Default: placeholders from the prototype, marked as such in the UI code.
3. Free tier: none, or levels 1-2 only. Default: levels 1-2 only.
4. Database and auth: Supabase or another. Default: Supabase.
5. LICENSE for the open source repo (MIT, Apache-2.0, other). Default: MIT.
6. Who reviews the terms, refund and privacy text before live payments.
7. Which LLM API account and budget cap to use for production.
8. Codex review: confirm the Codex GitHub app is installed on this repo (see REVIEW.md).

## Approval gate

Amit replies "approved" (or lists changes) in the project thread. Until then the agent writes docs and tooling only.
