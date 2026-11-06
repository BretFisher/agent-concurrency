# Required deployment: live evidence

**Result:** the gate blocked missing, failed, canceled, and stale deployment evidence. Standalone PR #9 merged through it. However, successful active deployments for the exact native stack tip did **not** permit the lower PR to merge. Native deployment inheritance was not reproduced with this API-driven simulated deployment setup. No bypass or rule removal was used to make the stack merge.

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

The top PR is advanced by this evidence commit before attempting the stale-evidence merge test. The prior deployment still names the earlier SHA. The results below record the stale-head rejection and the later merge attempts.

## A new head invalidated the earlier success

PR #7 advanced to `d717ee339c8e4963d121021ec2ff775554c6898b`. The [new cheap suite 42159741268](https://github.com/BretFisher/agent-concurrency/actions/runs/42159741268) passed. Deployment **7591949719** still had `success` for the old `3ea9b74` SHA, and no deployment existed for the new head.

A third `make stack-merge STACK=8` attempt was rejected with `Missing successful active stack-e2e deployment.` Nothing merged. This proves that the earlier top deployment did not authorize the new head in this native stack.

[Source 42159853978](https://github.com/BretFisher/agent-concurrency/actions/runs/42159853978) was then requested explicitly for `d717ee339c8e4963d121021ec2ff775554c6898b`. The results of that request and the protected merge attempts are recorded below.

## SHA-only deployment did not provide inheritance

Source **42159853978** and [result 42160046901](https://github.com/BretFisher/agent-concurrency/actions/runs/42160046901) passed. Deployment **7591990350** had SHA `d717ee339c8e4963d121021ec2ff775554c6898b`, latest status `SUCCESS`, and GraphQL state `ACTIVE`. PR #7 was clean. PR #6 remained blocked, and two more native stack merge attempts still returned the missing-deployment error.

The GraphQL deployment `ref` was `null`: this record used a SHA-only deployment reference. Thus exact SHA success was sufficient for the top PR itself, but did not give the intended lower-layer inheritance in this test.

[Fix PR #9](https://github.com/BretFisher/agent-concurrency/pull/9) changed the API request to use `pr.head.ref`, then immediately checks that the resolved deployment SHA equals the immutable requested SHA before testing. This preserves branch association without accepting a moved branch. The fix passed [source 42160330679](https://github.com/BretFisher/agent-concurrency/actions/runs/42160330679), [result 42160500732](https://github.com/BretFisher/agent-concurrency/actions/runs/42160500732), and its required cheap checks. It merged through the still-active gate as a standalone PR. No rule or bypass setting changed.

Stack #8 was rebased onto the fix at `1b5d45e91cca57e9ac505474d746e3fad4e23d63`. Its lower head became `b77d090369830829c680e79caea416621eedf53a`; its top became `b6065a71d96a8f931741aa4f4cfdac3c1d8c1dd1`. [Source 42160560905](https://github.com/BretFisher/agent-concurrency/actions/runs/42160560905) tests that exact new top through the corrected workflow.

## Branch-associated exact SHA

The corrected [source 42160560905](https://github.com/BretFisher/agent-concurrency/actions/runs/42160560905) and [result 42160737435](https://github.com/BretFisher/agent-concurrency/actions/runs/42160737435) passed. Deployment **7592086904** recorded ref `deployment-demo/request` and SHA `b6065a71d96a8f931741aa4f4cfdac3c1d8c1dd1`. GraphQL returned that branch under `refs/heads/` instead of `null`.

The workflow supplied a branch reference, but accepted the deployment only because the API-resolved SHA exactly matched the immutable request. This evidence update advances the top again so the stale-head merge test can be repeated against the corrected binding. Lower-layer inheritance is not claimed until the final atomic merge succeeds.

## Corrected binding also rejected a stale head

The top advanced to `2caae5bee954f91ae91570b875ae504ae02d09b7`. Its [cheap suite 42160837868](https://github.com/BretFisher/agent-concurrency/actions/runs/42160837868) passed. Deployment **7592086904** still had `success` for the previous `b6065a7` commit.

A direct call to `PUT /repos/BretFisher/agent-concurrency/pulls/7/merge-async` specified the new exact SHA, `merge_action: direct_merge`, `merge_method: squash`, and `bypass_rules: false`. Request UUID **7f1dde52-8876-4411-b5b1-c69e667d6da1** returned `failed` with `Missing successful active stack-e2e deployment.` The stack API confirmed both PRs remained open.

This repeats the stale-head test for the corrected branch-associated binding. The earlier successful deployment did not authorize the new top revision.

## Final direct API attempt: inheritance was not reproduced

The final [source 42161028831](https://github.com/BretFisher/agent-concurrency/actions/runs/42161028831) and [result 42161204934](https://github.com/BretFisher/agent-concurrency/actions/runs/42161204934) both passed. Deployment **7592150788** recorded:

```json
{
  "environment": "stack-e2e",
  "ref": "deployment-demo/request",
  "sha": "2caae5bee954f91ae91570b875ae504ae02d09b7"
}
```

GraphQL confirmed `state: ACTIVE`, `latestStatus.state: SUCCESS`, the same `commitOid`, and a non-null branch ref under `refs/heads/`. PR #7 was clean. The lower head `b77d090369830829c680e79caea416621eedf53a` had no deployment. Both layers had passed their required cheap checks. The stack was linear: trunk `1b5d45e...` → lower `b77d090...` → top `2caae5b...`.

A direct asynchronous merge request for PR #7 used its exact current SHA, `merge_method: squash`, `merge_action: direct_merge`, and **`bypass_rules: false`**. Request UUID **8679512c-f511-49f6-b021-686de2bb0b4c** returned:

```json
{"status":"failed","details":{"message":"Missing successful active stack-e2e deployment."}}
```

The API confirmed that PRs #6 and #7 remained open and unmerged. The ruleset stayed active with no bypass actors. Its `updated_at` value remained `2026-11-05T22:52:11.381-05:00` throughout all proof attempts. The rule was not weakened to produce a merge.

**Proven findings:** the exact-head gate worked for the standalone fix PR; missing, failed, canceled, and stale evidence did not authorize the stack merge; both SHA-only and branch-associated successful tip deployments failed to provide the expected lower-layer inheritance in this configuration.

**Untested hypotheses:** an additional deployment association or another GitHub-specific deployment setting may be needed, or the preview behavior may differ from the documentation. The branch-ref hypothesis alone did not solve the failure. This result does not prove the feature never works on GitHub. No alternative deployment flags, hosted preview service, or copied lower-layer successes were used to conceal the failure.

## State and limits

- PR #9 merged after passing the active gate. Native stack #8 PRs #6 and #7 are left open for inspection, not merged or bypassed.
- The current environment and active ruleset remain in place. `E2E_MODE=deployment` selects this demo's per-PR cheap checks. That setting is an experimental configuration here, not a recommendation to repeat every validation category per PR.
- Publishing this evidence in a separate PR advances `main`; stack #8 will need a rebase before a new reproduction attempt. The JSON snapshot preserves the exact linear state used for the failed merge proof.
- [Raw API observations](deployment-observations.json) preserve the ruleset, member SHAs, deployment payloads and status histories, and final merge failures. Async merge results expire after 24 hours, so the response is saved here.
- The deployment is simulated on an ephemeral Actions runner. The HTTP assertions are real. No persistent service, cloud account, or secret was used.
- Native stacks support partial merges. This environment rule does not impose a whole-stack-only merge policy. That policy needs a separate design and proof.
- There is no metadata cleanup workflow in this repo. The earlier standalone-to-stack concurrency-key transition remains a gap. A future cleanup design must scope selected validation workflows, query current membership and heads, preserve reporters/releases/unrelated PRs, and stop guessing when membership is unknown. No such feature was added during this deployment test.

## Verification

`make check`, ShellCheck, and GolangCI-Lint passed locally. Twelve local API-mock logic checks covered success, failure, cancellation, timeout, stale or changed members, non-linear stacks, wrong workflow provenance, and a branch-resolution SHA race. These mocks are not live merge proof.

Zizmor, Poutine, and release-pin checks passed with the documented scoped exceptions. The API-only result workflow has a `dangerous-triggers` exception because it uses `workflow_run`; it performs no checkout, artifact read, or PR code execution. Poutine's earlier read-only test exception remains scoped to the shared workflow. Actionlint 1.7.12 still rejects the newer `$/.github/...` syntax; all remaining rules passed when only that diagnostic was filtered. GitHub executed the calls. No tools were installed or upgraded.
