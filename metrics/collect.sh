#!/usr/bin/env bash
# Weekly PR loop metrics from the GitHub API. Needs gh and GH_TOKEN. No learner data involved.
set -euo pipefail
repo="${GITHUB_REPOSITORY:-amitmutrezas/AITutor}"
since="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)"
# --slurp wraps every page in one outer array, so flatten before filtering.
prs="$(gh api -X GET "repos/$repo/pulls" -f state=closed -f per_page=100 --paginate --slurp \
  | jq --arg since "$since" '[.[][] | select(.merged_at != null and .merged_at >= $since)]')"
n="$(jq length <<<"$prs")"
echo "## PR loop metrics, week to $(date -u +%F)"
echo
echo "Merged PRs: $n"
[ "$n" = 0 ] && exit 0
jq -r '
  def hours(a;b): ((b|fromdateiso8601) - (a|fromdateiso8601)) / 3600;
  (map(hours(.created_at; .merged_at)) | add / length) as $avg
  | "Mean open-to-merge: \($avg * 100 | round / 100) h"' <<<"$prs"
echo
echo "Per PR: review comments and Important findings (from the Codex summary line 'Important: N, Nits: M')"
for num in $(jq -r '.[].number' <<<"$prs"); do
  comments="$(gh api "repos/$repo/pulls/$num/comments" --paginate --slurp | jq '[.[][]] | length')"
  tally="$(gh api "repos/$repo/issues/$num/comments" --paginate --slurp | jq -r '[.[][].body | capture("Important: (?<i>[0-9]+), Nits: (?<n>[0-9]+)")?] | last // empty | "Important \(.i), Nits \(.n)"')"
  echo "- #$num: $comments inline comments; ${tally:-no review tally found}"
done
