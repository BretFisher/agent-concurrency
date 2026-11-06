# Agent Concurrency Management

Agents can create PRs and commit updates faster than CI finishes. Each event can start another workflow run, leaving obsolete validation jobs active at the same time. Small PRs can help people review changes, but stacks add more cumulative revisions and update events.

The cost problem includes lint, unit tests, integration tests, E2E, CVE scans, and repeated runner setup. The aim is to stop redundant work, not to prevent every job from starting. Brief overlap can be acceptable; cancellation timing is not guaranteed.

## Goals

1. Cancel obsolete job runs for new commits within the same PR.
2. Cancel superseded job runs for all PR commits in the stack except the latest commit on the top PR.

These are design goals. The comparison below separates tested behavior from proposed behavior. GitHub's cancellation API targets a **workflow run**, which contains job runs; canceling that workflow run can stop its jobs together.

## Compare the techniques

| Technique | What it does | Main benefit | Main limit | Status in this repo |
| --- | --- | --- | --- | --- |
| Native concurrency | Cancels older workflow runs or job runs within a stable group | Simple first step for ordinary PR updates; can stop many validation jobs together | Scheduling order is not current-commit order. A standalone-to-stack key change leaves earlier runs outside the new group. | Per-PR and selected stack-tip supersession tested live |
| Current-state API cleanup | Queries current membership and heads, then cancels proven obsolete runs in selected workflows | Can cover lower layers, old commits, equivalent duplicates, and earlier standalone-key runs once membership is known | Needs explicit scope, pagination, fresh reads, retries, and a runner. Unknown membership must not cause guessed cancellations. | Proposed method; no cleanup engine implemented |
| Retired required-deployment experiment | Requires successful deployment evidence before merging | Separates merge permission from the decision to start or cancel validation | Does not cancel work. Successful tip deployment did not satisfy the lower layer in this repo's native stack test. | Retired; negative cases and standalone merging tested, native stack inheritance not reproduced |

Automatic and opt-in triggering are separate policy choices. Either can be combined with selection, cancellation, and merge controls.

## Native concurrency: start with one PR

Use a stable workflow-and-PR key for PR validation. A new run in that group requests cancellation of the previous run. Do not put the commit SHA in the group: each commit would then get its own group and avoid supersession.

This fragment teaches the grouping mechanism for a PR-triggered workflow:

```yaml
concurrency:
  group: ${{ github.workflow }}-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

Separate workflow identities preserve distinct validation work. Releases and state-changing deployments need their own deliberate concurrency policy. A late event or rerun can still arrive out of order; native concurrency alone does not establish which commit is current. [GitHub concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

The stack example adds a stack-wide group only after a tip check. Only runs that pass the tip check enter that group. The check and job scheduling are not atomic. This reduced obsolete work in the tested sequence, but did not solve every transition: a run that started before its PR joined the stack used a different key. [Cancellation evidence](docs/evidence.md).

## Current-state cleanup: select before canceling

A proposed metadata-only cleanup workflow would:

1. Load an explicit allowlist of validation workflows and exclusions.
2. Read current PR identities, complete native membership, head SHAs, trunk SHA, and linear history.
3. Select the desired current run separately for each validation workflow and execution contract.
4. Recheck state before canceling old-head, lower-layer, or equivalent duplicate runs. Include earlier standalone-key runs belonging to verified members.
5. Confirm cancellation outcomes and retry bounded failures. Ensure the desired current validation starts through its automatic trigger path.

One current run for lint and another for scanning can both be required. Keeping one arbitrary run across the repository would discard validation. Exclude cleanup jobs, final reporters, releases, and unrelated PRs. A privileged canceller must not execute PR code or PR-controlled artifacts.

Before native membership exists, cross-PR cancellation needs a trusted declared grouping. Timing, a shared author, or similar branch names do not prove that PRs belong together. When identity or membership is unknown, leave runs untouched and retry. Runner saturation and API failures can delay cleanup; measure overlap instead of promising a fixed cancellation time.

The [implementation guidelines](docs/ci-methodology.md) describe the proposed algorithm, permissions, race cases, and acceptance tests. The [source study](docs/ci-source-study.md) examines four existing implementations without adding them as runtime dependencies.

## Choose when validation starts

| Trigger policy | Benefit | Trade-off |
| --- | --- | --- |
| Automatic | Starts validation as relevant PR or commit events arrive; avoids a forgotten manual request | Temporary tips can start work before the stack is complete. Selection and cancellation must follow current state. |
| Opt-in | Delays selected work until an explicit request, such as after the agent finishes creating a stack | A missing request leaves validation undone. New commits or rebases need fresh evidence and another request. |

This choice can apply to every selected validation category. The current opt-in example uses E2E to demonstrate exact-revision requests. Opt-in triggering is not a cancellation mechanism or merge authorization by itself. A dispatched workflow does not automatically satisfy required PR status checks. [GitHub required-check rules](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

## Validate the combined change

Stack-tip validation must cover the full net change from trunk to the exact current top head. A layer's PR changed-files API can omit lower-layer files. The demo records a full-history `git diff BASE...HEAD` and tests an explicit head SHA. [Full-stack diff evidence](docs/evidence.md#native-stack-and-full-diff).

If a lower PR changes before the top is rebased, that top does not represent the complete current stack. Do not certify it as the combined change. Content equality is also a separate question: the same Git tree does not prove equivalent validation across toolchains, event inputs, base revisions, environments, or changing vulnerability data.

For the intended tip-only validation mode, the chosen policy is **whole-stack-only merging**. This policy is not implemented or proven here. GitHub natively allows merging a selected PR and its lower prefix; it does not require the complete stack. A successful top test is not proof that every intermediate prefix is safe to merge. [Native merge scope](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks).

## Merge enforcement: preserve the failed result

GitHub [documents required-deployment inheritance](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests) for lower PRs in a linear stack. This repo did not reproduce that behavior:

- Missing, failed, and stale deployment evidence blocked merging.
- A canceled E2E workflow produced deployment failure.
- An exact top SHA passed E2E and had an active successful deployment, but the full native stack merge remained blocked by the lower layer.
- Standalone PRs passed the same active gate and merged without bypass.

The experiment used per-layer cheap checks to isolate deployment behavior. That configuration is not a general requirement for a future tip-only cost policy. A skipped job can report success without testing; copying successful statuses to lower commits would not establish validation.

Read the [deployment evidence](docs/deployment-evidence.md) and [detailed gate walkthrough](docs/required-deployment.md). The experimental protection was removed after the failed inheritance proof. The environment, workflow files, and historical records remain for inspection. The two failed deployment-demo PRs are retained for inspection. This is not a proven stack-wide merge solution or proof that GitHub can never provide one.

## What the demo proves

A small Go HTTP application supplies real response assertions. A clearly labeled 90-second setup delay makes selected cancellation cases visible; the delay proves no application behavior. The deployment experiment uses an ephemeral runner and records the tested revision; it deploys no persistent external service.

Validation runs with read-only access. Separate API-only reporting checks the completed result and current revision before writing deployment status. This keeps deployment-write access away from PR code. Broader metadata cleanup and whole-stack-only merge enforcement remain design work, not hidden features of the current workflows.

MIT license. See [LICENSE](LICENSE).
