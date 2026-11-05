# Unstuck (working name)

An AI coding tutor that gives hints, not answers. A learner works an exercise in the browser and, when stuck, climbs a five-level ladder: Nudge, Concept, Locate, Scaffold, Reveal. The early levels cannot leak the solution because the model never sees it. Open source.

Status: planning. The app is not built yet. Nothing is implemented until `intent/PLAN.md` is approved.

## Where things are

- `intent/INTENT.md`, `intent/SPEC.md`, `intent/PLAN.md`: what we are building and why, the requirements, the plan.
- `CLAUDE.md`: conventions for the agent that writes code. `AGENTS.md` and `REVIEW.md`: how pull requests are reviewed (by Codex, with a human approving).
- `POLICY.md`: rules that always hold. `.claude/`: hooks that enforce them, skills and the verifier subagent.
- `evals/`, `metrics/`: continuous evals and the metrics we watch.
- `design/`: the lo-fi prototype from the design stage.

## Contributing

Open an issue before a large change. PRs use the template, cite a requirement id from `intent/SPEC.md`, and need green CI plus one human approval. A fuller CONTRIBUTING.md and the LICENSE arrive with milestone M8 (license choice pending).
