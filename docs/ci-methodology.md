# First-party CI concurrency methods

This guide adapts concepts from the [four-project source study](ci-source-study.md). It adds no action, service, compiler, cleanup implementation, or merge-policy change. The pseudocode is a design for review, not runnable code or a tested feature.

## Problem and scope

When an agent creates PRs and commits faster than validation finishes, obsolete runs can consume runner time for lint, unit tests, integration tests, E2E, CVE scans, and repeated setup. This can happen with ordinary PRs. Stacks add more cumulative revisions and events.

The cost objective is to stop obsolete long-running validation promptly. A brief overlap can be acceptable. Zero job starts and a guaranteed cancellation time are different requirements; neither is promised here. No measured industry-wide cost trend is assumed.

GitHub cancellation targets a **workflow run**, which contains job runs. Canceling its workflow run can stop all its validation jobs together. If validation spans several workflows, each selected workflow needs its own desired current run. Keeping one arbitrary run across the repository would discard required work. See [workflow-run API](https://docs.github.com/en/rest/actions/workflow-runs).

## Level 1: new commits within one PR

The approved goal is: **Cancel obsolete job runs for new commits within the same PR.**

Use native concurrency first. This fragment belongs in a PR-only validation workflow; it is not a new executable workflow in this repo:

```yaml
on:
  pull_request:

permissions: {}
concurrency:
  group: ${{ github.workflow }}-pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

The stable PR key groups old and new commits. A SHA in that key would prevent supersession. The workflow component separates different validation workflows. Give the real test jobs only their required read permissions. Use separate groups and deliberate non-canceling policies for releases and state-changing deployments.

Native concurrency operates on scheduling order, not authoritative commit order. A late old event or rerun still needs a startup check against the current PR head if exact freshness is required. GitHub documents that queue entry order is not dispatch or commit order. [Concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Level 2: select the current native stack tip

An event condition comparing `stack.position` with `stack.size` is a useful preliminary filter. gh-aw generates such a condition for its default top-only mode. It reads an event snapshot, not continuing truth. Missing metadata does not prove that another PR is unrelated. [Source study](ci-source-study.md#4-gh-aw-compiler-generated-native-stack-filter).

Before starting costly validation, query current PR and stack state. Record repository identity, all member PRs and head SHAs, trunk SHA, current top PR, and its exact head. Verify that lower changes are present in the top's linear history. If a lower PR changed but the top has not been rebased, the old top does not represent the current combined stack. Wait for a consistent state; do not authorize a full-stack merge.

Validate the explicit top head. Use a full-history `git diff BASE...HEAD` from stack trunk to that head for diff-aware checks. A layer's PR changed-files API can omit lower-layer files. Preserve both revision and execution context in the result. [Native stack metadata](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/optimizing-ci-for-stacked-pull-requests)..

The existing demo uses a per-PR concurrency group plus a gated stack-wide reusable call. It proved selected supersession cases, but a run started before native membership has a different group. Native concurrency cannot discover that transition or cancel its leftover by itself. A new top may also have been a temporary top long enough to start work. An explicit opt-in request can delay work, but automatic triggering remains a valid design choice; it must ensure the desired current run starts without a person remembering a manual step.

## A proposed metadata-only reconciliation algorithm

Use an explicit allowlist of validation workflow identities and an exclusion list. Include every selected validation category, not just E2E. Exclude the cleanup workflow, result reporters, releases, unrelated PRs, and state-changing deployment workflows. Any exception needs its own tested cancellation and cleanup behavior.

Treat events as wake-up hints. Resolve current membership through the API. Use source repository IDs and verified PR association, not a branch-name match alone. A candidate with no reliable association stays untouched.

```text
on a relevant PR, membership, or selected-run signal:
    load trusted validation scope and exclusions
    read all current PRs, complete native membership, heads, trunk, and linearity
    if identity/membership is unknown or inconsistent:
        record the reason; retry later; make no guessed cancellations

    for each selected workflow and execution contract:
        desired target = current standalone head OR current complete stack tip
        list candidate workflow runs across every verified member
        paginate and detect API result limits
        include pre-stack history for those verified PR/branch identities
        exclude unrelated repositories, events, reporters, and releases

        select at most one equivalent current run for THIS workflow
        keep other workflow identities separate
        identify old-head, lower-layer, and duplicate equivalent runs

        before each cancellation:
            refresh current membership/heads and the candidate's run attempt
            if scope changed: stop this plan and reconcile again
            if the candidate is still proven obsolete: request cancellation
            record API failures and later confirm completion

        if desired work is missing:
            use the trusted automatic trigger path for that exact target
            do not confuse dispatching it with merge authorization
```

This is a proposed selection method, not a ready-made safe script. List/query logic can use GitHub REST through existing `gh api`; cancellation uses the first-party workflow-run cancel endpoint. A normal cancellation should precede any bounded force-cancel escalation. Do not force-cancel reporters or cleanup jobs merely to reduce the active-run count. [Cancel and force-cancel APIs](https://docs.github.com/en/rest/actions/workflow-runs).

### Preserve one run per validation contract

A contract includes workflow identity, selected variant, event/checkout semantics, expected head and base, and relevant configuration. A workflow may have one matrix inside one run; several workflows may each need a run. Decide explicitly whether two event types are equivalent before deduplicating them.

Reruns keep a run ID and use a new attempt. A partial job rerun also needs explicit coverage and provenance; it does not prove every job ran in that attempt. Creation time or run number alone is not proof of freshness. Select the current target first, then apply a documented deterministic leader rule to equivalent duplicates. Re-read the attempt before acting. An old event must not cancel a new valid head merely because it reached a runner later.

### Handle the pre-stack transition without guesses

After native membership exists, a cleanup job can inspect earlier runs belonging to those now-verified member PRs, including runs whose concurrency key was standalone. It must confirm identity even when the run's PR array is empty or its branch name is reused.

Before membership exists, no algorithm can know that independent-looking PRs will later become one stack. Earlier cross-PR cancellation requires a trusted declared change-group mapping, created and authorized before those runs. Otherwise, keep independent PRs separate until membership is known. Do not infer ownership from timing, common branch prefixes, shared authors, or an agent name.

### Cover late signals and partial failure

A dedicated cleanup job can run from trusted default-branch code on selected `workflow_run` signals. GitHub says `requested` does not fire for reruns; an `in_progress` observation or another tested reconciliation signal is needed. Verify actual native membership-change event delivery instead of inventing a trigger name. A bounded later scan may recover missed events. The validation startup guard is a second line of protection. [Workflow-run events and trust warning](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

Pagination is part of correctness. Both inspected cancellation libraries read only one 100-run page. GitHub also caps some filtered searches at 1,000 results. Partition or narrow a proven scope when required; detect incomplete enumeration and report reduced coverage. Do not claim all obsolete work stopped after reading only the first page. [API limits](https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow).

A cleanup job needs a runner too. Saturation can delay it. Cancellation API acceptance does not prove a job stopped. Use bounded retries, timeouts, and later status confirmation. Record observation time, selected target, cancellation request time, completion time, and reason. Measure the overlap; do not promise a one-minute bound from YAML alone.

## Separate permissions and failure policies

| Component | Minimum relevant access | Boundary |
| --- | --- | --- |
| Metadata selector | PR read; Actions read; contents read if comparing history | No PR code execution |
| Canceller | Actions write, plus reads needed for fresh selection | Trusted code only. No PR code, PR-controlled artifacts, or deployment/app secrets. Use only the scoped cancellation token. |
| Validator | Contents read as needed | PR code can run here; no cancellation/deployment write token |
| Result/merge reporter | Only the specific reporting permission needed | Verify trusted source, attempt, revision, and final result; never execute PR code |

Unknown data must not authorize a skip or merge. For a cost-only optimization, running validation is a possible fallback. A required freshness or merge decision must remain pending/failed until its evidence is known. Unknown cancellation scope means leave candidates alone and retry, not cancel broadly. API errors need visible reasons; a successful cleanup job with failed cancellation requests is not proof of savings.

## Keep content reuse separate

The Skip Duplicate Actions source illustrates tree matching and path backtracking. A Git tree identifies file content, not the complete execution. Any reuse design must include workflow/test configuration, toolchain and dependency resolution, event/checkout contract, trunk/base, matrix inputs, environment, and relevant external data in its equivalence policy. CVE results may expire as vulnerability data changes even with the same tree.

Require a prior successful result with provenance, not just a concurrent matching tree. An in-progress duplicate can fail. Do not turn its presence into successful merge evidence. A first-parent path walk and a single page of commit file names are not a complete net stack diff. [Inspected reuse algorithm and limits](ci-source-study.md#3-skip-duplicate-actions-content-reuse-is-a-separate-policy).

## Automatic triggering and merge enforcement are separate

Automatic selection answers what to run. Cancellation stops obsolete work. Neither proves the current change may merge.

If a policy validates only the complete top, it must separately prevent merging an unvalidated lower subset. Native stacks allow merging a selected PR and its lower prefix; whole-stack-only merging is not GitHub's default. Define and test any such restriction before claiming lower layers need no independent evidence. This guide does not implement it or prescribe blanket per-layer checks. [Native merge scope](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks).

A skipped job can report success without testing. A dispatched workflow does not automatically satisfy PR required status checks. The retired experiment required per-layer cheap checks to isolate deployment behavior. Those branch requirements have been removed and do not define the intended cost policy. Native required-deployment inheritance remains unverified in this repo despite successful active tip deployments. The [README](../README.md#retired-enforcement-experiment) summarizes the failed experiment. Do not copy successful statuses to lower commits to hide a missing validation result.

Merge-queue validation has a different candidate revision and event contract. Keep its concurrency and result identity separate from PR runs. Graphite's hosted once-per-stack queue is not evidence that GitHub's native queue has the same behavior. [Source comparison](ci-source-study.md#1-graphite-public-adapter-hosted-decision).

## Acceptance tests before implementation claims

| Case | Required observation |
| --- | --- |
| Standalone PR gets a new commit | Old selected workflow runs stop; latest head validation completes |
| A stack grows several minutes apart | Former tips and lower-layer work stop after current membership is observed |
| Standalone PRs become native members | Their earlier standalone-key runs are found and canceled |
| Same branch name in another fork or unrelated PR | Its runs remain untouched |
| Two selected workflows and duplicate current-head runs | One valid run per workflow/contract remains, not one global winner |
| Old event, rerun attempt, or late scheduling | Current head remains selected; cleanup does not cancel it based on timestamp order |
| Lower head changes without a rebase | The incomplete top is not certified as the whole current stack |
| More than 100 runs, a capped query, or API failure | Missing coverage is detected; no guessed scope or false success |
| Cleanup runner is delayed | Overlap is measured; startup checks still reject obsolete validation |
| Canceled/failed tests or a new head after success | Merge authorization does not reuse that result |
| A lower-prefix merge is attempted under a tip-only policy | Explicit policy enforcement rejects it; do not assume native all-stack-only semantics |

These are proposed acceptance tests. Prior live demonstrations covered selected cancellation, diff, and opt-in cases; those observations do not prove this proposed cleanup algorithm. The source review adds no new cleanup behavior or timing guarantee.
