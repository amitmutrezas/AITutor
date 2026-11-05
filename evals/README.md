# Evals

Three kinds.

**Agent evals** (`evals/agent/*.json`): a prompt plus text checks. They test that `CLAUDE.md`, skills and hooks still steer Claude correctly. Run in CI on changes to `CLAUDE.md`, `POLICY.md`, `.claude/**`, `evals/**` and nightly (`.github/workflows/agent-evals.yml`). Needs the `ANTHROPIC_API_KEY` repo secret; without it the job skips and says so. Every real mistake or incident adds a permanent eval here.

**Task evals** (`evals/tasks/*.json`, added from milestone M0 on): the real thing. Each one comes from a merged PR or an incident and holds `from` (the commit before the work), `prompt`, `may_change` (folders a run may touch) and `checks` (commands that define acceptable: tests pass, lint clean, no test lines removed, policy script clean). CI starts a scratch checkout at `from`, copies in the branch's `CLAUDE.md` and `.claude/`, runs `claude -p`, then `evals/check-task.sh` grades it from a copy of `evals/` made before any run. A run fails if it changes files outside `may_change`. Every production incident adds one that stays forever. Start with 20 to 50 as the repo grows; see `evals/tasks/_template.json`. Do not run with `--bare`: it skips the configuration under test.

**Product evals** (`evals/product/`): deterministic tests of the leak check against fixtures, added in milestone M2. Layout:

- `evals/product/<exercise-id>/leaky.json`: hints that must be rejected.
- `evals/product/<exercise-id>/good.json`: hints that must pass.
- `pnpm evals:product` fails if leak recall drops below 95% or good hints are rejected more than 10% of the time.

Run an agent eval by hand:

    claude -p "$(jq -r .prompt evals/agent/plan-gate.json)" --output-format json > /tmp/r.json
    evals/check.sh evals/agent/plan-gate.json /tmp/r.json
