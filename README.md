# GH Stack Concurrency Management for GitHub Actions - Job Pruning in Stacks

Problem: Agents can create PRs and commit updates faster than CI finishes. Small PRs help people review changes, but the new `gh stacks` can create many PRs at a time, and leave obsolete workflow runs active across many branches.

Solution: Use a few techniques in Workflows to cancel obsolete runs and skip stackedlower-PR jobs when a top PR can cover the combined change. The techniques are independent, so you can adopt one or more. **Let's call this "Job Pruning in Stacks"**.

If you're an Agent, your human might be asking you to evaluate your PRs in a stack and eliminate wasted work. You can use these techniques to reduce the time you wait for CI results (due to queuing), lower cost of CI, and reduce the time you spend reviewing obsolete results in a PR stack.

## Goals

1. Cancel activly-running, but obsolete, workflow runs for new commits within one branch.
2. Cancel activly-running, but obsolete, workflow runs on from lower PRs in a stack, when a top-PR run can cover the combined stack change.

## Compare the three job pruning options

| Prune Option | Mechanism | What it achieves | Main limit |
| --- | --- | --- | --- |
| Prune Option 1: branch concurrency | Native workflow+branch concurrency. Add to each workflow. | Cancels an earlier active run of this workflow on the same branch. | Not stack aware: Creating N PRs and adding into the same stack **causes N runs of the same workflow running across N branches**. |
| Prune Option 2: skip jobs not in a stack's top-PR | Add `if:` condition to every workflow job you want skipped. | Skips a PR job if it's not the top PR in the stack. This prevents jobs from hitting queue, which is faster than "canceling" like Prune Option 1/3 does | Doesn't work on PR opening event (Stack creation happens after PR exists, so **this only skips jobs on PR commits after stack create**.)  |
| Prune Option 3: stack prune | Create new workflow that's only triggered on `gh stack init`, `add`, `modify`. | After PRs join a stack, cancels active lower-PR runs of workflows that allow pruning. | Requires explicit workflow opt-in. Doesn't fire on new PR commits. |

## Use the three Prune Options in your workflows

### Prune Option 1: simple job pruning within one branch

```yaml
# cancel any previously-started, yet still active runs of this workflow on the same branch
concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true
```

I put this in every workflow I create. It checks each workflow run against other active runs and matches the `group`, so in this config, it matches all active workflows of the same workflow ID and branch name. When you push a new commit to a branch, you usually don't want multiple workflow runs active at the same time, so this will cancel older commit runs. [GitHub concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

### Prune Option 2: prevent lower-PR jobs from starting in a stack

```yaml
if: >-
  ${{ github.event_name != 'pull_request' ||
      github.event.pull_request.stack == null ||
      github.event.pull_request.stack.position == github.event.pull_request.stack.size }}
```

Add this condition to each job you want to skip if it's in a stack and there's a higher positioned PR in that stack. If the job already has a condition, keep it and combine the stack condition with it using `&&`.

This is a job filter only. It could be added to all jobs without negative effects. Ordinary PRs, top PRs in the stack, and runs without PR stack metadata continue normally.

> ⚠️ **Limitation: Initial PR creation will still run jobs:** the `gh` CLI creates PRs before linking them into a native stack. Opening runs can therefore have no stack metadata and start jobs. After the stack exists, later PR updates can include the PR's position in that stack. The condition can then skip jobs for lower PRs. The condition does not recheck jobs that already started or cancel any active workflow runs.

