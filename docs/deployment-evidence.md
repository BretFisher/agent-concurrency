# Required deployment: live evidence

Tested on November 5, 2026, America/New_York. GitHub timestamps below use UTC on November 6. This extends the earlier [CI cancellation evidence](evidence.md).

## Configuration during the proof

- Environment: [stack-e2e](https://github.com/BretFisher/agent-concurrency/deployments/activity_log?environments_filter=stack-e2e).
- Active ruleset: [Stack E2E gate, ID 26670578](https://github.com/BretFisher/agent-concurrency/rules/26670578), targeting `main`.
- `bypass_actors: []`; GitHub returned `current_user_can_bypass: "never"` for BretFisher.
- Required deployment environment: `stack-e2e`.
- Required cheap checks on each layer: `Fast PR Checks / Lint Full Stack` and `Fast PR Checks / Unit Test And Build`, from GitHub Actions.
- A pull request is required. Force pushes and branch deletion are blocked. No merge queue, approvals, cloud credentials, or environment secrets are involved.
- Environment protection rules were empty. Its `can_admins_bypass` flag concerns environment approvals, not the branch ruleset. The branch gate had no bypass.

## Native stack

`gh stack submit --auto --open` created native stack **#8** with these two PRs:

| PR | Position | Initial head |
| --- | --- | --- |
| [#6: lower policy](https://github.com/BretFisher/agent-concurrency/pull/6) | 1 of 2 | `1c13b32cca281a9cfc9225f2cf0a6697acbc4ae8` |
| [#7: upper request](https://github.com/BretFisher/agent-concurrency/pull/7) | 2 of 2 | `3ea9b747e0781104d730fdc4a62e17f4499b9812` |

Trunk was `main` at `f9e97cf8db6e3b5c3ba53c10d24235380db5aa67`. Both heads formed a linear history from trunk.

## Before deployment

The [lower cheap suite](https://github.com/BretFisher/agent-concurrency/actions/runs/42159140860) and [upper cheap suite](https://github.com/BretFisher/agent-concurrency/actions/runs/42159149084) passed. The deployment API returned an empty list for `stack-e2e`.

`make stack-merge STACK=8` submitted the native asynchronous stack merge. GitHub rejected it:

```text
Missing successful active stack-e2e deployment.
Stack merges are atomic, so nothing was merged.
```

This isolates the missing deployment requirement: both PRs already had their required cheap checks.

## Exact SHA and full-stack diff

[Failure-test source run 42159252096](https://github.com/BretFisher/agent-concurrency/actions/runs/42159252096) was dispatched from `main`, whose workflow SHA was `f9e97cf8db6e3b5c3ba53c10d24235380db5aa67`.

Its deployment object **7591912632** instead recorded:

```json
{
  "environment": "stack-e2e",
  "ref": "3ea9b747e0781104d730fdc4a62e17f4499b9812",
  "sha": "3ea9b747e0781104d730fdc4a62e17f4499b9812"
}
```

It started as `in_progress`. The payload recorded PR #7, stack #8, both member SHAs, the trunk SHA, run ID, and run attempt. The creator was `github-actions[bot]`. Checking out a PR did not implicitly change the dispatch revision; the explicit deployment API supplied the app SHA.

The [full-stack lint job](https://github.com/BretFisher/agent-concurrency/actions/runs/42159252096/job/127700757156) listed both demo files for `f9e97cf...3ea9b74`. The single-PR changed-files API listed only `docs/deployment-demo-request.md`. Full-history Git diff included the lower layer correctly.

## Failed E2E

`make deployment-request PR=7 FORCE_FAILURE=true` ran [source 42159252096](https://github.com/BretFisher/agent-concurrency/actions/runs/42159252096). The real `TestHTTPGreeting` assertion passed at 03:55:17Z. The clearly labeled fault-injection step then exited 1. The source concluded `failure`.

[Result workflow 42159411281](https://github.com/BretFisher/agent-concurrency/actions/runs/42159411281) read that final conclusion and set deployment **7591912632** to `failure` with description `Source E2E workflow concluded failure`.

A second native stack merge attempt returned the same missing-successful-deployment error. The stack API confirmed both PRs still open. A real test run plus an explicit failure therefore did not create green deployment evidence.

## Canceled source

[Source 42159470060](https://github.com/BretFisher/agent-concurrency/actions/runs/42159470060) opened deployment **7591941254** for the same top SHA. It was then canceled through GitHub Actions.

[Result workflow 42159546136](https://github.com/BretFisher/agent-concurrency/actions/runs/42159546136) read the final `cancelled` conclusion and set the deployment to `failure`. Its status history contained `in_progress`, then `failure`, and no `success`. This verifies the cancellation path for the source workflow. The reporter itself was not canceled.

## Successful initial head

[Source 42159531713](https://github.com/BretFisher/agent-concurrency/actions/runs/42159531713) passed lint, race tests/build, and HTTP E2E for initial top SHA `3ea9b747e0781104d730fdc4a62e17f4499b9812`.

[Result workflow 42159676772](https://github.com/BretFisher/agent-concurrency/actions/runs/42159676772) passed current-state validation and marked deployment **7591949719** `success`. Its description was `HTTP E2E passed for the unchanged current tip and full stack.` The lower head had no `stack-e2e` deployment.

The top PR is advanced by this evidence commit before attempting the stale-evidence merge test. The prior deployment still names the earlier SHA. The final evidence will record whether GitHub blocks that new revision and whether a fresh successful deployment permits an atomic merge while the rule remains active.
