#!/usr/bin/env bash
# PreToolUse gate for Bash. Production deploys need a human to set RELEASE_APPROVAL.
set -euo pipefail
cmd="$(jq -r '.tool_input.command // empty')"
lc="$(printf '%s' "$cmd" | tr '[:upper:]' '[:lower:]')"
if printf '%s' "$lc" | grep -Eq 'deploy' && printf '%s' "$lc" | grep -Eq 'production|--prod|prod\b'; then
  if [ -z "${RELEASE_APPROVAL:-}" ]; then
    echo "Blocked: production deploy needs Amit's approval. A human sets RELEASE_APPROVAL (see POLICY.md section 7)." >&2
    exit 2
  fi
fi
if printf '%s' "$lc" | grep -Eq 'vercel[[:space:]].*--prod' && [ -z "${RELEASE_APPROVAL:-}" ]; then
  echo "Blocked: 'vercel --prod' needs RELEASE_APPROVAL (POLICY.md section 7)." >&2
  exit 2
fi
# Vercel CLI subcommands that change what is live or touch its environment and secrets.
if printf '%s' "$lc" | grep -Eq '(^|[;&|(`[:space:]])(npx[[:space:]]+)?vercel([[:space:]]+-[^[:space:]]+)*[[:space:]]+(promote|rollback|redeploy|alias|env|remove|rm|domains|project|link|pull)([[:space:]]|$)' \
   && [ -z "${RELEASE_APPROVAL:-}" ]; then
  echo "Blocked: this Vercel command changes production or touches its environment and secrets. Needs Amit's approval (POLICY.md section 7); a human sets RELEASE_APPROVAL." >&2
  exit 2
fi
exit 0
