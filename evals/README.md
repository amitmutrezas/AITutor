# Evals

Two kinds.

**Agent evals** (`evals/agent/*.json`): a prompt plus text checks. They test that `CLAUDE.md`, skills and hooks still steer Claude correctly. Run in CI on changes to `CLAUDE.md`, `POLICY.md`, `.claude/**`, `evals/**` and nightly (`.github/workflows/agent-evals.yml`). Needs the `ANTHROPIC_API_KEY` repo secret; without it the job skips and says so. Every real mistake or incident adds a permanent eval here.

**Product evals** (`evals/product/`): deterministic tests of the leak check against fixtures, added in milestone M2. Layout:

- `evals/product/<exercise-id>/leaky.json`: hints that must be rejected.
- `evals/product/<exercise-id>/good.json`: hints that must pass.
- `pnpm evals:product` fails if leak recall drops below 95% or good hints are rejected more than 10% of the time.

Run an agent eval by hand:

    claude -p "$(jq -r .prompt evals/agent/plan-gate.json)" --output-format json > /tmp/r.json
    evals/check.sh evals/agent/plan-gate.json /tmp/r.json
