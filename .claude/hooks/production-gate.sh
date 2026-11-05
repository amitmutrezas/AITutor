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
exit 0
