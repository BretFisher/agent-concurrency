# Job pruning in stacks: implementation guide

This guide describes three independent prune options for job pruning in stacks. Each option has a different implementation and effect. You can use one or combine them; the numbers do not specify rank, difficulty, or an adoption sequence. The TypeScript Prune Option 3 replaces the earlier same-workflow Bash experiment. [Stack workflow test findings](stack-tests.md) contains the exact live evidence. [The source study](ci-source-study.md) explains the earlier implementation comparisons.

## Prune Option 1: new commits within one branch or PR

Purpose: cancel any previously-started, yet still active runs of this workflow on the same branch.

```yaml
# cancel any previously-started, yet still active runs of this workflow on the same branch
concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true
```

The key stays stable across revisions. Ordinary PR events use a PR merge ref; pushes and dispatches use a branch or tag ref. Different workflows keep different keys. A SHA in the key would prevent supersession. Scheduling order is not an authoritative current-head check. [GitHub concurrency documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Prune Option 2: prevent jobs on known lower PRs

Use only the job condition from [Stack If Probe](../.github/workflows/stack-if-probe.yaml). Keep the workflow's existing triggers. Combine this condition with an existing job condition using `&&` rather than replacing the existing condition.

```yaml
if: >-
  ${{ github.event_name != 'pull_request' ||
      github.event.pull_request.stack == null ||
      github.event.pull_request.stack.position == github.event.pull_request.stack.size }}
```

An ordinary PR or top PR runs. A known lower PR skips. Runs without PR stack metadata continue normally. There is no workflow-level `if:`; a condition on a reusable-workflow caller job can cover all its called jobs. This filter adds no workflow runs, jobs, API calls, or write permissions. A skipped check is not evidence that validation ran.

The CLI pushes branches, creates PRs, then links the native stack. Opening runs can therefore occur before the PR is a member of a stack. The attached metadata does not refresh when the job starts, so Prune Option 2 does not reliably prevent initial opening jobs. Later PR updates after linking can include the PR’s stack position and allow the filter to skip lower-PR jobs. The [runner-start timing check](stack-tests.md#runner-start-timing-check) verified that the opening event still lacked stack data even though the stack existed before both jobs started.

A job that started while its PR was top is not re-evaluated when a new PR joins above it. The condition makes no cancellation requests and does not inspect current stack state through the API. The [findings](stack-tests.md) retain the earlier trigger experiments separately from this condition-only adoption advice.

## Prune Option 3: stacked-only prune workflow

Use the [copyable Prune Option 3 workflow](../README.md#prune-option-3-cancel-active-workflow-runs-on-lower-prs-of-a-stack). It has one job and one step calling the bundled TypeScript action. It listens only for `pull_request` with `types: [stacked]`. Existing work workflows keep their triggers and jobs. The action does not invoke them or copy their results.

### Discover workflows by opt-in

Read active workflow IDs and paths through the API. Resolve the default branch to one commit, then parse workflow files at that commit. Only the literal workflow-level `env.ALLOW_STACK_WORKFLOW_PRUNE: "yes"` allows selection. `"no"` and an absent declaration preserve the workflow. Job-level declarations, expressions, booleans, malformed YAML, and ambiguous duplicate keys cannot opt in a workflow.

An explicit `policy-ref` input can select a full trusted commit SHA for an isolated test. Mutable branch overrides are rejected. The normal example omits this input and reads the default branch. A new declaration must reach that branch before normal pruning can use it. A workflow file absent from that revision is treated as a missing opt-in, not as an error. The action also requires the top and candidate workflow file contents to match the trusted definition. A workflow changed in an unmerged PR is preserved, because its jobs may have changed.

The action requires no central workflow list. `warn-on-missing-opt-in: "yes"` adds missing declarations to the summary and emits a grouped warning. It defaults to `"no"`. There is no required declaration check and no need to edit excluded workflows. Invalid declarations are reported and preserved. GitHub-managed dynamic workflows are excluded.

### Select current stack work

1. Accept only a `pull_request.stacked` invocation from the same repository.
2. Read the joining PR and its current stack through the API. Confirm a consistent ordered set of open same-repository PRs and its current top.
3. Verify that the top contains every current lower head through the compare API.
4. For each opted-in workflow, paginate its run history and find a run for the top PR's exact current head, branch, and repository. Its source event must be `pull_request` or `push`. It must be active or have completed successfully. A push needs commit-to-PR association when no explicit PR association is present.
5. If the top run is not visible, repeat the scan twice, two seconds apart. If no suitable run appears, preserve lower work and report the skip.
6. Select active lower-PR runs of this same target workflow, with allowed source events and verified PR association. Only runs created strictly before the prune run's API creation timestamp are eligible. Equal timestamps and later runs are preserved. Run numbers from different workflows are never compared.
7. Re-read stack state, replacement run, candidate identity and attempt before cancellation. Preserve changed attempts and stop further requests if the stack changes.

The prune invocation can come from any joining PR. It reads the current top rather than assuming the joining PR is still top. Concurrency serializes pruning for each stack with `cancel-in-progress: false`. GitHub can replace a pending invocation; every active invocation reads current state. Repeated events are handled by state checks and cancellation-race handling.

### Report cancellation accurately

Collect job data for each selected run attempt. Request all cancellations before checking their outcomes. A successful request means acceptance, not a confirmed stop. The action reports accepted/pending, finished/cancelled, already finished, failed requests, interrupted validation, and dry-run proposals separately. API errors fail the prune job and remain in the summary.

The prune summary includes the joining PR, stack, trusted policy commit, affected workflow, lower PR, branch, commit, run and attempt, replacement top run, reason, request time, and linked observed job states. Completed jobs are not described as canceled. A confirmed canceled state does not by itself prove which concurrent actor caused it. A structured copy of the report is also written to the prune job log. The canceled run's own summary is not modified.

### Permissions and trusted code

The prune job has Actions write, contents read, and PR read permissions. Its workflow starts with `permissions: {}` and grants these permissions only to that job. It executes a SHA-pinned bundled action, with no PR checkout or artifact execution. Other workflows retain their permissions.

TypeScript source is compiled and bundled before publication. The action's Node runtime executes the bundled JavaScript. Adoption requires no shell script download, gh, jq, compiler installation, or runtime package installation. Source, tests, the package lock, bundle, and dependency license notices are retained in the repository.

## Full-stack validation is required

Existing and future diff-aware workflow specifications must cover the full net change from the stack's merge target to the top head. Use the current stack base SHA and sufficient history for `git diff BASE...HEAD`. A top PR's individual changed-files list can omit lower-layer files. Verify the effective diff behavior of any third-party lint or test action.

Run validation against the complete top content. If a lower PR changed and the top has not been rebased, its content is incomplete; the TypeScript implementation leaves the lower work running. Its ancestry check is a cancellation safeguard, not proof that every selected validation category actually covers every file.

## Scope and limits

- The trigger covers PRs joining a new or existing stack. It does not run for ordinary commits. Removal and reorder signals are not established by these tests.
- A missing replacement after the bounded retry preserves lower work. This is not a continuous reconciliation service.
- Cancellation targets whole workflow runs, including their jobs. Opt in only when top-PR jobs can replace the lower work.
- Manual dispatches are not cancellation targets. A manual rerun keeps its original event type; it is not equivalent to a dispatch. Changed run attempts are preserved during a scan.
- API reads and cancellation are not atomic. A stack or run can change after the last check; report the remaining race rather than claiming a transaction.
- Cancellation is asynchronous; there is no fixed stop-time guarantee.
- These mechanisms do not enforce whole-stack-only merging or transfer successful checks to other commits.

## Earlier Bash experiment

The [Bash script](../scripts/cancel-lower-stack-runs.sh) and [Stack Cancel Demo](../.github/workflows/stack-cancel.yaml) retain the earlier same-workflow implementation and its tests. That job could complete before stack linking and miss initial creation. It is historical test code, not the revised Prune Option 3 adoption path. See [agent instructions](../AGENTS.md) for development and reproduction commands.
