# Test evidence

Test date: 2026-11-05 (America/New_York). GitHub logs use UTC on November 6.

This is execution evidence, not just a YAML review. The repository was created under the authenticated `BretFisher` account. Local checkout: `/Users/bret/code/github/bretfisher/agent-concurrency`.

## Proven behavior

| Test | Evidence | Observed result |
| --- | --- | --- |
| Ordinary PR old commit | [Run 42156007806](https://github.com/BretFisher/agent-concurrency/actions/runs/42156007806) | Canceled after a new commit on PR #1. The simulated setup started at 03:22:34Z; cancellation reached the job at 03:23:28Z. Cancellation was not immediate. |
| Ordinary replacement | [Run 42156165828](https://github.com/BretFisher/agent-concurrency/actions/runs/42156165828) | Lint, race tests, build, and HTTP E2E passed. |
| New stack tip | [Run 42156087623](https://github.com/BretFisher/agent-concurrency/actions/runs/42156087623) | Former tip PR #3 canceled after PR #5 extended native stack #4. Simulated setup started at 03:23:20Z; cancellation reached the job at 03:24:26Z. |
| Old commit within stack | [Run 42156278374](https://github.com/BretFisher/agent-concurrency/actions/runs/42156278374) | PR #5's earlier head canceled after its next commit. |
| Superseded pending commit | [Run 42156499997](https://github.com/BretFisher/agent-concurrency/actions/runs/42156499997) | Canceled while later edits advanced PR #5. |
| Lower-layer event | [Run 42156310500](https://github.com/BretFisher/agent-concurrency/actions/runs/42156310500) | API validation completed; `Current Tip Suite` was skipped. It did not enter the shared stack group. This green run does not mean its app was tested. |
| Stale opt-in SHA | [Run 42156637734](https://github.com/BretFisher/agent-concurrency/actions/runs/42156637734) | Failed API validation; suite skipped. Requested old SHA `0449ee3`, while current head was `760a69b`. |
| Lower-layer opt-in | [Run 42156640099](https://github.com/BretFisher/agent-concurrency/actions/runs/42156640099) | Failed API validation for PR #2, position 1 of 3; suite skipped. |
| Newest automatic full suite | [Run 42156629947](https://github.com/BretFisher/agent-concurrency/actions/runs/42156629947) | All four jobs passed for top head `760a69b`: API validation, lint, unit/build, and HTTP E2E. |
| Valid opt-in full suite | [Run 42156715175](https://github.com/BretFisher/agent-concurrency/actions/runs/42156715175) | All four jobs passed for exact top head `760a69b`. The request used workflow ref `demo/completion` to test the updated workflow before merging it to `main`. |
| Automatic E2E disabled | [Run 42157006772](https://github.com/BretFisher/agent-concurrency/actions/runs/42157006772) | API validation, lint, and unit/build passed; E2E was skipped with `E2E_MODE=opt-in`. |

## Final state

- Native stack #4 merged atomically with `gh stack merge 4 --yes --squash`.
- PRs #2, #3, and #5 are merged. GitHub recorded merge times 03:32:41Z through 03:32:43Z on November 6, 2026. Final stack merge head: `270e0e4`.
- Ordinary demo PR #1 is closed without merging. Its remote branch remains for inspection.
- Demo stack branches remain for inspection. There are no open demo PRs.
- The temporary branch protection rule was deleted. No stack-only merge safety claim is made.
- Repository variable `E2E_MODE=opt-in` remains set, so future automatic runs use cheap checks. `make automatic-mode` enables automatic E2E again.
- The [pre-merge API snapshot](stack-before-merge.json) preserves native membership and SHAs.

## Required-check experiment

A temporary `main` protection rule required `Current Tip Suite / Unit Test And Build` and applied to administrators. PRs #2, #3, and #5 were marked ready. `gh stack merge 4 --yes --squash` failed with:

```text
Required status check "Current Tip Suite / Unit Test And Build" is expected.
Stack merges are atomic, so nothing was merged.
```

The API then confirmed all three PRs were still open. The top had a passing automatic suite. The lower-layer gated runs had skipped the suite, which did not create the required named unit/build checks for those layers. Thus a passing tip did not satisfy this per-layer requirement. The temporary rule was removed before the teaching stack was merged. This is a test of one required-check configuration, not all protection rules.

## Native stack and full diff

`gh stack submit --auto` created native stack **#4**, then extended it. The REST API returned these members before merge:

| PR | Branch | Position | Head |
| --- | --- | --- | --- |
| [#2](https://github.com/BretFisher/agent-concurrency/pull/2) | `demo/notes` | 1 of 3 | `bc260f5` |
| [#3](https://github.com/BretFisher/agent-concurrency/pull/3) | `demo/example` | 2 of 3 | `6915d96` |
| [#5](https://github.com/BretFisher/agent-concurrency/pull/5) | `demo/completion` | 3 of 3 | `760a69b` |

All members had stack number 4 and base `main` at `b8bcd3464127ec5e65df1c0aebaf951f41050d88`. This was a GitHub native stack, not only a branch chain.

For the two-layer stage, PR #3's changed-files API returned only `docs/demo-example.md`. The [lint job](https://github.com/BretFisher/agent-concurrency/actions/runs/42156087623/job/127690514648) recorded:

```text
Full stack range: b8bcd3464127ec5e65df1c0aebaf951f41050d88...6915d9638a646936e731056283ea3c7c9b705b45
docs/demo-example.md
docs/demo-notes.md
```

The full-history Git diff therefore included the lower layer that the single-PR API omitted. The final [three-layer lint job](https://github.com/BretFisher/agent-concurrency/actions/runs/42156629947/job/127692251392) also listed all three demo files in range `b8bcd3464127ec5e65df1c0aebaf951f41050d88...760a69b2205bf2772614a334567482b64889f2c3`. It included the updated Makefile, README, opt-in workflow, and scanner policy in the net diff.

## Local checks and security review

- `make check` passed: gofmt check, `go vet`, race unit tests, build, and HTTP E2E with no delay.
- Handler unit coverage: 88.9%. The command wrapper has no unit coverage. No claim of 88.9% whole-app coverage is made.
- An additional `golangci-lint run` passed with zero issues.
- Zizmor and Pinact passed, including full SHA pins, version comments, and seven-day minimum release age. Pins: checkout v7.0.1, setup-go v7.0.0, github-script v9.0.0.
- Poutine passed with the scoped exception in `.poutine.yml`. It originally flagged test code execution. Those jobs intentionally run PR code with contents-read tokens, no retained Git credentials, no inherited secrets, and no write permissions.
- Actionlint 1.7.12 rejected the newer `$/.github/...` self-repository syntax. Its remaining rules passed when only that diagnostic was filtered. The unfiltered run is not claimed clean. GitHub Actions executed the reusable workflow calls successfully. No tool was installed or upgraded.
- Go and linter caches were redirected to writable temporary folders for local checks. This did not change repository code.

## Scope

The tests cover the listed event sequence. They do not prove atomic cancellation across all event races. A former standalone run uses a different group from a later native stack run. API validation can become stale before scheduling. Compute used before cancellation remains used. There is no hosted coordinator or custom cancellation controller in this repo.

The HTTP assertion proves the handler response through a local server. The 90-second delay only simulates expensive setup. No deployment, external infrastructure, or paid merge queue was tested.
