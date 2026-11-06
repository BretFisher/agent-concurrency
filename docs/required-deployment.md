# Require full-stack E2E before merging

A required deployment and a required status check are different GitHub rules. A required status check applies to each PR in a native stack. GitHub documents that a successful deployment for a stack PR also covers lower PRs while the stack has a linear history. This example tests that difference with the `stack-e2e` environment. **Live result: the expected lower-layer deployment inheritance was not reproduced.** Missing, failed, canceled, and stale evidence blocked merges correctly, but a successful active top deployment still did not permit the native stack merge. Read the evidence before using this as a stack optimization.

This is a **simulated deployment** to an ephemeral Actions runner. The existing test starts a local HTTP server and checks its status, body, and content type. There is no remote service, cloud account, persistent endpoint, or environment secret. The deployment object records the tested revision and its result. This is useful for teaching the merge rule; a real preview deployment would replace the local server setup.

[Execution evidence](deployment-evidence.md) distinguishes observed results from documented expectations. Earlier [status-check and cancellation evidence](evidence.md) remains unchanged.

## Set it up in GitHub

You need repository administrator access. No additional tools are installed by this repo.

1. Open the repository's **Settings → Environments**. Select **New environment**, enter `stack-e2e`, and save.
2. For this demo, leave required reviewers and wait timers off. Add no secrets. These environment protection options control when an Actions job may enter an environment. They are separate from the branch merge requirement.
3. Open **Settings → Rules → Rulesets → New ruleset → New branch ruleset**. Name it `Stack E2E gate`. Set enforcement to **Active**.
4. Under target branches, include `main`. Leave the bypass list empty. Administrators must pass this rule too.
5. Enable **Require deployments to succeed before merging**. Select `stack-e2e`.
6. Enable **Require status checks to pass**. Add `Fast PR Checks / Lint Full Stack` and `Fast PR Checks / Unit Test And Build`, from GitHub Actions. These real cheap checks run on every layer. They must run once before they appear in the selector. Keep strict up-to-date checking off for this small demo.
7. Enable **Require a pull request before merging** with zero required approvals for this single-owner teaching repo. Block force pushes and deletion of `main`. Save.
8. Run `make deployment-mode`. This switches automatic CI to cheap per-PR checks. It does not create deployments automatically.

The equivalent setup is stored in `.github/stack-e2e-ruleset.json`. To create or update the environment and named ruleset through the API, run:

```sh
make deployment-setup
make deployment-state
```

The setup target needs administrator access and activates the gate. It is not a test command. It has no bypass actors and does not weaken the rule after a test failure. It also selects deployment mode. Run it in your intended repository; GitHub CLI resolves the current checkout's owner and name.

## Request the test

Create and finish a native stack with `gh stack`. Push its branches. The top SHA contains every lower layer. Then run:

```sh
make deployment-request PR=TOP_PR_NUMBER
make demo-status
```

The target reads the current full SHA and dispatches the trusted workflow **from main**. For an explicit immutable request, use:

```sh
make deployment-request PR=TOP_PR_NUMBER SHA=FULL_40_CHARACTER_SHA
```

The workflow rejects a stale head, closed PR, lower layer, foreign repository, non-main trunk, or non-linear stack. It records all member heads and the trunk SHA. New commits and rebases need a new request. A change during testing makes final reporting fail instead of publishing success.

Use these targets to inspect the record and merge:

```sh
make deployment-state
make deployment-status DEPLOYMENT=DEPLOYMENT_ID
make stack-merge STACK=STACK_NUMBER
```

The status target shows the deployment's status history. The deployment record's `sha` must equal the tested top SHA. This demo's ruleset requires its two cheap checks on each layer. The intended inheritance test requires lower layers to have no separate `stack-e2e` deployments. Merge the whole native stack through its asynchronous merge command. Do not disable the rule or use bypass to demonstrate success.

## How the workflows work

