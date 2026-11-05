# Review rules

Used by the Codex reviewer (via `AGENTS.md`) and by human reviewers. Reviewing is separate from building: the agent that wrote the code does not review it.

## How review works here

1. A build session opens a PR using `.github/pull_request_template.md`.
2. CI runs (`.github/workflows/ci.yml`). It must be green before review matters.
3. Request Codex review by commenting `@codex review` on the PR (or turn on automatic reviews in Codex settings for this repo). Codex reads `AGENTS.md`, which points here.
4. Findings are fixed on the same branch. Reply to a finding when you disagree, with the reason.
5. Amit reviews and merges. Automated review never approves or blocks on its own.

Setup done: the Codex GitHub app is installed on the repo and reviews PRs when they open. Branch protection is not used (Amit's call); the human check is Amit reviewing and merging each PR. To have Codex fix a finding, comment `@codex address that feedback` on the PR. The agent that wrote the code does not approve it.

## Three passes

Tag every finding with its pass.

**Bugs.** Logic errors, off-by-one, race conditions, unhandled errors, wrong credit math, non-idempotent webhook, leaked resources, broken edge cases in the runner and leak check.

**Security.** Secrets in code, missing auth on a route, missing Zod validation, injection, unsafe execution of learner code, signature checks, rate limits, PII in logs, dependency risk.

**Compliance.** Does the change match `intent/SPEC.md` (cite the id), the committed `intent/PLAN.md`, `POLICY.md` (cite the section) and the design principles in `CLAUDE.md`? Scope creep from the Out list counts here. Flag when a change leaves `CLAUDE.md` or `PLAN.md` out of date.

## Severity

- **Important** is reserved for findings that break behavior, leak the reference solution or learner data, mishandle money or credits, or breach POLICY.md.
- **Nit** is everything else. Cap nits at five per review. If there are more, pick the five that matter.
- Do not comment on formatting, import order or anything lint, prettier or the typechecker already enforces.

## Feedback into CLAUDE.md

When a review flags the same mistake a second time, the correction goes into `CLAUDE.md` ("Things Claude gets wrong") as part of that PR. Once a month, rate the findings and trim REVIEW.md: cap nits, add generated paths to Exclude.

## Always check

- Hint code paths for levels 1-3 never receive or select `referenceSolution`.
- The leak check runs on levels 1-4 and cannot be bypassed by an error path.
- A model failure, timeout or leak trip returns the stored fallback and does not charge credits.
- Credits change only inside a transaction in `lib/credits`.
- Webhooks verify signature and dedupe by event id.
- Learner code is not logged and not executed server-side.
- Tests were added or updated for the requirement ids touched, and no test was weakened, skipped or deleted to get green.
- No edits to protected paths (POLICY.md section 6) without the PR stating Amit approved.

## Exclude

`pnpm-lock.yaml`, `.next/`, `content/exercises/*.generated.json` (reviewed through the exercise read-through, not line by line), and anything CI already enforces.

## Output format

One summary line with counts: `Important: N, Nits: M`. Then findings, most severe first, each as `[Pass] file:line: problem, why it matters, suggested fix`. The count line is machine-read by metrics (see `metrics/METRICS.md`).
