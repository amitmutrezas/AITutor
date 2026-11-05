#!/usr/bin/env bash
# PreToolUse gate for Bash. Best-effort guard: blocks shell commands that look like they WRITE to
# protected paths (POLICY.md section 6) or to application code before PLAN.md is approved.
# This is a heuristic and can be bypassed by determined indirection. The real backstop is the
# `protected-paths` CI job plus CODEOWNERS and branch protection.
set -euo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cmd="$(jq -r '.tool_input.command // empty')"
[ -z "$cmd" ] && exit 0
[ "${ALLOW_PROTECTED:-}" = "1" ] && exit 0

# Secrets must not enter the agent context by any route (POLICY.md 4.3): block shell commands that
# name a real env file or the secrets/ folder, whatever the verb. `.env.example` is fine.
if printf '%s' "$cmd" | grep -oE '(^|[^A-Za-z0-9_])\.env[A-Za-z0-9_.-]*' | sed -E 's/^[^.]*//' | grep -Evq '^\.env\.example$|^$' \
   || printf '%s' "$cmd" | grep -Eq '(^|[^A-Za-z0-9_])secrets/'; then
  echo "Blocked: this command names an env file or secrets/ (POLICY.md 4.1, 4.3). Use .env.example for variable names." >&2
  exit 2
fi

# Only a human approves the plan: block shell writes that set PLAN.md to APPROVED.
if printf '%s' "$cmd" | grep -Eq 'PLAN\.md' && printf '%s' "$cmd" | grep -Eqi 'APPROVED'; then
  echo "Blocked: only Amit approves intent/PLAN.md (POLICY.md section 7)." >&2
  exit 2
fi

writeish='(>|>>|\bsed[[:space:]]+(-[a-zA-Z]*i|--in-place)|\btee\b|\bmv\b|\bcp\b|\brm\b|\bperl[[:space:]]+-[a-zA-Z]*i|\btruncate\b|\bdd\b|\binstall\b|\bpython3?\b|\bnode\b|\bgit[[:space:]]+(checkout|restore|apply|rm|mv)\b|\bpatch\b|\bln\b)'
printf '%s' "$cmd" | grep -Eq "$writeish" || exit 0

protected='(POLICY\.md|REVIEW\.md|intent/INTENT\.md|intent/SPEC\.md|\.claude/settings\.json|\.claude/hooks/|\.github/workflows/|\.github/CODEOWNERS|app/\(legal\)|db/migrations/)'
if printf '%s' "$cmd" | grep -Eq "$protected"; then
  echo "Blocked: this shell command looks like it writes to a protected path (POLICY.md section 6). Ask the user to approve the change; a human can edit it directly or set ALLOW_PROTECTED=1." >&2
  exit 2
fi
if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]"'"'"'=/])(app|lib|components|content|scripts|tests|e2e|src)/[A-Za-z0-9_.()\[\]-]' \
   && ! grep -Eq '^Status:[[:space:]]*\**APPROVED' "$root/intent/PLAN.md" 2>/dev/null; then
  echo "Blocked: intent/PLAN.md is not approved yet, so shell writes to application code are blocked (CLAUDE.md status gate)." >&2
  exit 2
fi
exit 0
