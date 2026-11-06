#!/usr/bin/env bash
# Cancel earlier runs of this workflow on verified lower native-stack PRs.
set -euo pipefail

: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY}"
: "${GITHUB_RUN_ID:?Set GITHUB_RUN_ID}"
[[ "$GITHUB_RUN_ID" =~ ^[0-9]+$ ]] || exit 1
events=${STACK_CANCEL_EVENTS:-pull_request,push}
dry_run=${STACK_CANCEL_DRY_RUN:-false}
[[ "$events" =~ ^[a-z_]+(,[a-z_]+)*$ ]] || exit 1
[[ "$dry_run" == true || "$dry_run" == false ]] || exit 1
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
api() { gh api -H 'Accept: application/vnd.github+json' "$@"; }
note() { printf '%s\n' "$*" | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}"; }
stop() { note "$* No cancellation performed."; exit 0; }
root="repos/$GITHUB_REPOSITORY"

api "$root/actions/runs/$GITHUB_RUN_ID" > "$tmp/current.json"
event=$(jq -r '.event' "$tmp/current.json")
case ",$events," in *",$event,"*) ;; *) stop "Event $event is outside the configured scope." ;; esac
workflow=$(jq -er '.workflow_id' "$tmp/current.json")
run_number=$(jq -er '.run_number' "$tmp/current.json")
repo_id=$(jq -er '.repository.id' "$tmp/current.json")
head=$(jq -er '.head_sha' "$tmp/current.json")
branch=$(jq -er '.head_branch' "$tmp/current.json")
source_id=$(jq -er '.head_repository.id' "$tmp/current.json")
[[ "$source_id" == "$repo_id" ]] || stop 'The run is not from this repository.'

# Exact source repository, branch, and head are required. A push can have no PR.
api --method GET --paginate --slurp "$root/pulls" \
  -f state=open -f "head=${GITHUB_REPOSITORY%%/*}:$branch" -f per_page=100 > "$tmp/prs.json"
jq --arg ref "$branch" --arg sha "$head" --argjson repo "$repo_id" \
  '[.[][] | select(.head.repo.id == $repo and .head.ref == $ref and .head.sha == $sha)]' \
  "$tmp/prs.json" > "$tmp/matches.json"
[[ $(jq length "$tmp/matches.json") == 1 ]] || stop 'No unique current open PR matches this run.'
pr=$(jq -r '.[0].number' "$tmp/matches.json")
api "$root/pulls/$pr" > "$tmp/pr.json"
jq -e --arg sha "$head" '.state == "open" and .head.sha == $sha and
  .stack != null and .stack.position == .stack.size' "$tmp/pr.json" > /dev/null || stop 'This run is not the current top PR.'
stack=$(jq -er '.stack.number' "$tmp/pr.json")
api "$root/stacks/$stack" > "$tmp/stack.json"
jq -e --argjson pr "$pr" --argjson size "$(jq '.stack.size' "$tmp/pr.json")" \
  '(.pull_requests | length) == $size and .pull_requests[-1].number == $pr and
   all(.pull_requests[]; .state == "open")' "$tmp/stack.json" > /dev/null || stop 'Stack membership is inconsistent.'

# Cancellation must not remove lower-layer coverage before the top includes it.
jq -r '.pull_requests[:-1][].head.sha' "$tmp/stack.json" > "$tmp/lower-heads"
while IFS= read -r lower_head; do
  api "$root/compare/$lower_head...$head" > "$tmp/compare.json"
  jq -e '.status == "ahead" or .status == "identical"' "$tmp/compare.json" > /dev/null || stop 'The top needs a rebase onto current lower heads.'
done < "$tmp/lower-heads"

# No branch/status search filters: paginate the workflow history without the
# filtered-search 1,000-result limit. Run number establishes prior creation only.
api --method GET --paginate --slurp "$root/actions/workflows/$workflow/runs" \
  -f per_page=100 > "$tmp/runs.json"
