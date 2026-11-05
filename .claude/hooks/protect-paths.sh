#!/usr/bin/env bash
# PreToolUse gate for file edits.
# 1. Blocks edits to protected paths (POLICY.md section 6) unless ALLOW_PROTECTED=1.
# 2. Blocks application code edits until intent/PLAN.md says "Status: APPROVED".
# Exit 2 blocks the tool call and shows stderr to Claude.
set -euo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
input="$(cat)"
file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
[ -z "$file" ] && exit 0
rel="${file#"$root"/}"

protected='^(POLICY\.md|REVIEW\.md|intent/INTENT\.md|intent/SPEC\.md|\.claude/settings\.json|\.claude/hooks/|\.github/workflows/|\.github/CODEOWNERS|app/\(legal\)/|db/migrations/)'
# Real env files are protected; the committed .env.example may be edited.
base="$(basename "$rel")"
case "$base" in
  .env.example) ;;
  .env|.env.*)
    echo "Blocked: $rel is an env file (POLICY.md 4.1). Only .env.example may be edited." >&2
    exit 2 ;;
esac
if printf '%s' "$rel" | grep -Eq "$protected" && [ "${ALLOW_PROTECTED:-}" != "1" ]; then
  echo "Blocked: $rel is a protected path (POLICY.md section 6). Ask the user to approve this change, then a human can set ALLOW_PROTECTED=1 or edit it directly." >&2
  exit 2
fi

# Only a human flips PLAN.md to APPROVED.
if [ "$rel" = "intent/PLAN.md" ] && [ "${ALLOW_PROTECTED:-}" != "1" ]; then
  newtext="$(printf '%s' "$input" | jq -r '[.tool_input.new_string, .tool_input.content, (.tool_input.edits // [] | map(.new_string) | join("\n"))] | map(select(. != null)) | join("\n")')"
  if printf '%s' "$newtext" | grep -Eq 'Status:[[:space:]]*\**APPROVED'; then
    echo "Blocked: only Amit approves intent/PLAN.md. Do not write 'Status: APPROVED' (POLICY.md section 7)." >&2
    exit 2
  fi
fi

appcode='^(app/|lib/|components/|content/|scripts/|tests/|e2e/|db/|src/|public/|package\.json|next\.config)'
if printf '%s' "$rel" | grep -Eq "$appcode"; then
  if ! grep -Eq '^Status:[[:space:]]*\**APPROVED' "$root/intent/PLAN.md" 2>/dev/null; then
    echo "Blocked: intent/PLAN.md is not approved yet. Do not write application code until Amit approves the plan and PLAN.md says 'Status: APPROVED'." >&2
    exit 2
  fi
fi
exit 0