1. **Open Exact SHA Deployment** runs from trusted `main`. It queries current stack state, checks each adjacent head is an ancestor of the next, and creates a deployment using the current PR branch name. It immediately requires the API-resolved deployment SHA to equal the exact input SHA. A concurrent branch update causes failure, never success. It sets `auto_merge: false` to prevent the API from changing the revision. `required_contexts: []` avoids the deployment API's separate commit-status precheck; it does not bypass the branch ruleset. The deployment starts as `in_progress`.
2. **Test Read Only Revision** calls the shared workflow from the trusted workflow revision. It checks out only the requested app SHA. Lint and race tests/build run first. The real HTTP test then runs with no artificial wait. This code has only contents-read permission. It receives no deployment write token or secrets. The full-stack Git diff appears in the lint job summary.
3. **Deployment Result** starts on the completed source workflow. It verifies the source workflow ID, repository, event, branch, run ID, and attempt. It finds the matching deployment created by the Actions bot. It reads the source's final conclusion, then rechecks current heads, base, tip position, and linear history. Only an unchanged stack and a successful source can produce deployment `success`. A failed or canceled source produces `failure`.

The reporting workflow has deployment-write access but never checks out code, reads artifacts, or executes PR files. This is why the `workflow_run` trigger is safe in this specific design. The Zizmor exception is scoped to that trigger and documented in the workflow. Other security checks still run. Both write-token jobs use only a pinned API action. They do not name `job.environment`: doing that on a dispatch job could auto-create a deployment for `main` rather than the app SHA. The explicit deployment API names `stack-e2e` and the app SHA instead.

Requests for one PR are serialized without canceling the reporter. You can cancel an E2E source run manually to test cleanup. Wait for its separate result workflow. If the reporter is also interrupted or the API is unavailable, a deployment can remain `in_progress`; that is a blocked gate, not success. Retry the result workflow after resolving the error.

## Reproduce failure and stale-evidence tests

Start with no successful deployment for the stack's head. Wait for the cheap checks, then attempt `make stack-merge`. The deployment rule should block it.

Run a real HTTP test followed by an explicit teaching fault:

```sh
make deployment-request PR=TOP_PR_NUMBER FORCE_FAILURE=true
```

The E2E job deliberately exits with an error after the HTTP assertions. The source and result workflows should fail; the deployment should have status `failure`. Attempt the merge again. It should remain blocked.

Run the normal request and verify deployment `success`. Before merging, add and push a new top commit with `gh stack push`. The previous deployment still names the old SHA. Attempt the merge again; the new head should be blocked. Request E2E for the new SHA, wait for the source and result workflows, verify lower heads have no deployments, then merge with the ruleset still active.

These are expected outcomes until backed by the linked execution evidence. Do not merge early during the stale-evidence test.

## Limits and trust

- Native stacks can merge a selected PR and its lower layers. This rule does not enforce a whole-stack-only merge policy.
- This API-only example does not use environment approval protection rules. Adding environment reviewers alone does not add an approval step to these jobs.
- The deployment is simulated. The HTTP assertions are real. There is no claim that an external service was deployed.
- Dispatching this workflow from a feature branch is rejected. Review changes to the trusted workflows before merging them to `main`.
- A repository administrator can change rules. A credential with deployment-write permission can create deployment statuses. This rule does not authenticate the contents of a test report against a malicious maintainer. Protect those credentials and workflow files in a production repository.
- API reads and the success update are not atomic. The final check rejects changes seen during testing; the exact-SHA merge gate must reject later head changes. The evidence tests that path, not every concurrent update race.
- A later change to the trunk or a partially merged/rebased stack can require a new request. This demo uses complete linear stacks and no merge queue. It does not prove every merge-queue or partial-stack case.
- `auto_inactive: false` retains successful records across independent stacks. This avoids one stack's test automatically marking another's record inactive. It does not make an old record apply to a new SHA.
- The earlier `make e2e-request` is still a standalone opt-in test. It creates no deployment and cannot satisfy this gate. Changing `E2E_MODE` does not remove the active required-deployment rule.

## Sources

- [GitHub rulesets: required deployments and lower stack layers](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets#require-deployments-to-succeed-before-merging)
- [GitHub: native stack rules](https://docs.github.com/en/pull-requests/reference/stacked-pull-requests)
- [GitHub: create an exact-ref deployment](https://docs.github.com/en/rest/deployments/deployments#create-a-deployment)
- [GitHub: deployment statuses](https://docs.github.com/en/rest/deployments/statuses#create-a-deployment-status)
- [GitHub: ruleset API](https://docs.github.com/en/rest/repos/rules#create-a-repository-ruleset)