jq --arg events "$events" --argjson n "$run_number" --argjson repo "$repo_id" \
  --slurpfile stack "$tmp/stack.json" '
  ($events | split(",")) as $allowed |
  $stack[0].pull_requests[:-1] as $lower |
  [.[] | .workflow_runs[] | . as $run |
    select(.run_number < $n and .status != "completed" and .head_repository.id == $repo) |
    select(.event as $e | $allowed | index($e)) |
    $lower[] | . as $member | select(.head.ref == $run.head_branch and .head.repo.id == $repo) |
    select(($run.pull_requests | length) == 0 or
      any($run.pull_requests[]; .number == $member.number)) |
    {run: $run, pr: .number}] | unique_by(.run.id)[]' "$tmp/runs.json" > "$tmp/candidates.jsonl"

cancelled=0
failed=0
while IFS= read -r candidate; do
  id=$(jq -r '.run.id' <<< "$candidate")
  lower_pr=$(jq -r '.pr' <<< "$candidate")
  candidate_sha=$(jq -r '.run.head_sha' <<< "$candidate")
  candidate_attempt=$(jq -r '.run.run_attempt // 1' <<< "$candidate")
  # PR runs have an explicit association. Push runs need commit/PR evidence.
  if [[ $(jq '.run.pull_requests | length' <<< "$candidate") != 0 ]]; then
    jq -e --argjson pr "$lower_pr" 'any(.run.pull_requests[]; .number == $pr)' <<< "$candidate" > /dev/null || continue
  else
    api --method GET --paginate --slurp "$root/commits/$candidate_sha/pulls" -f per_page=100 > "$tmp/associated.json"
    jq -e --argjson pr "$lower_pr" --argjson repo "$repo_id" \
      'any(.[][]; .number == $pr and .head.repo.id == $repo)' "$tmp/associated.json" > /dev/null || continue
  fi
  api "$root/stacks/$stack" > "$tmp/fresh-stack.json"
  if ! diff -q <(jq -cS '{base, pull_requests: [.pull_requests[] | {number,state,head}]}' "$tmp/stack.json") \
      <(jq -cS '{base, pull_requests: [.pull_requests[] | {number,state,head}]}' "$tmp/fresh-stack.json") > /dev/null; then
    note 'Stack state changed. Stopped further cancellation.'
    exit 1
  fi
  api "$root/actions/runs/$id" > "$tmp/victim.json"
  jq -e --argjson workflow "$workflow" --argjson n "$run_number" \
    --argjson repo "$repo_id" --argjson attempt "$candidate_attempt" --arg sha "$candidate_sha" --arg events "$events" '
    .workflow_id == $workflow and .run_number < $n and .status != "completed" and
    .head_repository.id == $repo and .head_sha == $sha and (.run_attempt // 1) == $attempt and
    (.event as $e | $events | split(",") | index($e))' "$tmp/victim.json" > /dev/null || continue
  if [[ "$dry_run" == true ]]; then
    note "Would cancel run $id on lower PR #$lower_pr in stack #$stack."
    continue
  fi
  if ! api --method POST "$root/actions/runs/$id/cancel" > /dev/null; then
    # Another top-PR run can finish cancellation between the read and request.
    api "$root/actions/runs/$id" > "$tmp/result.json"
    if jq -e '.status == "completed"' "$tmp/result.json" > /dev/null; then
      note "Run $id already finished with conclusion $(jq -r '.conclusion' "$tmp/result.json")."
      continue
    fi
    note "Cancellation request failed for run $id."
    failed=1
    continue
  fi
  note "Requested cancellation of run $id on lower PR #$lower_pr in stack #$stack."
  confirmed=false
  for ((attempt = 0; attempt < 20; attempt++)); do
    api "$root/actions/runs/$id" > "$tmp/result.json"
    if jq -e '.status == "completed"' "$tmp/result.json" > /dev/null; then
      note "Run $id finished with conclusion $(jq -r '.conclusion' "$tmp/result.json")."
      confirmed=true
      break
    fi
    sleep 3
  done
  if [[ "$confirmed" == false ]]; then
    note "Run $id has not finished yet; cancellation is unconfirmed."
    failed=1
  fi
  cancelled=$((cancelled + 1))
done < <(jq -c '.' "$tmp/candidates.jsonl")
note "Stack #$stack top PR #$pr: $cancelled cancellation requests; dry-run=$dry_run."
exit "$failed"
