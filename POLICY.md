# Engineering policy

Rules that must always hold, for humans and agents. This is the internal policy for building the product. The learner-facing terms, refund and privacy pages are product content described in `intent/SPEC.md` (L1 to L3).

Where a rule is marked **[hook]** it is also enforced mechanically in `.claude/settings.json`. Advisory rules in prose are backed by tests or review where possible. If two rules ever conflict, stop and ask Amit.

## 1. Solution firewall (core product rule)

1.1 The reference solution is never in the model's context at hint levels 1-3. Enforced by code structure and a unit test, not by prompt wording.
1.2 Every hint at levels 1-4 passes the leak check before display. An error in the check fails closed: show the fallback.
1.3 Only exercises with status `verified` can be `live`. Verified means tests pass against the reference solution and fail against the starter code.

## 2. Learner data

2.1 Store the minimum: account email, latest code per exercise, hint request log (level, exercise, code hash, tokens, timestamp), plan and credits. Payment card data never touches our servers; Razorpay holds it.
2.2 Never log learner code. Never send learner code anywhere except the LLM provider named in the privacy page.
2.3 Learners can delete saved code and their account. Deletion removes saved code, hint logs and profile within the retention window stated on the privacy page.
2.4 No third-party trackers or ad pixels without Amit's approval.

## 3. Money and credits

3.1 Credits are integers changed only in `lib/credits` inside a database transaction.
3.2 A failed hint is not charged.
3.3 Webhooks verify signatures and are idempotent by event id.
3.4 Live Razorpay keys are used only after Amit approves. Development and previews use test mode.
3.5 Prices and credit amounts come from config, never hard-coded in UI strings.

## 4. Secrets and access

4.1 No secrets, tokens, `.env*` files or keys in the repo, in prompts, in logs or in PR text. **[hook]** edits to `.env*` are blocked and secret-looking strings in staged diffs block commits.
4.2 LLM and Razorpay keys are server-side environment variables only.
4.3 Agents do not read `.env*` or `secrets/`. They use `.env.example` for names.

## 5. AI use

5.1 Generated exercises and generated legal text are drafts. A person reads them before they go live.
5.2 The model never decides credits, plans, or permissions.
5.3 Model names and token limits are config. Every call logs tokens for cost tracking.

## 6. Protected paths and approvals

Agents may not change these without the user asking for that change in the current session. **[hook]** blocks edits to them for agent sessions; a human can still edit and commit.

- `POLICY.md`, `REVIEW.md`, `intent/INTENT.md`, `intent/SPEC.md`
- `.claude/settings.json`, `.claude/hooks/**`, `.github/workflows/**`, `.github/CODEOWNERS`
- `app/(legal)/**` (terms, refund, privacy pages)
- `db/migrations/**` already applied to production (never rewrite; add a new one)

`intent/PLAN.md` may be edited by agents only to record approved changes.

## 7. Approvals that always need Amit

- Approving `intent/PLAN.md` (starts implementation).
- Switching Razorpay to live keys.
- Any production deploy. **[hook]** blocks `deploy ... production` commands unless `RELEASE_APPROVAL` is set by a human.
- Publishing or changing the policy pages.
- Adding a paid service or raising an LLM budget cap.
- Choosing the open source LICENSE.

## 8. Scope

The "Out of first release" list in `intent/SPEC.md` stays out. Add to scope by changing SPEC.md first, with Amit's approval.

## 9. Quality gates

9.1 A PR needs green CI (typecheck, lint, tests, build) and one human approval.
9.2 Tests are not weakened, skipped or deleted to get green.
9.3 Every behavior change cites a SPEC requirement id.
