#!/usr/bin/env bash
# Usage: evals/check.sh <eval.json> <result.json>
# result.json is `claude -p --output-format json` output; the answer is in .result.
set -euo pipefail
eval_file="$1"; result_file="$2"
answer="$(jq -r '.result // ""' "$result_file")"
lc="$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')"
id="$(jq -r '.id' "$eval_file")"
ok=1
if [ "$(jq '.must_include_any | length' "$eval_file")" -gt 0 ]; then
  found=0
  while IFS= read -r needle; do
    n="$(printf '%s' "$needle" | tr '[:upper:]' '[:lower:]')"
    case "$lc" in *"$n"*) found=1 ;; esac
  done < <(jq -r '.must_include_any[]' "$eval_file")
  [ "$found" = 1 ] || { echo "FAIL $id: none of must_include_any found"; ok=0; }
fi
while IFS= read -r bad; do
  [ -z "$bad" ] && continue
  n="$(printf '%s' "$bad" | tr '[:upper:]' '[:lower:]')"
  case "$lc" in *"$n"*) echo "FAIL $id: found forbidden text: $bad"; ok=0 ;; esac
done < <(jq -r '.must_not_include[]? // empty' "$eval_file")
[ "$ok" = 1 ] && echo "PASS $id" || { echo "--- answer ---"; echo "$answer"; exit 1; }
