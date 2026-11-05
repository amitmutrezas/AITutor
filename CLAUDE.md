# Unstuck (AI coding tutor)

Hint-ladder tutor for adult career switchers. Next.js + TypeScript on Vercel. Intent, spec and plan live in `intent/`. Read `intent/SPEC.md` before changing behavior. Rules that must always hold are in `POLICY.md`.

## Status gate

`intent/PLAN.md` must say "Status: APPROVED" before you write application code. If it does not, only edit docs, tooling and config, and tell the user.

## Commands

- Install: `pnpm install`
- Dev: `pnpm dev`
- Typecheck: `pnpm typecheck`
- Lint: `pnpm lint` (zero warnings)
- Test: `pnpm test` (Vitest) and `pnpm test:e2e` (Playwright)
- Build: `pnpm build` (must finish with a successful Next.js build)
- Verify exercises: `pnpm exercises:verify`
- Product evals: `pnpm evals:product`

## Verifying your work

- Build: `pnpm build` (must finish with a successful build)
- Test: `pnpm test` (all green; never skip or delete a failing test)
- Lint: `pnpm lint` (zero warnings)

Run all three before reporting any task complete, and paste the output. If a test fails, fix the code, not the test. For a bug fix, write the failing test first, run it, commit it, then fix the code without editing that test (set `FIX_TASK=1` and a hook blocks edits to test files).

## Conventions

- TypeScript strict. No `any` without a comment saying why.
- Validate every route input with Zod.
- Credits are integers, counted in `lib/credits`, in a database transaction. Never let the model decide a balance.
- Config (thresholds, credit costs per level, model names) lives in `lib/config`, not inline.
- Keep functions small and name tests after the SPEC requirement id, for example `H2: levels 1-3 prompt never contains solution`.
- Commit messages: imperative, one line, mention the SPEC id when there is one.

## Architecture

- `app/` routes and UI. `app/api/` server routes only.
- `lib/hints/` prompt builder, ladder, leak check, fallbacks. This is the product's core.
- `lib/runner/` learner code runs in a sandboxed Web Worker, never on the server.
- `content/exercises/` generated exercise JSON. Edited by the generate and verify scripts and by review, not by hand-waving.
- `evals/` product evals (leak check recall) and agent evals (does CLAUDE.md still steer Claude correctly).

## Things Claude gets wrong here

- Do not load `referenceSolution` in any code path that serves levels 1-3. Select columns explicitly; never `select *` on exercises in hint code.
- Do not log learner code. Log a hash.
- Do not edit `intent/*.md`, `POLICY.md`, `REVIEW.md`, policy pages, `.claude/` or `.github/workflows/` without the user asking for that change in this session.
- Do not add dependencies without saying why in the PR description.
- Do not use live Razorpay or LLM production keys. Test mode only unless the user says otherwise.
- Do not add anything from the "Out of first release" list in `intent/SPEC.md`.

## Workflow

- Plan first (plan mode) for anything touching more than three files. When the work departs from `intent/PLAN.md`, update it in the same commit.
- One worktree per parallel session: `claude --worktree <name>`. Branch names `claude/<milestone>-<slug>`.
- Run the `verifier` subagent (`.claude/agents/verifier.md`) before saying a UI change works.
- PR review is done by the Codex agent (`@codex review`), not Claude, and Amit merges. See `REVIEW.md`. Do not set up Claude review workflows. A review finding repeated twice becomes a line in "Things Claude gets wrong".
- Skills: `hint-ladder` (hint code), `exercise-authoring` (exercise content), `secure-endpoint` (any API route).
- When you make the same mistake twice, add a line to "Things Claude gets wrong".
