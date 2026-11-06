SIMULATED_E2E_DELAY ?= 0s

.PHONY: lint test build e2e check run
lint:
	test -z "$$(gofmt -l cmd internal e2e)"
	go vet ./...
test:
	go test -race -cover ./...
build:
	go build ./...
e2e:
	SIMULATED_E2E_DELAY=$(SIMULATED_E2E_DELAY) go test -tags=e2e -race -count=1 -v ./e2e
check: lint test build e2e
run:
	go run ./cmd/hello

.PHONY: e2e-request e2e-mode automatic-mode demo-status
e2e-request:
	@test -n "$(PR)" || (echo 'Use make e2e-request PR=<top-pr-number>'; exit 1)
	gh workflow run opt-in.yaml -f pr="$(PR)" -f sha="$$(gh pr view "$(PR)" --json headRefOid --jq .headRefOid)"
e2e-mode:
	gh variable set E2E_MODE --body opt-in
automatic-mode:
	gh variable set E2E_MODE --body automatic
demo-status:
	gh run list --limit 10

.PHONY: stack-cancel-test stack-cancel
stack-cancel-test:
	shellcheck scripts/cancel-lower-stack-runs.sh
	python3 tests/test_stack_cancel.py
REPO ?= BretFisher/agent-concurrency
DRY_RUN ?= true
stack-cancel:
	@test -n "$(RUN_ID)" || (echo 'Use make stack-cancel RUN_ID=<top-workflow-run-id>'; exit 1)
	GITHUB_REPOSITORY="$(REPO)" GITHUB_RUN_ID="$(RUN_ID)" STACK_CANCEL_DRY_RUN="$(DRY_RUN)" bash scripts/cancel-lower-stack-runs.sh

.PHONY: stack-probe-delay stack-prune-enable stack-prune-disable
PROBE_SECONDS ?= 0
stack-probe-delay:
	gh variable set STACK_PROBE_SECONDS --body "$(PROBE_SECONDS)"
stack-prune-enable:
	gh variable set STACK_PRUNE_ENABLED --body true
stack-prune-disable:
	gh variable set STACK_PRUNE_ENABLED --body false

# TypeScript action development. The bundled action needs no runtime install.
.PHONY: action-install action-typecheck action-test action-build action-check
action-install:
	npm ci
action-typecheck:
	npm run typecheck
action-test:
	npm test
action-build:
	npm run build
action-check:
	npm run check

# GitHub accepted these activities in the live tests. Keep the schema
# exclusions exact so other workflow errors still fail this check.
.PHONY: action-workflow-check
action-workflow-check:
	actionlint -ignore '^invalid activity type "stacked"' .github/workflows/stack-prune.yaml .github/workflows/stack-if-probe.yaml .github/workflows/stack-cancel.yaml
