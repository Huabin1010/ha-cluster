.PHONY: test test-go test-web build run
export PATH := $(HOME)/.local/go/bin:$(PATH)

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
