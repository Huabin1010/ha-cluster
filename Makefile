.PHONY: test test-go test-web build run dev dev-api dev-docker dev-docker-test dev-docker-down
export PATH := $(HOME)/.local/go/bin:$(HOME)/go/bin:$(PATH)

test: test-go test-web

test-go:
	go test ./...

test-web:
	cd web && npm test

build:
	mkdir -p bin
	go build -o bin/ha-api ./cmd/ha-api
	go build -o bin/ha-agent ./cmd/ha-agent
	go build -o bin/ha-setup ./cmd/ha-setup
	go build -o bin/hactl ./cmd/hactl
	go build -o bin/ha-bastion-proxy ./cmd/ha-bastion-proxy

run:
	go run ./cmd/ha-api

dev: dev-api

dev-api:
	@which air >/dev/null 2>&1 || go install github.com/air-verse/air@latest
	air

dev-docker:
	@bash docker/dev/up.sh

dev-docker-test:
	cd docker/dev && docker compose --profile test run --rm test-integration
	cd docker/dev && docker compose --profile test run --rm test-workflow

dev-docker-down:
	cd docker/dev && docker compose down
