#!/usr/bin/env bash
# PreToolUse gate for deployment tools exposed through the Vercel MCP server.
# Reads: read-only tools pass. Writes that change what is live: blocked until a human sets RELEASE_APPROVAL
# (production) -- except rollback, a rehearsed runbook, which asks a person to confirm.
# The block reason is shown to Claude, so it names the route to approval.
set -euo pipefail
input="$(cat)"
tool="$(jq -r '.tool_name // empty' <<<"$input")"
decide() { # decide <allow|ask|deny> <reason>
  jq -n --arg d "$1" --arg r "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$d,permissionDecisionReason:$r}}'
  [ "$1" = "deny" ] && exit 2
  exit 0
}
case "$tool" in
  mcp__Vercel__request_rollback)
    decide ask "This rolls production back. Confirm only if you are the release owner." ;;
  mcp__Vercel__create_deployment|mcp__Vercel__request_promote|mcp__Vercel__assign_alias|mcp__Vercel__start_rolling_release|mcp__Vercel__complete_rolling_release|mcp__Vercel__approve_rolling_release_stage|mcp__Vercel__update_project|mcp__Vercel__create_project_env|mcp__Vercel__edit_project_env)
    if [ -n "${RELEASE_APPROVAL:-}" ]; then decide allow "Release approved by ${RELEASE_APPROVAL}"; fi
    decide deny "Changing what is live or its environment needs Amit's approval (POLICY.md section 7). Ask Amit in the project thread; once he approves, a human sets RELEASE_APPROVAL and the call can be repeated." ;;
  *) decide allow "read-only or unrelated tool" ;;
esac
