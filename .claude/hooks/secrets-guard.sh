#!/usr/bin/env bash
# PreToolUse gate for Bash. On `git commit`, refuse if the staged diff looks like it contains a secret.
set -euo pipefail
cmd="$(jq -r '.tool_input.command // empty')"
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+commit' || exit 0
# Filter .env.example out first, so co-staging it cannot hide a real env file.
if git diff --cached --name-only | grep -Ev '(^|/)\.env\.example$' | grep -Eq '(^|/)\.env($|\.)'; then
  echo "Blocked: .env file staged (POLICY.md 4.1). Only .env.example may be committed." >&2
  exit 2
fi

added="$(git diff --cached -U0 2>/dev/null | grep -E '^\+[^+]' || true)"
[ -z "$added" ] && exit 0
pattern='(sk-ant-[A-Za-z0-9_-]{10,}|rzp_(live|test)_[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|token)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_\-]{20,}["'"'"'])'
if printf '%s' "$added" | grep -Eqi "$pattern"; then
  echo "Blocked: staged changes look like they contain a secret (POLICY.md 4.1). Remove it and use an environment variable." >&2
  exit 2
fi
exit 0
