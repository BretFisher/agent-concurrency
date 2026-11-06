# CI cancellation and selection: source study

Inspected on 2026-11-05, America/New_York. Source was read at the exact revisions below. Upstream tests were inspected, not run. No upstream action, compiler, package installer, or hosted optimizer was executed. This is a source review, not a security audit or measured savings study.

The problem is general: rapid PR creation and commit updates can leave many obsolete validation jobs running at once. Native stacks add multiple cumulative revisions and more update events. These projects supply useful selection, cancellation, and reuse patterns, but none of the inspected public implementations establishes the complete native-stack cleanup and merge policy needed here.

Read the [implementation guidelines](ci-methodology.md) for the implemented, narrower same-workflow Bash cancellation job and its limits. The later [live stack tests](stack-tests.md) establish the top-PR condition, native `stacked` event delivery, and cancellation behavior; they are separate from this source inspection. The [README](../README.md#retired-enforcement-experiment) summarizes the retired enforcement experiment. This source review does not establish new live behavior.

## Revisions and licenses

| Project | Exact inspected commit | License verified from files | Reuse implication |
| --- | --- | --- | --- |
| Graphite CI action | [`402a89bc8aa6db18ae1f9c61953d001d5f9d828f`](https://github.com/withgraphite/graphite-ci-action/commit/402a89bc8aa6db18ae1f9c61953d001d5f9d828f) | No license established for the adapter. Root tree has no LICENSE/COPYING; package has no license field. | Public access does not establish permission to copy its code. Dependency notices do not license the adapter. |
| Cancel Workflow Action | [`d07a454dad7609a92316b57b23c9ccfd4f59af66`](https://github.com/styfle/cancel-workflow-action/commit/d07a454dad7609a92316b57b23c9ccfd4f59af66) | MIT, declared in root LICENSE and package metadata. | Retain copyright and permission notices when copying substantial implementation text. |
| Skip Duplicate Actions | [`a09bf677ad5e5dedb31a42070b6a180fde0ab6ce`](https://github.com/fkirc/skip-duplicate-actions/commit/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce) | LICENSE contains an MIT grant and a prefatory statement; package says MIT. GitHub metadata reports SPDX `NOASSERTION`. | Preserve the actual license text and notices if copying. Do not describe its metadata as an unambiguous SPDX detection. |
| GitHub Agentic Workflows | [`b78fa776f58d553375a3da45ca2eb2e3148c74c1`](https://github.com/github/gh-aw/commit/b78fa776f58d553375a3da45ca2eb2e3148c74c1) | MIT in root LICENSE. | Retain copyright and permission notices when copying substantial implementation text. |

License evidence: [Graphite tree](https://github.com/withgraphite/graphite-ci-action/tree/402a89bc8aa6db18ae1f9c61953d001d5f9d828f), [package](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/package.json), [dependency notices](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/dist/licenses.txt); [Cancel license](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/LICENSE#L1-L21); [Skip license](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/LICENSE#L1-L24) and [package](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/package.json); [gh-aw license](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/LICENSE#L1-L21).

This study adapts concepts. It copies no implementation source and adds no third-party runtime dependency.

## Comparison against the desired scenario

| Implementation | Decision data | Native stack/current-state support | Older pre-stack work | What can transfer |
| --- | --- | --- | --- | --- |
| Graphite adapter | Repository, PR, event SHA/ref, run IDs sent to a hosted API | Public adapter does not expose the graph algorithm or freshness rules | Not established from public code | Separate a structured policy decision from validation; define fallback behavior |
| Cancel Workflow Action | Event branch/head SHA, current run metadata, selected workflow run list | No stack discovery or current PR-head refresh | Same-branch history can be found; cross-layer membership is absent | Scope workflow IDs and repository identity, list candidates, cancel through API |
| Skip Duplicate Actions | Same-workflow run metadata, Git tree IDs, commit file lists | No native stack selection; content equality differs from current-tip identity | May cancel earlier different-content work on the same branch; not other layers | Separate result reuse, path filtering, concurrent skipping, and cancellation |
| gh-aw `max-stack` | Delivered native stack position/size | Native event snapshot; no current-state API refresh | Missing stack metadata passes; existing runs are untouched | Default `1` gates the whole job before runner setup; N>1 uses a failing pre-step |

The limits below follow the inspected functions. They are not claims about uninspected hosted systems or proof that no other implementation exists.

## 1. Graphite: public adapter, hosted decision

[`run` and `requestWorkflow`](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/src/main.ts#L9-L81) POST to `/api/v1/ci/optimizer`. The body includes a Graphite token, PR/repository identity, SHA/ref, and workflow/job/run metadata. The adapter receives a `skip` decision. It contains no local graph traversal, stack enumeration, pagination, or GitHub cancellation API call. The backend implementation was not established as public in this repository.

[Failure handling](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/src/main.ts#L22-L32) defaults to running checks. [HTTP handling](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/src/main.ts#L83-L149) also sets `skip=false` on error statuses or invalid JSON. A successful JSON response has no runtime schema validation. Generic non-200 handling logs a body containing the token; redaction in every caller context was not established. Do not copy that logging pattern.

The [`github_token` declaration](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/action.yml#L9-L32) is unused by the inspected source. The action emits `skip` although metadata declares no outputs. [`main.test.ts`](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/__tests__/main.test.ts#L47-L81) mocks fetch failure, JSON failure, and a successful response; [`index.test.ts`](https://github.com/withgraphite/graphite-ci-action/blob/402a89bc8aa6db18ae1f9c61953d001d5f9d828f/__tests__/index.test.ts#L5-L16) checks invocation. These do not verify hosted selection, races, pagination, or native GitHub stack support.

**Adaptation:** write a local policy job with a strict decision schema, explicit unknown state, reason, and tested revision. Keep hosted credentials out of the design. An HTTP adapter is not a substitute for implementing the missing graph and freshness logic.

[Graphite CI settings](https://www.graphite.com/docs/stacking-and-ci), [its merge-queue optimizations](https://www.graphite.com/docs/merge-queue-optimizations), and [external GitHub queue integration](https://www.graphite.com/docs/external-merge-queue-integration) describe different systems. Once-per-stack and batching belong to Graphite's queue; batching is labeled private beta in the inspected documentation. Its native GitHub queue integration enqueues dependencies in order. These pages do not establish that Graphite's batching transfers to GitHub's native queue. The queue backend was not inspected.

## 2. Cancel Workflow Action: cancellation mechanics

[`main`, lines 22–68](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/src/index.ts#L22-L68) derives branch/head SHA from the PR or `workflow_run` event and gets current run metadata. It selects the current workflow by default, an explicit list, or `all`. It does not query current stack membership or current PR heads.

[Candidate selection and cancellation](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/src/index.ts#L69-L122) lists up to 100 runs per selected workflow, filtered by branch. It checks source repository ID, current run ID, SHA, status, and creation time. Same-SHA runs are normally preserved. `all_but_latest` uses timestamps from the returned page and can append the current run for self-cancellation. The maximum timestamp is computed before the repository/status filters. This is not authoritative current-commit selection, and equal timestamps or rerun attempts are not resolved by a current-head query.

There is no pagination for the run list; `all` also uses one workflow-list response. Cancellation can be graceful or forced. An error stops the remaining cancellation loop for that workflow, is logged, and is swallowed; the outer action can still report completion. Initial setup errors reach the outer failure handler. A cancellation request is not confirmation that runner work stopped.

The [README](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/README.md#L1-L10) recommends native concurrency first. It also describes a [separate `workflow_run` cleanup job](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/README.md#L83-L105), [runner saturation](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/README.md#L128-L145), and [Actions write permission](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/README.md#L184-L205). Do not combine that permission with execution of untrusted PR code.

No automated assertion tests were found in the complete pinned tree. [`package.json`](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/package.json#L6-L11) builds and formats; the [self-cancel](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/.github/workflows/cancel-self.yml) and [cancel-all](https://github.com/styfle/cancel-workflow-action/blob/d07a454dad7609a92316b57b23c9ccfd4f59af66/.github/workflows/cancel-all.yml) workflows exercise the action and sleep, without checking cancellation outcomes.

**Adaptation:** use first-party REST cancellation with an explicit workflow allowlist, pagination, current-state selection, per-run error handling, and later confirmation. Never adapt `all` into a repository-wide cancellation policy. Separate metadata cleanup from read-only validation.

## 3. Skip Duplicate Actions: content reuse is a separate policy

[`main` and `mapWorkflowRun`](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L450-L553) read the current workflow run and one page of up to 100 runs for that workflow. Runs with missing head-commit data are excluded. Older runs use creation time, not commit ancestry or current stack state.

[`run`](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L114-L187) first attempts configured cancellation, then checks protected events, prior successful trees, concurrent work, and paths. Thus `do_not_skip` does not prevent the earlier cancellation pass. [`cancelOutdatedRuns`](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L189-L231) cancels older, non-completed, different-tree runs on the same branch and source repository; failures are warnings per victim. It does not cancel same-tree duplicates or other stack branches.

[`detectConcurrentRuns`](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L234-L284) implements these distinct policies:

| Mode | Inspected behavior |
| --- | --- |
| `never` | Disable concurrent skipping, not other reuse rules |
| `always` | Skip when another non-completed run exists in the listed workflow history |
| `outdated_runs` | Skip when a listed concurrent run has a later creation time |
| `same_content` | Skip for a concurrent matching tree |
| `same_content_newer` | Skip the current newer run when a matching-tree run has a smaller run number |

Prior-success and concurrent selection are not restricted to the same branch or event; same-branch/repository checks are specific to cancellation. A matching Git tree does not prove equivalent tests when configuration, event inputs, base, toolchains, external state, or vulnerability databases differ. Native layers usually have different cumulative trees. These are limits inferred from the compared fields, not an upstream equivalence guarantee.

[`backtracePathSkipping`](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L286-L409) walks the first parent until a successful matching-tree ancestor or a relevant path is found, with configured limits and a roughly 50-step safety bound. It uses file names from [one commit API response](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L429-L446), without file pagination or rename-source names. GitHub [paginates large commit file lists](https://docs.github.com/en/rest/commits/commits#get-a-commit). This is not the full trunk-to-tip net diff required for stack-aware linting.

Failure responses differ: current-run lookup failure means run validation; a missing current tree or invalid input fails the action; list-run errors are not caught locally; a failed commit lookup stops backtracking and an unresolved global path decision runs validation. See [lookup paths](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L429-L500), [unknown fallback](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L160-L176), and [input validation](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/src/main.ts#L630-L735).

The [Build & Test workflow](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/.github/workflows/test.yml#L11-L97) builds/lints, invokes the action, and conditionally sleeps or prints. [`package.json`](https://github.com/fkirc/skip-duplicate-actions/blob/a09bf677ad5e5dedb31a42070b6a180fde0ab6ce/package.json) has no test command. No focused unit or assertion tests for the selection algorithm were found in the pinned tree.

**Adaptation:** result reuse needs an explicit execution fingerprint, a prior successful result, and provenance. Unknown data should run validation or block pending a retry, not imply a valid result. Cancellation needs Actions write access; read-only selection needs Actions/contents read access. Keep the write-capable API job away from PR code. Do not reuse a generic skip result as merge authorization.

## 4. gh-aw: compiler-generated native stack filter

[`Compiler.applyPullRequestStackFilter`](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/filters.go#L209-L267) compiles `max-stack`. The default `1` adds a job condition for an ordinary PR or the highest native stack position. `-1` disables filtering. For `N > 1`, generated Bash rejects layers outside the top N. The option is removed from generated trigger YAML by [frontmatter cleanup](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/frontmatter_on_section_cleanup.go#L562-L565). It is not normal Actions syntax.

The code enables this filter for `pull_request` and `pull_request_review`, not `pull_request_target` or `merge_group`. It reads only delivered event metadata. Missing stack metadata passes; no current API read, pagination, cancellation, or historical-run cleanup occurs. A former temporary tip can continue after the stack changes.

An important semantic difference: the N>1 path prints a skip summary but uses `exit 1`, after any existing pre-steps. That fails a step; it is not the clean job-level skip used for the default top-only case. [Source](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/filters.go#L241-L265) and [ordering test](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/filters_stack_test.go#L158-L182) establish this behavior. Do not assume every filtering mode has the same required-check result.

Tests include [default conditions](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/filters_stack_test.go#L10-L28), [configured/disabled cases](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/filters_stack_test.go#L30-L88), and [compile integration fixtures](https://github.com/github/gh-aw/blob/b78fa776f58d553375a3da45ca2eb2e3148c74c1/pkg/workflow/filters_stack_integration_test.go#L15-L162). They assert generated text/conditions, not live native stack races or cancellation. The filter itself requires no token; permissions for the rest of a generated workflow are a separate concern.

**Adaptation:** use a plain job condition as a preliminary filter, without installing the compiler. Follow it with current-state checks when the policy requires the current top and head. An event snapshot is not a continuing cancellation policy.

## What this review establishes

**Verified by source inspection:** the four decision mechanisms, their inspected tests, license-file contents, public-code boundaries, and the listed failure/pagination limits.

**Verified separately by this repo's live tests:** per-PR supersession, selected stack-tip cancellation, full-stack Git diff, opt-in revision checks, and the deployment gate's negative cases. The [README](../README.md) retains the concise teaching outcomes; the detailed experiment archive has been removed.

**Now tested separately:** the narrower first-party Bash job cancels eligible earlier lower-stack runs of its own workflow. See [live findings](stack-tests.md).

**Not verified:** a complete repository-wide reconciliation engine; unobserved membership-transition races; a timing bound; correct result reuse across all execution inputs; whole-stack-only merge enforcement; native deployment inheritance in this repository; hosted Graphite internals; or the security of any upstream action. Stars, public source, and tests do not substitute for those proofs.
