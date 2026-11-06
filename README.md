# Agent Concurrency Management

Techniques for limiting duplicate, redundant, and outdated CI runs when agents rapidly create and update pull requests.

Small PRs help people review one concern at a time. An agent can create several PRs before the first test finishes. Each PR event can start CI. Three layers with three updates can start nine suites. A native stack does not, by itself, reduce those starts.

This public teaching repo uses a small Go HTTP service, unit tests, and a real HTTP integration test. The E2E job adds **90 seconds of simulated setup** before its HTTP assertion. The delay exists to make cancellation visible. It does not prove correctness. Each job has a time limit. No cloud resources or deployment are needed.

## Local checks

Requires Go 1.27 and Make. No module dependencies. Nothing here installs local tools.

```sh
make check   # gofmt check, go vet, race tests, build, HTTP test
make lint
make test
make build
make e2e     # no simulated delay by default
make e2e SIMULATED_E2E_DELAY=90s
make run     # GET http://localhost:8080/?name=Bret
```

The basic lint checks use `gofmt` and `go vet` from Go. The HTTP test checks status, body, and content type through a local TCP server.

## Approach 1: cancel superseded automatic CI

[Automatic CI](.github/workflows/automatic.yaml) starts on PR events, including draft PRs. It has a stable workflow-and-PR concurrency key. A new event for that PR cancels its previous run. The key must not include the commit SHA.

A separate read-only job queries the current PR through the API. It rejects a closed PR, an old head SHA, or a lower stack layer. Only a valid current tip can call [Shared CI](.github/workflows/reusable-ci.yaml). The call has a workflow-and-stack concurrency key, with a separate standalone PR fallback. The reusable workflow runs lint and unit/build jobs in parallel. E2E waits for both.

The two scopes have different purposes. The PR key cancels old commits within each PR. The suite key cancels a former tip when a new tip reaches the same stack group. Lower-layer events cannot enter the shared group and cancel the tip. The called workflow has no duplicate concurrency key that could cancel its caller.

**Limits:** API validation and scheduling are not atomic. A PR can stop being the tip after validation. An old standalone run has a different key from its later stack run. A new top can start E2E while the stack is still being built. Cancellation cannot recover compute already used. GitHub concurrency order is queue order, not commit order. This example reduces redundant work; it does not guarantee that all obsolete jobs stop in every race. A stricter design needs custom automation that queries current membership and heads and cancels obsolete runs through the Actions API. It can run in Actions; no separate server is required.

## Approach 2: request E2E after the stack is complete

Set this repository variable to keep cheap automatic checks and stop automatic E2E starts:

```sh
make e2e-mode
```

After creating or rebasing the full stack, request E2E for its current top and exact SHA:

```sh
make e2e-request PR=5 # replace 5 with the current top PR
make demo-status
```

[Opt In E2E](.github/workflows/opt-in.yaml) rejects stale SHAs and lower layers. New commits or rebases need a new request with the new SHA. A previous manual run is evidence for its recorded SHA only. It is not a required PR check and does not automatically become invalid when a later PR event occurs. Revalidate before merging. Draft status alone does not suppress Actions.

Restore automatic E2E with:

```sh
make automatic-mode
```

Both modes remain visible for teaching. Use one expensive-job policy in production. Do not run both suites for the same SHA unless comparing them.

## Full stack diff

The lint job checks out the exact head with full history. For a native stack it uses `stack.base.sha`; for an ordinary PR it uses `base.sha`. It prints `git diff BASE...HEAD` and the changed files in the job summary. This includes lower-layer changes. A PR changed-files API call can show only that layer. This example lints all Go packages, so a path filter cannot hide a needed check. A diff-aware tool should consume the full net diff.

## Reproduce the demos

Requires an authenticated `gh` with native `gh stack` support. Use a fork or a disposable teaching repo with Actions enabled. The demo creates public PRs. Run local checks before commits.

Before the automatic demos, run `make automatic-mode`. After all demos, run `make e2e-mode` to avoid automatic expensive starts.

