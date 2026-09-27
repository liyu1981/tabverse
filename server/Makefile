BIN      := tabversed
MODULE   := github.com/liyu1981/tabverse/server
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  := -s -w -X $(MODULE)/internal/version.Version=$(VERSION)

.PHONY: build run test vet fmt lint clean cross docker

build:
	CGO_ENABLED=0 go build -trimpath -ldflags '$(LDFLAGS)' -o bin/$(BIN) ./cmd/tabversed

run: build
	TABVERSED_DB=./data/tabversed.db ./bin/$(BIN)

test:
	go test ./...

test-race:
	go test -race ./...

vet:
	go vet ./...

fmt:
	gofmt -l -w .

## Cross compile all common targets (pure Go, no cgo needed).
cross:
	mkdir -p dist
	CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/$(BIN)-linux-amd64   ./cmd/tabversed
	CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/$(BIN)-linux-arm64   ./cmd/tabversed
	CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/$(BIN)-darwin-amd64  ./cmd/tabversed
	CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/$(BIN)-darwin-arm64  ./cmd/tabversed
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags '$(LDFLAGS)' -o dist/$(BIN)-windows-amd64.exe ./cmd/tabversed

docker:
	docker build --build-arg VERSION=$(VERSION) -t tabversed:$(VERSION) -t tabversed:latest .

clean:
	rm -rf bin dist
