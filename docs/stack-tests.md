# Stack workflow test findings

I ran these tests on November 6, 2026, in `BretFisher/agent-concurrency`. I used the installed `gh stack` v0.1.0 extension and the local Git CLI. I created native stacks through `gh stack init`, `gh stack add`, and `gh stack submit --auto --remote origin`.

The first stack had three layers: contract, handler, and assertion. I later added a fourth report layer. A separate two-layer stack tested the combination of native concurrency, `stacked`, and the top-PR job condition. The fixture text files supplied separate commits and diffs; they did not test application correctness. The repository's Go tests remain separate.

## Results

| Test | Live evidence | Observed result |
| --- | --- | --- |
| PR opens before native linking | [PR #12 opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42187792977) | Event `stack` was null. The API already reported position 1 of 3 when the observer ran. Conditional validation started and completed. |
| Lower PR gets a later commit | [PR #13 update](https://github.com/BretFisher/agent-concurrency/actions/runs/42187936698) | The `synchronize` event contained position 2 of 3. The conditional validation job was skipped. |
| Direct `stacked` listener on creation | [PR #12](https://github.com/BretFisher/agent-concurrency/actions/runs/42187800691), [PR #13](https://github.com/BretFisher/agent-concurrency/actions/runs/42187801184), [PR #14](https://github.com/BretFisher/agent-concurrency/actions/runs/42187804328) | All three listener runs passed and recorded `action: stacked`. The top event had position 3 of 3. |
| Direct listener on extension | [PR #17 added](https://github.com/BretFisher/agent-concurrency/actions/runs/42189029173) | The new member produced `action: stacked`, position 4 of 4 in the existing stack. |
| Combine `stacked`, Level 1, and the condition | [Lower opening run](https://github.com/BretFisher/agent-concurrency/actions/runs/42189232114), [lower replacement](https://github.com/BretFisher/agent-concurrency/actions/runs/42189236779), [top replacement](https://github.com/BretFisher/agent-concurrency/actions/runs/42189241795) | The opening run was canceled by native concurrency. The lower `stacked` replacement skipped validation. The top replacement ran validation and passed. API cleanup was disabled for this experiment. |
| Push remains outside PR filtering | [Lower push run](https://github.com/BretFisher/agent-concurrency/actions/runs/42189225839) | The push run completed its simulated work. Its event had no PR object, so the PR-only condition allowed it. |
| Existing former-top run after extension | [Former top PR #14](https://github.com/BretFisher/agent-concurrency/actions/runs/42189016105) | Its conditional job had started while it was top. It completed rather than re-evaluating the condition after PR #17 joined above it. |
| Other workflow control | [Lower push in Stack If Probe](https://github.com/BretFisher/agent-concurrency/actions/runs/42189513168) | It completed successfully while Stack Cancel Demo canceled its own lower runs. |
| Final Bash cancellation | [Top PR #17 run](https://github.com/BretFisher/agent-concurrency/actions/runs/42189526974) | The independent cleanup job and simulated validation both passed. The script requested five lower-run cancellations. All five later finished `cancelled`. |
| Manual lower-branch control | [Manual run](https://github.com/BretFisher/agent-concurrency/actions/runs/42189511226) | It completed successfully while top cleanup targeted other lower runs. |
| Independent PR control | [Unrelated PR run](https://github.com/BretFisher/agent-concurrency/actions/runs/42189524601), [unrelated push](https://github.com/BretFisher/agent-concurrency/actions/runs/42189517738) | Both completed successfully. They were outside native stack #15. |

The first workflow revision was [ae76748](https://github.com/BretFisher/agent-concurrency/commit/ae76748c7617f9de246c90fef68e83911f8b22f4). It deliberately omitted `stacked` from Stack If Probe so the original opening-event limitation could be measured. Revision [6ac0d67](https://github.com/BretFisher/agent-concurrency/commit/6ac0d673be0f2adc984bdd958bb5ef0309ec180a) added it for the second stack. The final cancellation script was tested at [cb5d776](https://github.com/BretFisher/agent-concurrency/commit/cb5d776c5949a751616b7a7ffbb0a8e05a965627).

## What the event data means

For PR #12, the observer recorded these two facts in the same step:

```json
{
  "snapshot": {"event": "pull_request", "action": "opened", "pr": 12, "stack": null},
  "current": {"pr": 12, "stack": {"number": 15, "size": 3, "position": 1}}
}
```

`github.event` contains the information attached to the event that created the run. It does not refresh when the job starts. Therefore the original `if:` condition cannot discover stack membership added after that event.

The condition is still useful for later PR updates, and `stacked` supplies an additional event after membership exists. With Level 1 in that same workflow, the new PR run supersedes the earlier opening run; the lower replacement can skip validation. This is a useful Level 2 solution without an Actions-write token. It does not stop separate push-ref runs or an existing former-top PR run that receives no replacement event when another PR is appended.

## The stacked event works in Actions

GitHub's [stack rollout documentation](https://docs.github.com/en/pull-requests/tutorials/roll-out-stacked-prs#5-update-your-programmatic-tooling) documents a `stacked` webhook activity. The generic [Actions event list](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request) did not enumerate it when I checked. The live listener resolved that gap:

```yaml
on:
  pull_request:
    types: [stacked]
```

It fired for all initial members and the new member appended later. `workflow_dispatch` was a positive control for the listener, not the evidence for stack-event delivery.

A dedicated cancellation-only workflow can therefore be triggered by native membership events without an external webhook service. Such a separate workflow must explicitly select its target validation workflow IDs. The implemented Bash example intentionally targets its own workflow; the cross-workflow variant is not implemented or claimed tested.

For repositories where direct delivery is unavailable, a GitHub App or webhook receiver could accept `pull_request.stacked` and dispatch a dedicated cleanup workflow. That adds a receiver and credentials. It was not needed or tested here.

## Exact final cancellation outcomes

The [final cleanup job](https://github.com/BretFisher/agent-concurrency/actions/runs/42189526974/job/127797839692) made the following requests from top PR #17:

| Lower PR | Event | Run | Final conclusion |
| --- | --- | --- | --- |
| #14 | push | [42189511676](https://github.com/BretFisher/agent-concurrency/actions/runs/42189511676) | cancelled |
| #12 | push | [42189513322](https://github.com/BretFisher/agent-concurrency/actions/runs/42189513322) | cancelled |
| #14 | pull_request | [42189521429](https://github.com/BretFisher/agent-concurrency/actions/runs/42189521429) | cancelled |
| #12 | pull_request | [42189521481](https://github.com/BretFisher/agent-concurrency/actions/runs/42189521481) | cancelled |
| #13 | pull_request | [42189521827](https://github.com/BretFisher/agent-concurrency/actions/runs/42189521827) | cancelled |

These are workflow-run cancellations through GitHub's API, not failed checks or copied success statuses. The cleanup step initially reported five accepted requests with five final outcomes pending. I then verified each final run conclusion. The later [top push invocation](https://github.com/BretFisher/agent-concurrency/actions/runs/42189523233) found no remaining eligible older runs, and its cleanup job passed.

The cleanup job has one Bash step. It reads only GitHub metadata and fetches the script from a resolved default-branch commit. It has Actions write, contents read, and PR read access. It neither checks out PR code nor gates the independent simulated validation job. [GitHub job permission scope](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).

## Initial failures and corrections

The first [PR cleanup attempt](https://github.com/BretFisher/agent-concurrency/actions/runs/42188549892) and [push attempt](https://github.com/BretFisher/agent-concurrency/actions/runs/42188544053) requested real cancellations but failed their own short confirmation windows. Increasing the window still produced a [reporting failure on extension](https://github.com/BretFisher/agent-concurrency/actions/runs/42189031005); one run finished `cancelled` more than a minute after acceptance.

I removed serial waiting from the script. It now requests all eligible cancellations promptly, then reports which outcomes are final or still pending. API rejection remains an error unless the candidate has already finished. Pending asynchronous completion is explicit and does not become a false claim of confirmed cancellation. A cleanup job's success means request acceptance, not proof that runner work has stopped. The final outcome table above supplies that separate proof.

## Validation and reproducibility

`make stack-cancel-test` passed 21 local API-mock tests plus ShellCheck. The cases cover lower and standalone initiators, manual initiators and candidates, unrelated PRs, other repositories and workflows, newer and completed runs, changing membership, non-linear history, ambiguous PR association, push association, pagination, dry run, API read failure, cancellation rejection, pending completion, and configurable event scope. These tests check destructive selection boundaries; they are not substitutes for the live results.

For a new live reproduction, enable a bounded probe delay with `make stack-probe-delay PROBE_SECONDS=120`. Create separate fixture commits with `gh stack init` and `gh stack add`, then use `gh stack submit --auto --remote origin`. Inspect the event observer and conditional jobs. Update a lower PR and push again. Add a new top layer to test extension. Use the README commands to enable or disable API cleanup for the relevant phase. Reset delay with `make stack-probe-delay` when finished.

The probe jobs initially used fixed 90- or 120-second delays. The final files default to zero delay and permit an explicit value up to 180 seconds for repeated scheduling experiments. The delay is simulated work. The Go HTTP assertions are separate.

## Diff and scope requirements

Top validation must cover the full net change from the stack merge target to the top head. Path filters, lint, diff-aware tests, and scanning must include lower-layer files. A top PR's individual changed-files list is insufficient. The existing shared workflow uses full history and `git diff BASE...HEAD` with the native stack base.

The Bash script verifies that the current top contains all lower heads before canceling their coverage. It also rechecks membership and heads before every request. This does not make API reads and cancellation atomic, guarantee a fixed stop time, or find lower runs created after its scan. Manual dispatch protection applies to Level 3; Level 1 retains its separate ref-based behavior. Manual reruns keep their original event type.

No environment, required deployment, branch protection, or copied lower-layer success was used to obtain these cancellation results. Whole-stack-only merge enforcement remains outside this work.

## Final repository state

I closed test PRs #12, #13, #14, #16, #17, #18, and #19 without merging the fixture changes. I removed their seven test branches after verifying their remote and local heads matched. The closed PRs and Actions logs retain the evidence. No test run remained active at handoff.

The README now has three levels because both job prevention and API cancellation had useful live results. Probe delays are reset to zero. The API cleanup demonstration remains enabled; it affects only its own configured workflow scope.

The Go lint, race-enabled unit tests, build, and real HTTP E2E assertions passed. Zizmor, Poutine, and action-pin checks passed. Actionlint 1.7.12 rejects two syntax features already proven by GitHub execution: `stacked` and the existing `$/.github/...` reusable-workflow calls. Per-file checks passed after filtering only those two diagnostics. I installed no tools.
