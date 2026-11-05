# Metrics: closing the loop

Two groups. Delivery metrics tell us whether the AI-native workflow is working. Product metrics tell us whether the hypothesis holds. Targets are placeholders until there is a baseline; Amit sets real ones after the first two weeks.

## Delivery loop (collected weekly by `metrics/collect.sh`)

| Play | Metric | Source |
|---|---|---|
| Intent | Time from first conversation to committed `intent/INTENT.md`; edits to INTENT.md after SPEC.md's first commit | git log |
| Spec | Time INTENT.md to SPEC.md commit; SPEC.md commits after first PLAN.md commit | git log |
| Plan and build | Plan approval to merge time; first-pass merge share (merged with no fix commits after first review); rework cycles per PR | GitHub API |
| Feedback loop | First-pass CI success rate; change failure rate | Actions |
| Evals | Agent eval pass rate; time from incident to permanent eval; regressions caught in CI vs production | Actions, evals/ |
| PR review (Codex) | Time to first review; Important and Nit counts per PR (from the `Important: N, Nits: M` summary line); share of comments resolved without a human touching the branch; defects caught pre-merge vs escaped | GitHub API |
| Hooks | Blocks per week by hook (a rising count means the instructions are not landing); violations reaching production (target 0) | hook stderr, review |
| CI/CD | Deploy frequency, lead time, change failure rate, time to restore (DORA) | Vercel, Actions |

## Product (instrumented in the app, SPEC N6)

| Metric | Why | Placeholder target |
|---|---|---|
| Paying subscribers | The key result | Amit to set |
| Stuck exercises finished without a Reveal | Does the ladder teach? | 70% (article guess) |
| Hint level distribution and fallback rate | Is the leak check firing too often? | fallback under 10% |
| Leak rate in pre-launch audit | Core promise | under 1% |
| Share of learners who exhaust monthly credits in 48 h | Tests monthly vs daily credits | under 20% |
| AI cost per active learner per month | Margin | below plan price |
| Learner conversations held | Evidence gap | Amit to set |

## Bands (maintain stage)

`metrics/bands.yaml` defines when a drifting metric triggers a response: log at 1 sigma, diagnose at 2, propose a fix or rollback at 3. It starts with CI test failure rate and hint fallback rate, and applies once there are 30 days of data.

## Review rhythm

Weekly: read the metrics workflow summary, pick one thing to change (a CLAUDE.md line, a hook, an eval), change it through a PR, watch the number next week.
