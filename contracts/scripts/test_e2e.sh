#!/usr/bin/env bash
# Quick smoke test of deployed contracts on testnet.
# Verifies the happy-path flow without the frontend or relayer.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/.env"

NETWORK="testnet"
SOURCE="darkpool-deployer"

echo "==> Running contract smoke tests on testnet..."

echo ""
echo "ZKVerifier — verify stub returns true:"
stellar contract invoke \
  --id "$ZK_VERIFIER_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- verify_order_proof \
  --proof '{"pi_a":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","pi_b":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","pi_c":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}' \
  --public_signals '[]'

echo ""
echo "OrderBook — get order count (expect 0):"
stellar contract invoke \
  --id "$ORDER_BOOK_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- get_order_count

echo ""
echo "Settlement — get settlement count (expect 0):"
stellar contract invoke \
  --id "$SETTLEMENT_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- get_settlement_count

echo ""
echo "==> Smoke tests passed."
