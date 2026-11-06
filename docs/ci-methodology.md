# CI concurrency implementation guide

This guide separates three tested mechanisms. [Stack workflow test findings](stack-tests.md) contains the exact live evidence. [The source study](ci-source-study.md) explains the earlier implementation comparisons.

## Level 1: new commits within one branch or PR

Purpose: cancel any previously-started, yet still active runs of this workflow on the same branch.

```yaml
# cancel any previously-started, yet still active runs of this workflow on the same branch
concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true
```

The key stays stable across revisions. Ordinary PR events use a PR merge ref; pushes and dispatches use a branch or tag ref. Different workflows keep different keys. A SHA in the key would prevent supersession. Scheduling order is not an authoritative current-head check. [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Level 2: prevent jobs on known lower PRs

Use the [Stack If Probe](../.github/workflows/stack-if-probe.yaml) pattern. Keep your existing trigger types and add `stacked`. Without explicit types, GitHub's default PR activities omit it.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, stacked]
```

On each selected job, combine existing conditions with:

```yaml
if: >-
  ${{ github.event_name != 'pull_request' ||
      github.event.pull_request.stack == null ||
      github.event.pull_request.stack.position == github.event.pull_request.stack.size }}
```

An ordinary PR or top PR runs. A known lower PR skips. Non-PR events run. There is no workflow-level `if:`; a condition on a reusable-workflow caller job can cover all its called jobs. A skipped check is not evidence that validation ran.

The CLI pushes branches, creates PRs, then links the native stack. Opening events can therefore omit membership. `github.event` remains the original event data even if a job waits for a runner. An API lookup can already see membership while that event still has `stack: null`.

A `stacked` event creates another run after membership exists. With Level 1, it can supersede the earlier opening run on the same PR ref. The lower replacement skips validation. The top replacement runs. This works for PR runs; initial push runs use different refs and need Level 3 if they should stop. A former-top PR run can also continue after extension if that PR gets no replacement event of its own.

I verified `pull_request: stacked` directly in GitHub Actions for both initial creation and extension. The generic Actions reference and installed actionlint schema omitted this activity, but live delivery succeeded. The dedicated [event probe](../.github/workflows/stack-event-probe.yaml) records the evidence. GitHub separately documents the webhook activity in its [stack rollout guide](https://docs.github.com/en/pull-requests/tutorials/roll-out-stacked-prs#5-update-your-programmatic-tooling).

## Level 3: cancel earlier runs on lower PRs

The implemented contract is narrow:

1. The current run's event is allowed. Defaults are `pull_request,push`.
2. Its exact source repository, branch, and head identify one current open PR.
3. That PR is currently the native stack's top PR.
4. The top contains every current lower head.
5. Cancel earlier, still-active runs of this same workflow on verified lower member PRs, restricted to allowed candidate events.

Otherwise, make no cancellation requests. The script has no validation-skip output. Its job is independent of all validation jobs.

Copy the `cancel` job from [Stack Cancel Demo](../.github/workflows/stack-cancel.yaml), with the [Bash script](../scripts/cancel-lower-stack-runs.sh) on your trusted default branch. The demonstration includes a repository-variable enable switch. Change the workflow job's event condition and `STACK_CANCEL_EVENTS` together if you need a different event policy. Changing allowed events does not add workflow triggers by itself.

The useful job `if:` filters events. Stack membership and top position are checked through the API inside the step. Do not require event stack metadata here: that would miss the opening-event transition the API check is intended to handle.

The script uses the current run's numeric workflow ID. It paginates that workflow's history and treats run number only as evidence of earlier creation. It does not select the current top by timestamps. PR candidates need matching member and repository association. Push candidates also need commit-to-PR association. Missing or ambiguous identity remains untouched.

It rechecks membership and member heads before each request, refreshes the candidate's state and attempt, and handles a run that finishes during cancellation. A changed stack stops further requests. API errors fail the cleanup job instead of silently claiming cancellation.

The cancellation API returns acceptance asynchronously. The script requests all selected cancellations before reporting current outcomes; it does not delay later requests while waiting for the first run. A successful job means requests were accepted. Pending outcomes are explicit. The live proof checks eventual run conclusions separately. No fixed cancellation-time guarantee is made.

## Permissions and trusted code

| Component | Permissions | Execution boundary |
| --- | --- | --- |
| Cancellation job | Actions write; contents read; PR read | One Bash step; no PR checkout or artifact execution |
| Validation jobs | Only required read access | Run PR code on separate runners |
| Event-only probe | PR read | Records metadata; performs no cancellation |

The cancellation step resolves the default branch to a commit, fetches the script at that commit, then executes it. The workflow has `permissions: {}` at its top level. Permissions are scoped to the job; GitHub has no step-scoped permission grant. The demonstration's validation job has no `needs: cancel` relationship.

The script requires Bash, gh, jq, diff, and core shell tools. The example uses a GitHub-hosted Ubuntu image with these tools. A custom runner must provide them. Do not fetch executable script content from the PR head for the write-capable job.

## Full-stack validation is required

Existing and future diff-aware workflow specifications must cover the full net change from the stack's merge target to the top head. Use the current stack base SHA and sufficient history for `git diff BASE...HEAD`. A top PR's individual changed-files list can omit lower-layer files. Verify the effective diff behavior of any third-party lint or test action.

Run validation against the complete top content. If a lower PR changed and the top has not been rebased, its content is incomplete; the Bash implementation leaves the lower work running. Its ancestry check is a cancellation safeguard, not proof that every selected validation category actually covers every file.

## Scope and limits

- Manual `workflow_dispatch` runs neither initiate nor become targets of Level 3 by default. Level 1 has its own workflow/ref behavior and can still cancel a manual run sharing that key.
- A manual rerun retains its original event type. Dispatch protection does not mean every manually requested rerun is excluded.
- The implemented job targets its own workflow only. A dedicated cleanup-only workflow triggered by `stacked` would need explicit target workflow IDs and a creation-time boundary suitable for those different workflows. That variant is not implemented here.
- There is no atomic transaction between reading stack state and requesting cancellation. A later lower-layer run can start after the scan and remain until another top invocation.
- The proven `stacked` event supplies creation and extension signals. This test does not establish separate removal, reorder, dissolution, or rebase activity types.
- These mechanisms control scheduling and cancellation. They do not implement whole-stack-only merging or transfer validation results to lower SHAs.

The earlier proposal for repository-wide reconciliation, duplicate-result reuse, and merge enforcement is outside this implementation. This Bash script implements the smaller current-workflow contract above. Run `make stack-cancel-test` for its local scope checks; see the [README command table](../README.md#test-and-use-the-script) for live use.
