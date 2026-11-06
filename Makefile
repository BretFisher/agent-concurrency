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

FORCE_FAILURE ?= false
SHA ?=
.PHONY: deployment-setup deployment-mode deployment-request deployment-state deployment-status stack-merge
deployment-setup:
	bash scripts/configure-gate.sh
deployment-mode:
	gh variable set E2E_MODE --body deployment
deployment-request:
	@test -n "$(PR)" || (echo 'Use make deployment-request PR=<top-pr-number>'; exit 1)
	@head="$(SHA)"; if test -z "$$head"; then head=$$(gh pr view "$(PR)" --json headRefOid --jq .headRefOid); fi; gh workflow run deployment-e2e.yaml --ref main -f pr="$(PR)" -f sha="$$head" -F force_failure=$(FORCE_FAILURE)
deployment-state:
	gh api 'repos/{owner}/{repo}/rules/branches/main'
	gh api 'repos/{owner}/{repo}/deployments?environment=stack-e2e'
deployment-status:
	@test -n "$(DEPLOYMENT)" || (echo 'Use make deployment-status DEPLOYMENT=<id>'; exit 1)
	gh api 'repos/{owner}/{repo}/deployments/$(DEPLOYMENT)/statuses'
stack-merge:
	@test -n "$(STACK)" || (echo 'Use make stack-merge STACK=<stack-number>'; exit 1)
	gh stack merge "$(STACK)" --yes --squash
