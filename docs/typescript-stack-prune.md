# TypeScript stack prune test findings

I tested the dedicated prune workflow on November 6, 2026, in `BretFisher/agent-concurrency`. These tests are separate from the [earlier Bash experiments](stack-tests.md). The normal working checkout remains uncommitted. Test action bundles and fixture workflows were published on an isolated source branch; remote `main` was not changed.

## Prune terminology and interface revision

The current interface uses `ALLOW_STACK_WORKFLOW_PRUNE: "yes"`, the Stack Prune action, and `.github/workflows/stack-prune.yaml`. The source controller and tests use the same prune terminology. Archived live-test links below retain the names and identifiers from the revisions that actually ran; their narrative labels use the current terms.

The renamed action is [revision f378d9c](https://github.com/BretFisher/agent-concurrency/commit/f378d9cfb1bc37cf8a107151ecd35e3d34cbd8f9). It passed 36 behavior/API tests and two packaged-action tests. The packaged API test executes the bundled action against a local HTTP server, reads the exact new opt-in, cancels only the eligible lower run, and checks the summary. These are local interface tests, not an additional live GitHub stack test. Cancellation selection rules are unchanged.

## Implementation under test

The action has TypeScript source, an API adapter, pure selection helpers, a workflow-policy parser, summary generation, and a bundled Node action. The workflow listens only for `pull_request: stacked`, with one job and one action step. It discovers workflows through literal workflow-level `ALLOW_STACK_WORKFLOW_PRUNE` values.

The earlier action revision is [c1d0e95](https://github.com/BretFisher/agent-concurrency/commit/c1d0e954a90e8f36b66cd71d3b60b30aa2ffb288). It adds preservation for files absent from the trusted policy revision and rejects a closed top PR. The initial creation and first extension used [dca91a8](https://github.com/BretFisher/agent-concurrency/commit/dca91a87ab79f558e44b0df1296bf621cf344f98); [6849386](https://github.com/BretFisher/agent-concurrency/commit/68493865e245e6cdcf34cf495290406387bf4e28) adds structured diagnostics and excludes GitHub-managed workflow paths without warning. That revision retains those features.

For isolated testing, the workflow used `policy-ref: da3626a3ac94026d3de3e3947e875f5a52069826`. That trusted fixture commit declares opt-in for Stack Unit Probe, Stack Integration Probe, and Stack If Probe. The normal adoption example omits this override and resolves the default branch. Stack Control Probe has no declaration and must remain untouched.

## Local verification

`make action-check` passed TypeScript checks, 36 behavior/API tests, two packaged-action tests, and a reproducible bundle build. The retained Bash suite also passed its 21 tests and ShellCheck. The tests cover creation, extension, multiple workflows, missing and excluded opt-ins, invalid YAML, literal-only policy, immutable policy selection, changed workflow definitions, manual and unrelated runs, source repositories, commit/PR association, missing or failed top runs, bounded visibility retries, changing stack state, changed run attempts, dry runs, rejection, pending cancellation, repeated invocation, trace output, and malformed API data. A local HTTP server also verifies real adapter pagination, source caching, and cancellation requests.

Runtime dependencies are locked. The production-dependency audit reported no known vulnerabilities when checked. This does not establish the absence of undisclosed defects.

## Initial stack creation

I used the local `gh stack` CLI to create three cumulative fixture branches, push them, open PRs, and link the native stack. I made no follow-up commit to trigger prune after linking. The workload jobs used bounded delays to remain active; they tested scheduling and cancellation rather than application correctness.

The stacked activity started the dedicated prune workflow. GitHub replaced one pending prune invocation through its concurrency policy. Two invocations ran and completed successfully: [middle-event prune](https://github.com/BretFisher/agent-concurrency/actions/runs/42217033269) and [top-event prune](https://github.com/BretFisher/agent-concurrency/actions/runs/42217036035).

| Target workflow | Lower PR A | Lower PR B | Observed outcome |
| --- | --- | --- | --- |
| Stack Unit Probe | [opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217024803) | [opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217030131) | Both finished cancelled. |
| Stack Integration Probe | [opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217024840) | [opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217029813) | Both finished cancelled. |
| Stack If Probe | [opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217024633) | [opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217030204) | Both finished cancelled. |

The top PR's runs remained active after pruning. Stack Control Probe's lower runs, which had no opt-in, also remained active. The first manual controls exceeded their own three-minute job limit. GitHub’s annotation on [the second control](https://github.com/BretFisher/agent-concurrency/actions/runs/42217944848) states that cause. They are not used as proof of preservation. I increased the local probe timeout to four minutes and used a separate longer-limit control for the final test.

## Add several PRs to an existing stack

I added PRs D and E through the CLI without changing the existing lower commits. Their [D-event prune](https://github.com/BretFisher/agent-concurrency/actions/runs/42217371401) and [E-event prune](https://github.com/BretFisher/agent-concurrency/actions/runs/42217377213) both succeeded.

The former top PR C's [unit run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217037074) and [integration run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217037153) finished cancelled. PR D's [unit run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217364987) and [integration run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217365322) also finished cancelled. Final top PR E's [unit run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217376099) and [integration run](https://github.com/BretFisher/agent-concurrency/actions/runs/42217376103) completed successfully.

This directly exercises stack extension without a later commit on the new top PR. Completed run states alone do not identify which concurrent prune invocation caused each cancellation.

## Final summary and manual-run controls

I extended the stack again using the final structured-report implementation. The [H-event prune](https://github.com/BretFisher/agent-concurrency/actions/runs/42218247697) accepted four requests and reported their outcomes as pending. The linked records in its structured report identify the workflow, PR, commit, run attempt, replacement, reason, request time, and job states:

| Workflow | Target | Source event | Later observed conclusion |
| --- | --- | --- | --- |
| Stack If Probe | [PR G run](https://github.com/BretFisher/agent-concurrency/actions/runs/42218240002) | pull_request | cancelled |
| Stack If Probe | [PR G push](https://github.com/BretFisher/agent-concurrency/actions/runs/42218233127) | push | cancelled |
| Stack Integration Probe | [PR G run](https://github.com/BretFisher/agent-concurrency/actions/runs/42218240115) | pull_request | cancelled |
| Stack Unit Probe | [PR G run](https://github.com/BretFisher/agent-concurrency/actions/runs/42218240136) | pull_request | cancelled |

A fifth report entry had already finished cancelled before this invocation requested cancellation. It had no accepted-request timestamp. This proves that the report distinguishes its own accepted requests from already-finished work.

The [longer-limit manual Unit Probe](https://github.com/BretFisher/agent-concurrency/actions/runs/42218678282) stayed active across the [I-event prune](https://github.com/BretFisher/agent-concurrency/actions/runs/42218817789) and later completed successfully. Missing-opt-in Stack Control Probe runs also completed successfully, including [PR G](https://github.com/BretFisher/agent-concurrency/actions/runs/42218240106) and [PR H](https://github.com/BretFisher/agent-concurrency/actions/runs/42218245349).

The final [default-policy run](https://github.com/BretFisher/agent-concurrency/actions/runs/42219774236) used the latest source revision at that time and omitted `policy-ref`. It resolved remote `main`, found no opt-ins there, reported branch-only fixture workflow files as missing declarations, and succeeded with zero cancellation entries and zero errors. This proves that a newly discovered workflow absent from the trusted branch does not cause the prune job to fail or become eligible accidentally.

The packaged-action smoke test confirms summary-file and output-file writes. Live logs contain the same structured report used to render the summary, and warning annotations were visible on GitHub. The anonymous browser could not load the job-summary content, so I do not claim an authenticated visual review of that table.

## Workflow checks

Zizmor, Poutine, and Pinact passed with narrowly documented exceptions for this repository’s own prerelease action. The Pinact exception matches only the exact tested commit; it does not ignore other refs or third-party actions. Poutine’s creator-verification exception matches only the dedicated workflow. The normal actionlint pass still reports `stacked` as unknown. `make action-workflow-check` excludes only that exact diagnostic and passes the remaining syntax checks. GitHub successfully executed the trigger throughout the live tests.

## CLI command coverage

The [CLI source audit](stack-cli-event-coverage.md) maps the installed extension’s commands to Git and GitHub API operations. Local init, add, and modify are separate from publication. Creation and extension through submit were tested live. Modify followed by submit can recreate a stack; event delivery for that path has not been tested live. Rebase/push alone requests no new stack entry.

## Remaining limits

- The action has a bounded visibility retry, not continuous reconciliation. Missing top work, late runs, equal creation timestamps, changed workflow definitions, or changing stack state can preserve lower work.
- Top content and a matching workflow run do not prove that every job covers every lower file. Workflow authors decide whether to opt in and must configure complete stack coverage.
- Cancellation requests are asynchronous. A pending outcome in the summary is not a failure or a confirmed stop.
- This trigger covers joining PRs. Ordinary commits do not initiate pruning. Removal, reorder, and dissolution signals are not established here.
- Local API tests cover deliberate failures, incomplete ancestry, and uncertain association; these cases were not all reproduced against GitHub live.
- The installed actionlint schema omits `stacked`. GitHub execution proves the trigger; the remaining workflow checks are run separately with that single diagnostic excluded.
- The action is experimental and has no release-version tag yet. Its exact commit is pinned and retained on the isolated source branch; a different pin requires review of the scoped scanner exception.

## Teardown and delivery state

I closed the ten test PRs without merging and removed their ten remote fixture branches after comparing remote and local heads. No test run remained active at teardown. Probe delay was restored to zero, and the historical prune enable variable was restored to its prior value. The isolated source branch remains so the pinned experimental action commits stay reachable.

Remote `main` was not changed. The normal checkout contains the implementation, bundled action, revised README and guides, agent instructions, Make targets, and scoped scanner configuration as local uncommitted changes. The Bash implementation and its historical evidence remain available.
