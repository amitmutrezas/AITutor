#!/usr/bin/env bash
# Checks that the hooks block and allow what POLICY.md says. Run in CI.
set -uo pipefail
cd "$(dirname "$0")/../../.."
export CLAUDE_PROJECT_DIR="$PWD"
fail=0
expect() { # expect <exit> <hook> <json>
  want="$1"; hook="$2"; json="$3"
  printf '%s' "$json" | "$hook" >/dev/null 2>&1; got=$?
  if [ "$got" != "$want" ]; then echo "FAIL $hook want=$want got=$got input=$json"; fail=1; else echo "ok   $hook $want"; fi
}
H=.claude/hooks
expect 2 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/POLICY.md\"}}"
expect 2 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/.github/workflows/ci.yml\"}}"
expect 0 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/README.md\"}}"
expect 0 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/intent/PLAN.md\"}}"
if grep -Eq '^Status:[[:space:]]*\**APPROVED' intent/PLAN.md; then
  expect 0 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/lib/x.ts\"}}"
else
  expect 2 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/lib/x.ts\"}}"
fi
expect 2 $H/production-gate.sh '{"tool_input":{"command":"vercel deploy --prod"}}'
expect 2 $H/production-gate.sh '{"tool_input":{"command":"npm run deploy:production"}}'
expect 2 $H/production-gate.sh '{"tool_input":{"command":"vercel promote dpl_123 --yes"}}'
expect 2 $H/production-gate.sh '{"tool_input":{"command":"npx vercel env pull"}}'
expect 2 $H/production-gate.sh '{"tool_input":{"command":"vercel alias set a b"}}'
expect 0 $H/production-gate.sh '{"tool_input":{"command":"pnpm test"}}'
(RELEASE_APPROVAL=amit expect 0 $H/production-gate.sh '{"tool_input":{"command":"vercel deploy --prod"}}')
expect 0 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/.env.example\"}}"
expect 2 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/.env.local\"}}"
expect 2 $H/bash-paths.sh '{"tool_input":{"command":"sed -i s/a/b/ POLICY.md"}}'
expect 2 $H/bash-paths.sh '{"tool_input":{"command":"python3 -c \"open(\\\".github/workflows/ci.yml\\\",\\\"w\\\")\""}}'
expect 0 $H/bash-paths.sh '{"tool_input":{"command":"cat POLICY.md"}}'
expect 0 $H/bash-paths.sh '{"tool_input":{"command":"pnpm test"}}'
expect 2 $H/bash-paths.sh '{"tool_input":{"command":"cat .env"}}'
expect 2 $H/bash-paths.sh '{"tool_input":{"command":"python3 -c \"print(open(\\\".env.local\\\").read())\""}}'
expect 2 $H/bash-paths.sh '{"tool_input":{"command":"ls secrets/"}}'
expect 0 $H/bash-paths.sh '{"tool_input":{"command":"cat .env.example"}}'
expect 0 $H/bash-paths.sh '{"tool_input":{"command":"node -p process.env.HOME"}}'
expect 2 $H/bash-paths.sh '{"tool_input":{"command":"sed -i s/DRAFT/APPROVED/ intent/PLAN.md"}}'
expect 2 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/intent/PLAN.md\",\"new_string\":\"Status: APPROVED\"}}"
expect 0 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/intent/PLAN.md\",\"new_string\":\"M0 done\"}}"
(FIX_TASK=1 expect 2 $H/protect-paths.sh "{\"tool_input\":{\"file_path\":\"$PWD/lib/hints/leak.test.ts\"}}")
expect 2 $H/release-gate.sh '{"tool_name":"mcp__Vercel__request_promote","tool_input":{}}'
expect 0 $H/release-gate.sh '{"tool_name":"mcp__Vercel__get_deployment","tool_input":{}}'
(RELEASE_APPROVAL=amit expect 0 $H/release-gate.sh '{"tool_name":"mcp__Vercel__request_promote","tool_input":{}}')
expect 0 $H/secrets-guard.sh '{"tool_input":{"command":"git status"}}'
# secrets-guard: .env co-staged with .env.example must still block
tmp="$(mktemp -d)"; ( cd "$tmp" && git init -q && echo A=1 > .env && echo A= > .env.example && git add -f .env .env.example \
  && printf '%s' '{"tool_input":{"command":"git commit -m x"}}' | "$OLDPWD/$H/secrets-guard.sh" >/dev/null 2>&1; [ $? = 2 ] ) \
  && echo "ok   secrets-guard co-staged .env" || { echo "FAIL secrets-guard co-staged .env"; fail=1; }
# commit with global git options must still be scanned
tmp="$(mktemp -d)"; ( cd "$tmp" && git init -q && echo 'k = "sk-ant-abcdefghijklmnop1234"' > a.txt && git add a.txt \
  && printf '%s' '{"tool_input":{"command":"git -c commit.gpgsign=false commit -m x"}}' | "$OLDPWD/$H/secrets-guard.sh" >/dev/null 2>&1; [ $? = 2 ] ) \
  && echo "ok   secrets-guard global options" || { echo "FAIL secrets-guard global options"; fail=1; }
rm -rf "$tmp"
# empty .env must also block (no added text lines)
tmp="$(mktemp -d)"; ( cd "$tmp" && git init -q && : > .env && git add -f .env \
  && printf '%s' '{"tool_input":{"command":"git commit -m x"}}' | "$OLDPWD/$H/secrets-guard.sh" >/dev/null 2>&1; [ $? = 2 ] ) \
  && echo "ok   secrets-guard empty .env" || { echo "FAIL secrets-guard empty .env"; fail=1; }
rm -rf "$tmp"
exit $fail
