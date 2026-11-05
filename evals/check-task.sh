#!/usr/bin/env bash
# Usage: check-task.sh <eval.json> <result.json>, run from the root of the checkout the run worked in.
# Fails a run that errored, changed files outside may_change, or fails any check.
set -uo pipefail
name="$(jq -r '.name' "$1")"
export EVALS="$(cd "$(dirname "$1")" && pwd)"
strays() {
  git status --porcelain | cut -c4- | while read -r path; do
    jq -e --arg p "$path" 'any(.may_change[]; . as $ok | $p == $ok or ($p | startswith($ok + "/")))' "$1" >/dev/null || echo "       $path"
  done
}
report=""; passed=0; total="$(jq '.checks | length' "$1")"
if [ "$(jq -r '.is_error' "$2" 2>/dev/null)" != "false" ]; then
  report="     the run ended in an error: $(jq -r '.result // (.errors | join(", "))' "$2" 2>/dev/null)"$'\n'
elif [ -n "$(strays "$1")" ]; then
  report="     the run changed files this eval does not allow:"$'\n'"$(strays "$1")"$'\n'
else
  for i in $(seq 0 $((total - 1))); do
    cname="$(jq -r ".checks[$i].name" "$1")"; cmd="$(jq -r ".checks[$i].run" "$1")"
    if out="$(bash -c "$cmd" 2>&1 </dev/null)"; then passed=$((passed + 1)); else report+="     FAIL $cname"$'\n'"$(printf '%s' "$out" | tail -5 | sed 's/^/       /')"$'\n'; fi
  done
fi
if [ "$passed" = "$total" ] && [ -z "$report" ]; then echo "PASS $name ($passed/$total)"; else echo "FAIL $name ($passed/$total)"; printf '%s' "$report"; exit 1; fi
