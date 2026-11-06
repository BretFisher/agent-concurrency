# Repository agent instructions

## Purpose and scope

This repository has two separate goals:

1. Test and validate scenarios for job pruning in stacks. Use the Go HTTP app, simulated jobs, and workflow experiments to test assumptions and hypotheses. Record results in the test findings.
2. Teach people and their agents how to use job pruning in stacks. Use the README to explain the three prune options and provide copyable adoption instructions.

When writing documentation, use the terms in [the glossary](GLOSSARY.md). The prune options are independent choices; their numbers do not specify rank, difficulty, or an adoption sequence.

Keep application-demo details, test controls, and experiment procedures in this file or the test findings. The demo app is a test fixture, not a requirement for adopting the methods.

Before changing event triggers, read [the CLI command/API audit](docs/stack-cli-event-coverage.md) and distinguish client request evidence from server event delivery. Before changing the stack filter or cancellation logic, read [the implementation contract](docs/ci-methodology.md) and [the live test findings](docs/stack-tests.md). Keep observed results separate from untested hypotheses.

## Prune Option 3 design

The replacement Prune Option 3 is a dedicated workflow with one prune job, triggered only by `pull_request` with `types: [stacked]`. The implementation is a TypeScript action. Record its verification status in `docs/typescript-stack-prune.md`. Retain the Bash implementation and its test evidence during development.

Workflow selection uses the literal workflow-level environment variable `ALLOW_STACK_WORKFLOW_PRUNE`, with quoted values `"yes"` or `"no"`. Only `"yes"` permits selection. A missing variable or `"no"` preserves the workflow's runs. The prune action discovers and reads these declarations; GitHub does not pass environment variables between workflow runs automatically. Avoid a separate required list of workflow names.

Opt-in is optional for each workflow. A missing declaration is equivalent to `"no"`; adoption does not require editing every workflow or adding a required policy check. The optional action input is `warn-on-missing-opt-in`, defaulting to `"no"`. With `"yes"`, report workflows without the variable in a table on the prune run's summary page and emit one grouped warning annotation. Explicit `"no"` is an intentional exclusion and produces no missing-variable warning. Warnings do not fail the job or permit cancellation. Summaries and annotations are visible in the prune run; they are not automatic PR comments or guaranteed notifications.

The prune summary always lists cancellation requests and their observed outcomes, independently of the missing-opt-in warning setting. For each target run, include the workflow, lower PR, branch and commit, linked run and attempt, linked replacement top-PR run, reason, request time, and observed status. Include affected job names and links with their observed states, using paginated job data for the selected run attempt. Cancellation targets the entire workflow run; completed jobs in that run must not be described as canceled. Distinguish confirmed `cancelled`, accepted but pending, already finished, failed requests, and dry-run proposals. Never present API acceptance as proof that a run or its jobs stopped. Include the stack identity and the triggering event/run so readers can trace why prune ran.

## TypeScript action checks

| Command | Purpose |
| --- | --- |
| `make action-install` | Install locked project dependencies after approval |
| `make action-typecheck` | Check TypeScript types |
| `make action-test` | Run behavior and API-adapter tests |
| `make action-build` | Rebuild bundled JavaScript and license notices |
| `make action-check` | Run type checks, tests, and a build |
| `make action-workflow-check` | Check workflow syntax with exact exclusions for the installed schema diagnostics |

After source changes, run `make action-check` and include the rebuilt `dist` files in the change. Runtime consumers use the bundle and do not install packages. Keep test-only policy overrides and probe workflows out of the normal adoption example. The optional `policy-ref` input accepts only a full trusted commit SHA; normal use resolves the default branch once.

## Local checks

Run `make stack-cancel-test` after changes to the cancellation script or its tests. It runs ShellCheck and local API-mock tests without network mutations. It requires Bash, jq, Python 3, and ShellCheck; the tests supply a fake `gh`.

Run `make check` after changes to the Go app. It runs linting, race-enabled unit tests, a build, and HTTP E2E tests. Use `make run` to start the app locally. These app checks are separate from tests of GitHub event delivery and cancellation.

For documentation edits, check changed links and run `git diff --check`. Report which checks ran and any failures. Ask Bret before installing a missing tool.

## Live cancellation and demo controls

Before reproducing a live stack experiment, read [the reproduction notes and prior outcomes](docs/stack-tests.md#validation-and-reproducibility). Select the intended repository and test runs before enabling pruning or requesting cancellation.

| Command | Purpose |
| --- | --- |
| `make stack-cancel RUN_ID=<top-run-id>` | Inspect an existing run with dry-run enabled |
| `make stack-cancel RUN_ID=<top-run-id> DRY_RUN=false` | Request eligible cancellations |
| `make stack-probe-delay PROBE_SECONDS=120` | Enable a bounded delay for live scheduling tests |
| `make stack-probe-delay` | Reset the probe delay to zero after testing |
| `make stack-prune-enable` | Enable the demonstration's API prune job |
| `make stack-prune-disable` | Disable prune without gating other jobs |
| `make automatic-mode` | Set the existing demo's E2E mode to automatic |
| `make e2e-mode` | Set the existing demo's E2E mode to opt-in |
| `make e2e-request PR=<top-pr-number>` | Request the opt-in E2E demo for the current top PR head |
| `make demo-status` | List recent workflow runs |

Historical live Bash script use requires Bash, gh, jq, and an authenticated token with Actions write plus the required read access. Set `REPO=owner/repository` for another repository. The historical Bash job needs those tools on its runner. The new action uses bundled JavaScript and the action Node runtime.

The existing `Automatic CI` and `Opt In E2E` workflows are separate scheduling experiments. Automatic triggering starts work on relevant events. Opt-in triggering needs a fresh request after changes. The automatic example uses an API top-PR selector and stack-wide reusable-call concurrency. The opt-in example keys requests by target PR so requests dispatched from `main` for unrelated PRs stay separate. Neither workflow contains the historical Bash prune job unless it is added explicitly.

After live testing, reset probe delays and restore any repository settings changed for the experiment. Record exact run evidence and remaining limits in `docs/stack-tests.md`. A successful cancellation request proves API acceptance; verify the eventual run conclusion separately.

## Experimental action scanner exceptions

The action pin exception in `.pinact.yaml` matches only the tested same-repository prerelease SHA. It does not exempt other refs or third-party actions. The Poutine creator-verification exception matches only the dedicated prune workflow, which calls this repository's action. Review these exceptions if the source pin changes. Record the exact actionlint diagnostics excluded by `make action-workflow-check` in the findings; GitHub execution is the trigger proof.
