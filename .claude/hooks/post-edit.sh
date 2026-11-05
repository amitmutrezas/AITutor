#!/usr/bin/env bash
# PostToolUse: format and lint only the file that changed. Fast, scoped, never blocks on missing tools.
set -uo pipefail
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
file="$(jq -r '.tool_input.file_path // empty')"
[ -z "$file" ] && exit 0
[ -f "$root/package.json" ] || exit 0
case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md) ;;
  *) exit 0 ;;
esac
cd "$root"
if [ -x node_modules/.bin/prettier ]; then node_modules/.bin/prettier --write "$file" >/dev/null 2>&1 || true; fi
case "$file" in
  *.ts|*.tsx|*.js|*.jsx)
    if [ -x node_modules/.bin/eslint ]; then
      out="$(node_modules/.bin/eslint --max-warnings 0 "$file" 2>&1)" || { echo "$out" >&2; exit 2; }
    fi ;;
esac
exit 0
