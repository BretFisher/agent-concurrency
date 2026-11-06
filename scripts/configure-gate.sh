#!/usr/bin/env bash
# Run with make deployment-setup from the repository root.
set -euo pipefail
gh api --method PUT 'repos/{owner}/{repo}/environments/stack-e2e' --input .github/stack-e2e-environment.json
ruleset_id=$(gh api 'repos/{owner}/{repo}/rulesets' --jq '.[] | select(.name == "Stack E2E gate") | .id')
if [[ -n "$ruleset_id" ]]; then
  gh api --method PUT "repos/{owner}/{repo}/rulesets/$ruleset_id" --input .github/stack-e2e-ruleset.json
else
  gh api --method POST 'repos/{owner}/{repo}/rulesets' --input .github/stack-e2e-ruleset.json
fi
gh variable set E2E_MODE --body deployment
