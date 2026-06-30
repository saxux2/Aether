#!/usr/bin/env bash
# Initialize all deployed contracts by calling their initialize() functions.
# Requires .env in project root to be filled with contract addresses.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env not found. Run deploy.sh first."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

NETWORK="testnet"
SOURCE="darkpool-deployer"
DEPLOYER=$(stellar keys address "$SOURCE")

# relayer_1 MUST be the dedicated relayer account (the one whose secret is in
# relayer/.env as RELAYER_SECRET_KEY) — submit_match does relayer_1.require_auth(),
# and the relayer service signs with that key. Using the deployer/trader key here
# reintroduces the session-4 txBadSeq collision (relayer == trader == one sequence).
RELAYER="${RELAYER_ADDRESS:-$(stellar keys address darkpool-relayer)}"

echo "==> Using deployer: $DEPLOYER"
echo "==> Using relayer_1: $RELAYER"
echo ""

# ── ZKVerifier: load the REAL verification keys exported from the circuits ──
# circuits/scripts/export_soroban_vk.js converts circuits/build/*_vk.json into the
# Soroban VerificationKey JSON (BN254 wire encoding) consumed here.
echo "==> Initializing ZKVerifier..."
VK_DIR="$ROOT_DIR/circuits/build"
for f in order_commitment balance_proof range_proof match_proof; do
  if [ ! -f "$VK_DIR/${f}_soroban_vk.json" ]; then
    echo "ERROR: $VK_DIR/${f}_soroban_vk.json missing. Run: node circuits/scripts/export_soroban_vk.js"
    exit 1
  fi
done
VK_ORDER=$(cat "$VK_DIR/order_commitment_soroban_vk.json")
VK_BALANCE=$(cat "$VK_DIR/balance_proof_soroban_vk.json")
VK_RANGE=$(cat "$VK_DIR/range_proof_soroban_vk.json")
VK_MATCH=$(cat "$VK_DIR/match_proof_soroban_vk.json")
stellar contract invoke \
  --id "$ZK_VERIFIER_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --vk_order "$VK_ORDER" \
  --vk_balance "$VK_BALANCE" \
  --vk_range "$VK_RANGE" \
  --vk_match "$VK_MATCH"

echo ""
echo "==> Initializing EscrowVault..."
stellar contract invoke \
  --id "$ESCROW_VAULT_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --matching_engine "$MATCHING_ENGINE_ADDRESS" \
  --settlement "$SETTLEMENT_ADDRESS"

echo ""
echo "==> Initializing OrderBook..."
stellar contract invoke \
  --id "$ORDER_BOOK_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --zk_verifier "$ZK_VERIFIER_ADDRESS" \
  --escrow_vault "$ESCROW_VAULT_ADDRESS"

echo ""
echo "==> Initializing Settlement..."
stellar contract invoke \
  --id "$SETTLEMENT_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --matching_engine "$MATCHING_ENGINE_ADDRESS" \
  --escrow_vault "$ESCROW_VAULT_ADDRESS" \
  --xlm_token "${XLM_SAC_ADDRESS:-CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC}" \
  --usdc_token "${USDC_TOKEN_ADDRESS:-CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA}"

echo ""
echo "==> Initializing MatchingEngine..."
stellar contract invoke \
  --id "$MATCHING_ENGINE_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --order_book "$ORDER_BOOK_ADDRESS" \
  --escrow_vault "$ESCROW_VAULT_ADDRESS" \
  --settlement "$SETTLEMENT_ADDRESS" \
  --zk_verifier "$ZK_VERIFIER_ADDRESS" \
  --relayer_1 "$RELAYER" \
  --relayer_2 "$DEPLOYER" \
  --relayer_3 "$DEPLOYER"

echo ""
echo "==> All contracts initialized."
