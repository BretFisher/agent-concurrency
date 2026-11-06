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
