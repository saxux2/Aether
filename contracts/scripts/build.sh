#!/usr/bin/env bash
# Build all Soroban contracts in dependency order.
# cross-contract contractimport! requires dependency WASMs to exist first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CONTRACTS_DIR"

TARGET="target/wasm32v1-none/release"

build_contract() {
  local PKG=$1
  echo "==> Building $PKG..."
  cargo build --release --target wasm32v1-none --package "$PKG"
  echo "    $TARGET/${PKG}.wasm"
}

# Step 1: contracts with no dependencies
build_contract zk_verifier
build_contract escrow_vault

# Step 2: OrderBook (depends on zk_verifier + escrow_vault WASMs)
build_contract order_book

# Step 3: Settlement (depends on escrow_vault WASM)
build_contract settlement

# Step 4: MatchingEngine (depends on order_book + escrow_vault + settlement WASMs)
build_contract matching_engine

echo ""
echo "==> All contracts built successfully."
echo "    Run scripts/deploy.sh to deploy to testnet."