1. **Ordinary PR:** create a branch, commit a small documentation change, push, and open a draft PR. Wait until the simulated E2E step starts. Push a second commit. Verify the old run is canceled and the new run passes.
2. **Native stack:** on `main`, run `gh stack init demo/notes`. Add `docs/demo-notes.md`, commit, and run `gh stack submit --auto`. Then `gh stack add demo/example`, add `docs/demo-example.md`, commit, and submit again. Verify membership with `gh stack view --json` and `gh api repos/{owner}/{repo}/pulls/PR`. Wait for the two-layer tip to start E2E. Run `gh stack add demo/completion`, add `docs/demo-completion.md`, commit, and submit again. This new tip should cancel the former tip through the shared stack group. Then push a new commit to the current top with `gh stack push` to test old-commit cancellation within the stack. Verify cancellation and a passing newest run. Trigger a lower-layer event by editing its PR title; verify its suite is skipped. The top run's diff must list both files.
3. **Opt-in:** set `E2E_MODE=opt-in`, push a top commit, and verify automatic E2E is skipped. Dispatch `opt-in.yaml` as above. Verify the HTTP E2E passes. Dispatch an earlier SHA and a lower PR; verify each is rejected before tests start.
4. Close or merge demo PRs when done. Native `gh stack merge TOP --yes --squash` merges the selected PR and all lower layers. Use `gh stack merge --help` for current flags. Confirm every resulting PR state.

[Observed run evidence](docs/evidence.md) records what was actually tested. Reproduction steps describe expected behavior until supported by that evidence.

## Approach 3: enforce full-stack E2E with a required deployment

A required deployment can cover lower layers in a linear native stack. This differs from ordinary required status checks. The [setup and walkthrough](docs/required-deployment.md) explains the environment, active ruleset, exact-SHA deployment API, read-only tests, and trusted reporting boundary. [Live evidence](docs/deployment-evidence.md) records what was actually observed.

```sh
make deployment-setup                # admin: create environment and active ruleset
make deployment-request PR=TOP_PR    # request the current exact top SHA
make deployment-state
make deployment-status DEPLOYMENT=ID
make stack-merge STACK=STACK_NUMBER
```

Deployment mode runs real cheap checks on every PR. Expensive HTTP E2E runs once on explicit request. The deployment is simulated on an ephemeral runner; the HTTP assertions are real. A separate API-only workflow posts success after the E2E source workflow has completed successfully and the stack still matches. Failed or canceled tests cannot report a successful deployment. Keep the rule active for the merge proof.

## Merge protection and security

The earlier status-check example does not enforce stack-wide E2E. The required-deployment example above adds a separate enforcement rule. GitHub evaluates required checks for every layer. A job skipped by an `if` condition can report success without testing that layer. A canceled check can prevent a layer from merging. The live [required-check experiment](docs/evidence.md#required-check-experiment) confirmed that a passing tip did not satisfy the required unit/build check for lower layers. Do not mark a skipped top-only job as the sole safety check, copy green statuses to lower commits, or assume a dispatched workflow satisfies PR required checks. Retain real cheap per-layer checks when enabling protections. Merge queue runs need their own `merge_group` workflow and concurrency scope; a queue does not promise one build per stack. Merge queues are outside this demo.

Workflows start with no permissions. API validation gets PR read permission; test jobs get contents read permission. Test code has no write token. Checkout does not retain credentials. External actions are pinned to release SHAs at least seven days old. Review and update pins regularly. `.poutine.yml` records one scoped exception: the test workflow intentionally executes PR code with read-only access and no secrets. Go caching is disabled because there are no dependencies or `go.sum`; this avoids a cache setup cost in a small example. Job time limits bound failures and the simulated wait. Multi-line shell steps stop on errors and unset values.

## Sources

- [GitHub: stack CI metadata and tip conditions](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/optimizing-ci-for-stacked-pull-requests)
- [GitHub: stack APIs and webhooks](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests-apis-and-webhooks)
- [GitHub: stack merge requirements](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)
- [GitHub: required check events and skipped jobs](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [GitHub: concurrency and ordering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

MIT license. See [LICENSE](LICENSE).