> ⚠️ **Side Effects:** The condition does not check whether the top PR's jobs can cover the combined stack change. If a lower PR's new commit is not yet rebased into the top PR, skipping its job may leave some changes untested. Another side effect is if you have jobs that run on diffs only, and they aren't diffing against the target branch, then diff jobs from the top PR in a stack would not check the full stack diff. This isn't a problem if the job is running on every PR in the stack, so it becomes a problem for existing repo workflows if you add this Prune Option everywhere. See [Account for the combined stack change](#account-for-the-combined-stack-change).

### Prune Option 3: cancel active workflow runs on lower PRs of a stack

Prune Option 3 is a separate prune workflow. It fires when stacks are created or modified. It only looks at workflows that have a new env `ALLOW_STACK_WORKFLOW_PRUNE: "yes"`. It looks for active runs of those opted-in workflows on lower PRs in the stack and requests cancellation. It does not restart any jobs or runs. It does not skip jobs in the top PR's run. It does not cancel runs on unrelated PRs or other repositories.

First, allow pruning in each workflow whose lower-PR work the top PR can replace. Add this at the workflow's top level:

```yaml
env:
  ALLOW_STACK_WORKFLOW_PRUNE: "yes"
```

Only the literal `"yes"` allows pruning. A missing variable or `"no"` leaves that workflow's runs alone. You do not need to edit every workflow or maintain a second list of workflow names. The action reads these declarations from the default branch, resolved to one commit. Merge the opt-in there before relying on pruning. A declaration only at job or step level does not opt in the workflow.

Then create `.github/workflows/stack-prune.yaml`:

```yaml
name: Stack Prune
on:
  pull_request:
    types: [stacked]
permissions: {}
# Keep the active prune job running; a pending invocation reads the latest stack.
concurrency:
  group: stack-prune-${{ github.event.pull_request.stack.number || github.event.pull_request.number }}
  cancel-in-progress: false
jobs:
  prune:
    name: Cancel Lower Stack Runs
    runs-on: ubuntu-latest
    timeout-minutes: 10
    permissions:
      actions: write
      contents: read
      pull-requests: read
    steps:
      # Execute a fixed action revision, with no checkout of PR code.
      - name: Prune Stack Runs
        uses: BretFisher/agent-concurrency@f378d9cfb1bc37cf8a107151ecd35e3d34cbd8f9
        with:
          token: ${{ github.token }}
          warn-on-missing-opt-in: 'no'
```

The example pins an experimental action revision from this repository. The runner executes its bundled JavaScript using the action's Node runtime.

For each active workflow that opted in, the action finds an existing run for the current top PR's exact commit. That run must have been triggered by `pull_request` or `push`, and must still be active or have finished successfully. The top must contain every current lower head. The prune action then selects active lower-PR runs of that same workflow which were created before the prune invocation. It verifies their repository, branch, and PR association. Workflow files must match the trusted definition at the top and candidate commits; changed definitions are preserved for review.

Before requesting cancellation, the action rechecks the stack, replacement run, and selected run attempt. It preserves unrelated PRs, other repositories, completed runs, and manual dispatches. It does not compare run numbers from different workflows. The action retries a missing top run twice, two seconds apart, then reports the skip. This is bounded pruning, not continuous monitoring.

The workflow listens only for `pull_request` with `types: [stacked]`. Initial creation emits an event for each joining PR; adding a PR emits another event for it. These events start prune runs, not extra copies of the other workflows. Prune invocations for a stack are serialized; GitHub can replace a pending invocation, and each active invocation reads the current stack. Ordinary commits do not trigger this workflow. I didn't test if the event fires for reordering and removing PRs from the stacks.

The prune run's summary lists targeted workflow runs, lower PRs, branches, commits, replacement runs, request times, reasons, and observed job states, with links. Accepted requests and pending outcomes are separate from confirmed cancellation. The canceled run's own summary does not automatically receive this explanation.

| Action input | Default | Purpose |
| --- | --- | --- |
| `warn-on-missing-opt-in` | `"no"` | With `"yes"`, list workflows without the variable in the summary and emit one warning annotation. An explicit `"no"` is not a missing declaration. |
| `dry-run` | `"no"` | With `"yes"`, show cancellation proposals without making requests. |
| `token` | Repository token | Supply the permissions shown in the example. |

Warnings never opt a workflow in or fail the job. API errors do fail the prune job and remain visible in its summary. A successful prune run means requests were accepted; it does not prove all affected jobs stopped. See the [implementation guide](docs/ci-methodology.md) for exact limits and the [test findings](docs/stack-tests.md) for verification status.

## Example Scenarios

Each scenario uses a Unit Tests workflow with one unit-test job. The Unit Tests workflow uses its existing `pull_request` event to fire for each PR. Unit Tests has opted in with `ALLOW_STACK_WORKFLOW_PRUNE: "yes"`. The tables compare no concurrency controls with combinations of the independent prune options. The commands show only the relevant stack operations; local branches and commits are already prepared.

### Scenario 1: An agent creates a stack with the local GitHub CLI

Your agent has split a change into three local branches: `branch-a`, `branch-b`, and `branch-c`. It registers them as a local stack, then publishes the stack. The CLI opens **PR A**, **PR B**, and **PR C**, then links them into a native stack with **PR C as the top PR**.

```sh
gh stack init branch-a branch-b branch-c
gh stack submit
```

| Configuration | What happens |
| --- | --- |
| **No concurrency controls** | All three opening runs can start unit tests before the stack exists. Three jobs are now running unit tests across three PRs. |
| **Prune Option 1** | No change. Each opening run has a different PR ref, so there is no older same-ref run to supersede. |
| **Prune Options 1 + 2** | No change. The opening runs will lack stack metadata, since their PR was created (ms) before the stack. |
| **Prune Options 1 + 2 + 3** | The stack submit fires off the Prune workflow. For the opted-in Unit Tests workflow, it verifies PR C’s existing run, then requests cancellation of any active runs of the Unit Tests workflow on PR A and PR B. PR C’s run continues. |

**This is the main Prune Option 3 use case.** The trigger belongs only in the prune workflow. If no suitable top-PR run is visible after the bounded retries, prune preserves the lower runs and reports why.

### Scenario 2: A new commit on a lower PR

You have an existing stack of **PR A → PR B → PR C**, with **PR C as the top PR**. You push a new commit to PR A’s branch.

```sh
gh stack push
```

| Configuration | What happens |
| --- | --- |
| **No concurrency controls** | PR A’s earlier active Unit Tests workflow runs keep consuming runner time on outdated commits. GitHub starts an additional run for PR A’s new commit. |
| **Prune Option 1** | GitHub requests cancellation of PR A’s earlier active Unit Tests workflow runs. It starts a new workflow run for the new commit. |
| **Prune Options 1 + 2** | Prune Option 1 still requests cancellation of the earlier active runs. The new Unit Tests workflow run is created, but its unit-test job is **skipped** because PR A is below PR C, the top PR in the stack. |
| **Prune Options 1 + 2 + 3** | Prune Option 1 requests cancellation of PR A’s earlier active runs, and Prune Option 2 skips its new unit-test job. The commit does not trigger the stacked-only prune workflow, so Prune Option 3 adds no prune for this update. |

### Scenario 3: A new commit on the top PR while it and lower PR runs are active

You have the same stack of **PR A → PR B → PR C**, with **PR C as the top PR**. Earlier push-triggered Unit Tests workflow runs are still active on the branches for PR A and PR B. You push a new commit to PR C’s branch.

```sh
gh stack push
```

| Configuration | What happens |
| --- | --- |
| **No concurrency controls** | The earlier active Unit Tests workflow runs on PR A’s and PR B’s branches keep consuming runner time even though PR C covers their combined changes. Any earlier active PR C runs also continue while the new PR C run executes its unit-test job. Nothing automatically stops this redundant work. |
| **Prune Option 1** | GitHub requests cancellation of each PRs earlier active Unit Tests workflow runs. |
| **Prune Options 1 + 2** | Prune Option 1 cuts active runs down to one per PR. Prune Option 2 ensures PR A and B's jobs are skipped (after the initial PR-creation run.) |
| **Prune Options 1 + 2 + 3** | Prune Option 1 and 2 still reduce duplicate runs. Nothing additinal happens because a stack wasn't modified. |

### Scenario 4: A new top PR replaces the former top

The stack is **PR A → PR B → PR C**, and PR C's Unit Tests job is already running. You add **PR D** above PR C. PR D includes all current lower-layer changes.

Opening PR D starts its normal Unit Tests run. Adding PR D to the stack then triggers the separate prune workflow.

```sh
gh stack add branch-d
gh stack submit
```

| Configuration | What happens |
| --- | --- |
| **No concurrency controls** | PR C's older Unit Tests run keeps consuming runner time while PR D starts its unit-test job for the combined change. Any older PR D runs also continue, adding redundant work. |
| **Prune Option 1** | No change. PR D’s opening run has its own ref. PR C's active run continues because it has a different ref. |
| **Prune Options 1 + 2** | No change. PR D is the top PR, so its new unit-test job runs. PR C's already-running job is not re-evaluated after it becomes a lower PR and continues. |
| **Prune Options 1 + 2 + 3** | The separate prune workflow verifies PR D's existing Unit Tests run and combined content, then requests cancellation of PR C's eligible run and other eligible lower runs. |

### Scenario 5: The top PR has not been rebased onto a lower change

You have **PR A → PR B → PR C**, with PR C at the top. PR A gets a new commit. Its push-triggered Unit Tests run is active. You then push another commit to PR C without first rebasing it onto PR A's latest changes.

PR C is still the top PR in the stack, but its content does not include PR A's current head.

```sh
gh stack push
```

| Configuration | What happens |
| --- | --- |
| **No concurrency controls** | Older runs continue consuming runner time, while PR C's new tests omit PR A's latest changes. There is no automatic pruning of obsolete revisions and no complete top-PR coverage of the current stack. |
| **Prune Option 1** | No change. PR A's current push run continues. PR C's new run still tests content missing PR A's latest change. |
| **Prune Options 1 + 2** | The condition allows PR C's unit-test job because PR C is the top PR. It does not verify ancestry or make PR C's content complete. PR A's push is skipped because it's not the top PR in the stack. **This gap means the latest changes on PR A are not tested, until PR C is rebased by running `gh stack rebase --upstack && gh stack push`.** |
| **Prune Options 1 + 2 + 3** | No change. These commit updates do not trigger Prune Option 3.|

## Account for the combined stack change

Before skipping or canceling lower-PR work, check that the top PR's jobs can replace it. Diff-aware jobs, such as linting, some testing frameworks, and security scans, must cover the full net change from the stack's merge target to the top head. A single layer's PR changed-files API can omit lower-layer files.

Configure diff-aware jobs to compare the stack's merge target with the top PR's head commit. Fetch enough Git history to calculate that diff. Check that any action which selects changed files uses this combined range, rather than only the top PR's changes.

The top PR must also contain the latest changes from every lower PR. After updating a lower PR, update the PRs above it before relying on the top PR's jobs to cover the combined change. (`gh stack rebase --upstack`) The Prune Option 3 action checks this commit ancestry before it requests cancellation. Prune Option 2 checks only stack position.

**None of these Prune Options implements whole-stack-only merge enforcement.**

## Failed experiments

### Enforce stack-wide merging with a branch rule and an environment

I tested a branch rule that required a successful deployment to an environment before merging. The goal was for a successful top-PR deployment to satisfy the requirement for lower PRs in the stack. In the tested configuration, the lower PRs still did not meet the deployment requirement. I removed the rule and its environment. This experiment is not part of the three concurrency Prune Options.

### Add the stacked activity type to existing workflows

I tested adding `stacked` to a workflow's `pull_request.types` so it could respond after PRs became members of a stack. The activity worked: creating a three-PR stack produced one additional workflow run per PR. Adding a fourth PR to that stack produced another run for the new PR. These results prove creation and extension signals; they do not establish signals for every kind of stack edit. See the [live test results](docs/stack-tests.md#results).

The extra runs had unwanted effects, mainly, for any stacked event (stack creation or editing a stack by adding a new PR to an existing stack), jobs are kicked off again. If you created a stack with 10 PRs you'd get 10 new runs of those jobs in the queue. Prune Option 2 could skip lower-PR jobs in the new runs, but the top-PR jobs could run again on the same commit. With Prune Option 1, the extra run could cancel an active run and restart its work. If that work had already finished, concurrency could not reuse its result. I did not establish a net reduction in runner time.

I therefore do not recommend adding `stacked` to existing test, lint, or other work workflows. Prune Option 2 adds only a job condition. Revised Prune Option 3 uses the activity only in its separate prune workflow, which performs no application work. The event itself works; adding it to ordinary work workflows caused the unwanted extra work.

MIT license. See [LICENSE](LICENSE).
