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
