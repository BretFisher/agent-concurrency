# Agent Concurrency Management

Agents can create PRs and commit updates faster than CI finishes. Small PRs help people review changes, but stacks can leave obsolete validation running across several branches. The cost includes lint, unit tests, integration tests, E2E, CVE scans, and repeated runner setup.

## Goals

1. Cancel obsolete job runs for new commits within one branch or PR.
2. Cancel previously started, still-active validation runs on lower PRs when a current top-PR run can cover the combined stack change.

## Compare the three levels

| Level | Mechanism | What it achieves | Main limit | Verification |
| --- | --- | --- | --- | --- |
| 1: branch or PR concurrency | Native workflow/ref concurrency | Cancels an earlier active run of this workflow on the same ref | Different stack branches have different refs | Tested live |
| 2: top-PR job condition | Job `if:` plus explicit `stacked` subscription | Skips lower-PR jobs once event metadata contains stack membership. Level 1 can cancel an earlier opening run when its `stacked` replacement arrives. | An opening event can lack membership. Push events lack a PR object. Push runs and existing former-top runs can remain active. | Tested live on initial creation and a later lower-PR update |
| 3: current-stack API cancellation | Independent API-only job with one Bash step | A top-PR run cancels earlier active runs of this workflow on verified lower PRs, including eligible push runs | Needs Actions write access. Cancellation is asynchronous; later lower runs need another top-run cleanup. | Script and scope controls tested live; local API-mock tests included |

I recorded the exact results, run links, initial failures, and remaining limits in [Stack workflow test findings](docs/stack-tests.md). The [implementation guide](docs/ci-methodology.md) explains adoption. The [source study](docs/ci-source-study.md) compares earlier third-party approaches.

## Level 1: simple concurrency within one branch or PR

```yaml
# cancel any previously-started, yet still active runs of this workflow on the same branch
concurrency:
  group: ${{ github.ref }}-${{ github.workflow }}
  cancel-in-progress: true
```

This stable workflow/ref key groups successive commits. Ordinary PR events use `refs/pull/<number>/merge`; pushes and manual dispatches use the selected branch or tag ref. Keep the commit SHA out of the key. Separate workflow identities preserve separate validation. [GitHub concurrency semantics](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

## Level 2: prevent lower-PR jobs from starting

Add `stacked` explicitly to the PR activity types, alongside the types your workflow already uses:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, stacked]
```

Apply this condition to each validation job, or to a job that calls a reusable workflow:

```yaml
if: >-
  ${{ github.event_name != 'pull_request' ||
      github.event.pull_request.stack == null ||
      github.event.pull_request.stack.position == github.event.pull_request.stack.size }}
```

The condition allows ordinary PRs, top PRs, and non-PR events. It skips lower-PR jobs; it never cancels a run. `github.event` is the data attached to the triggering event, so it does not change after PRs join a stack. I proved that an opening event can have no stack even when the API already reports membership by job start.

The `stacked` event provides a new invocation after linking. With Level 1 in the same workflow, that new PR run can cancel its earlier opening run and then skip lower-PR validation. I verified this combination in [Stack If Probe](.github/workflows/stack-if-probe.yaml). The top still runs. Push runs have a separate ref and continue unless another mechanism cancels them. An existing former-top PR run can also continue when a new top is appended and the former top gets no replacement event of its own.

## Level 3: cancel earlier lower-stack runs

[Stack Cancel Demo](.github/workflows/stack-cancel.yaml) has an independent `Cancel Lower Stack Runs` job. Its single step runs [the Bash script](scripts/cancel-lower-stack-runs.sh). Validation has no `needs:` dependency on cleanup. The demonstration limits push triggers to `stack-lab/**`; keep your repository's own push coverage when adopting the job.

The job runs only for configured events, defaulting to `pull_request` and `push`. The workflow also subscribes to `pull_request: stacked`. The script reads current PR and stack state. Only a current top-PR run can cancel earlier active runs of this same workflow on lower member PRs. It checks source repository and PR association, paginates history, preserves other workflows and unrelated PRs, rechecks membership before requests, and stops when the top does not contain the current lower heads.

The script applies the event list to both the initiating run and cancellation candidates. `workflow_dispatch` runs stay outside Level 3 cancellation by default. Level 1 remains a separate policy and can still cancel runs sharing its workflow/ref key.

Only the API job receives `actions: write`. It fetches the script from a resolved commit on trusted default-branch code and executes no PR checkout or PR-controlled artifact. It also needs contents and PR read access. GitHub permissions apply per job, not per step. The read-only validation jobs retain their own permissions.

API acceptance does not mean execution has stopped. The script reports accepted requests and any final outcomes still pending. A successful cleanup job means its requests were accepted; the linked live tests separately verify final `cancelled` conclusions. Unknown identity or membership never authorizes a guessed cancellation.

## Validate the combined change

Canceling lower-layer coverage is useful only when top validation covers the full net change from the stack's merge target to the top head. Existing and future path filters, lint, diff-aware tests, and scanning must use that combined range. A single layer's PR changed-files API can omit lower-layer files.

The existing shared Go checks record a full-history `git diff BASE...HEAD`, using the stack base SHA and explicit top head. A lower update must be rebased into the top before combined validation is sufficient. The cancellation script checks this ancestry before making requests.

The probe delays are scheduling demonstrations, not application correctness tests. The small Go HTTP app has separate real assertions. None of these levels implements whole-stack-only merge enforcement.

## Choose when validation starts

Automatic and opt-in triggering remain separate choices. Automatic starts work on relevant events. Opt-in delays selected work until an explicit request but needs a fresh request after changes. Either can use the cancellation techniques above.

The earlier `Automatic CI` example retains its API tip selector and stack-wide reusable-call concurrency. The `Opt In E2E` example retains its required target-PR input key, so requests for unrelated PRs dispatched from `main` stay separate. These examples do not implement the new Bash job unless it is added to them.

## Test and use the script

| Command | Purpose |
| --- | --- |
| `make stack-cancel-test` | Run ShellCheck and local API-mock tests; no network mutations |
| `make stack-cancel RUN_ID=<top-run-id>` | Inspect an existing run with dry-run enabled |
| `make stack-cancel RUN_ID=<top-run-id> DRY_RUN=false` | Request eligible cancellations |
| `make stack-probe-delay PROBE_SECONDS=120` | Enable a bounded delay for live scheduling tests |
| `make stack-probe-delay` | Reset probe delay to zero |
| `make stack-cleanup-enable` | Enable the demonstration's API cleanup job |
| `make stack-cleanup-disable` | Disable that job without gating validation |

Local mock tests require Bash, jq, Python 3, and ShellCheck; they supply a fake `gh`. Live script use requires Bash, gh, jq, and an authenticated token with Actions write plus the required read access. Set `REPO=owner/repository` for another repository. The single-step job uses the tools already supplied by its GitHub-hosted Ubuntu image; a custom runner must provide them. No runtime package installation is included.

## Retired enforcement experiment

I previously tested required-deployment inheritance for lower PRs. Successful top deployment did not satisfy the lower layer in that configuration. I removed that protection and its environment. It is not part of these three cancellation levels.

MIT license. See [LICENSE](LICENSE).
