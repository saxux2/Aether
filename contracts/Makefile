SHELL := /bin/bash
TARGET := wasm32v1-none
RELEASE_DIR := target/$(TARGET)/release

.PHONY: build test fmt lint deploy optimize

build:
	bash scripts/build.sh

test:
	cargo test

fmt:
	cargo fmt --all

lint:
	cargo clippy -- -D warnings

optimize: build
	@for wasm in $(RELEASE_DIR)/*.wasm; do \
		echo "==> Optimizing $$wasm"; \
		stellar contract optimize --wasm "$$wasm"; \
	done

deploy:
	@if [ -z "$(STELLAR_SECRET_KEY)" ]; then \
		echo "ERROR: STELLAR_SECRET_KEY is not set"; exit 1; \
	fi
	@for wasm in $(RELEASE_DIR)/*.optimized.wasm; do \
		echo "==> Deploying $$wasm"; \
		stellar contract deploy \
			--wasm "$$wasm" \
			--source "$(STELLAR_SECRET_KEY)" \
			--network testnet; \
	done
