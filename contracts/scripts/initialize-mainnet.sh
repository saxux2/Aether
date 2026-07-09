#!/usr/bin/env bash
# Initialize all mainnet-deployed contracts by calling their initialize() functions.
# Requires .env.mainnet in project root (written by deploy-mainnet.sh) to be
# filled with contract addresses, the real USDC token address, and three
# genuinely distinct relayer addresses.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.mainnet"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: .env.mainnet not found. Run contracts/scripts/deploy-mainnet.sh first."
  exit 1
fi

# shellcheck disable=SC1090
source "$ENV_FILE"

NETWORK="mainnet"
SOURCE="darkpool-mainnet-deployer"
DEPLOYER=$(stellar keys address "$SOURCE")

# Unlike the testnet script, mainnet relayers must be explicit, distinct
# addresses — never derived from a fallback CLI key alias and never allowed
# to silently collapse to the deployer address (that reintroduces the
# single-signer risk the 3-relayer design exists to avoid).
: "${RELAYER_1_ADDRESS:?ERROR: set RELAYER_1_ADDRESS to the dedicated relayer services mainnet address}"
: "${RELAYER_2_ADDRESS:?ERROR: set RELAYER_2_ADDRESS to a second, independently held mainnet address}"
: "${RELAYER_3_ADDRESS:?ERROR: set RELAYER_3_ADDRESS to a third, independently held mainnet address}"
: "${USDC_TOKEN_ADDRESS:?ERROR: set USDC_TOKEN_ADDRESS to the real mainnet USDC issuer/SAC address}"

if [ "$RELAYER_1_ADDRESS" = "$RELAYER_2_ADDRESS" ] || \
   [ "$RELAYER_1_ADDRESS" = "$RELAYER_3_ADDRESS" ] || \
   [ "$RELAYER_2_ADDRESS" = "$RELAYER_3_ADDRESS" ]; then
  echo "ERROR: RELAYER_1_ADDRESS, RELAYER_2_ADDRESS, RELAYER_3_ADDRESS must all be distinct."
  exit 1
fi
if [ "$RELAYER_1_ADDRESS" = "$DEPLOYER" ] || \
   [ "$RELAYER_2_ADDRESS" = "$DEPLOYER" ] || \
   [ "$RELAYER_3_ADDRESS" = "$DEPLOYER" ]; then
  echo "ERROR: relayer addresses must not be the deployer/admin address."
  exit 1
fi

echo "==> Using deployer/admin: $DEPLOYER"
echo "==> Using relayer_1:      $RELAYER_1_ADDRESS"
echo "==> Using relayer_2:      $RELAYER_2_ADDRESS"
echo "==> Using relayer_3:      $RELAYER_3_ADDRESS"
echo ""

# ── ZKVerifier: load the REAL verification keys from the real ceremony ─────
# These must come from circuits/scripts/setup_ceremony.sh run with multiple
# independent contributors — not the single-party testnet keys.
#
# Provenance is checked programmatically, not just by asking a human to type
# "yes": each circuit's setup_ceremony_finalize.sh writes a manifest
# (<name>_ceremony_manifest.json) recording how many DISTINCT contributors
# the ledger shows and a sha256 of the finalized zkey. Refuse to proceed
# unless every circuit has one showing at least MIN_CONTRIBUTORS (default 3)
# and the zkey on disk still matches what was recorded at finalize time. This
# exists because a purely human "did you check this?" confirmation is a
# self-attestation with no technical verification behind it — exactly the
# gap that let the single-contributor testnet keys almost get treated as
# mainnet-ready earlier in this project's history.
VK_DIR="$ROOT_DIR/circuits/build"
MIN_CONTRIBUTORS="${MIN_CONTRIBUTORS:-3}"
for f in order_commitment balance_proof range_proof match_proof; do
  if [ ! -f "$VK_DIR/${f}_soroban_vk.json" ]; then
    echo "ERROR: $VK_DIR/${f}_soroban_vk.json missing. Run: node circuits/scripts/export_soroban_vk.js"
    exit 1
  fi

  MANIFEST="$VK_DIR/${f}_ceremony_manifest.json"
  if [ ! -f "$MANIFEST" ]; then
    echo "ERROR: no ceremony manifest at $MANIFEST."
    echo "       Run the full setup_ceremony_contribute.sh (x$MIN_CONTRIBUTORS+ independent"
    echo "       contributors) -> setup_ceremony_finalize.sh flow for '$f' before mainnet init."
    exit 1
  fi

  CONTRIBUTORS=$(grep -o '"distinct_contributors": *[0-9]*' "$MANIFEST" | grep -o '[0-9]*$')
  if [ -z "$CONTRIBUTORS" ] || [ "$CONTRIBUTORS" -lt "$MIN_CONTRIBUTORS" ]; then
    echo "ERROR: $MANIFEST records only ${CONTRIBUTORS:-0} distinct contributor(s),"
    echo "       need at least $MIN_CONTRIBUTORS. Refusing to initialize mainnet with '$f'."
    exit 1
  fi

  RECORDED_SHA256=$(grep -o '"final_zkey_sha256": *"[a-f0-9]*"' "$MANIFEST" | grep -o '[a-f0-9]\{64\}')
  ACTUAL_SHA256=$(sha256sum "$VK_DIR/${f}_final.zkey" 2>/dev/null | awk '{print $1}')
  if [ -z "$RECORDED_SHA256" ] || [ "$RECORDED_SHA256" != "$ACTUAL_SHA256" ]; then
    echo "ERROR: $VK_DIR/${f}_final.zkey does not match the sha256 recorded in $MANIFEST"
    echo "       (recorded: ${RECORDED_SHA256:-none}, actual: ${ACTUAL_SHA256:-missing file})."
    echo "       The zkey may have been modified or replaced after the ceremony finalized."
    exit 1
  fi

  echo "==> $f: ceremony manifest OK ($CONTRIBUTORS contributors, zkey hash matches)"
done

echo ""
echo "WARNING: this initializes 5 contracts on MAINNET. This cannot be undone."
read -r -p "All 4 ceremony manifests verified above. Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "==> Initializing ZKVerifier..."
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
echo "==> Resolving native XLM's Stellar Asset Contract address on mainnet..."
XLM_SAC_ADDRESS=$(stellar contract id asset --asset native --network "$NETWORK")
echo "    XLM SAC: $XLM_SAC_ADDRESS"

echo ""
echo "==> Initializing EscrowVault..."
stellar contract invoke \
  --id "$ESCROW_VAULT_ADDRESS" \
  --source "$SOURCE" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$DEPLOYER" \
  --matching_engine "$MATCHING_ENGINE_ADDRESS" \
  --settlement "$SETTLEMENT_ADDRESS" \
  --xlm_token "$XLM_SAC_ADDRESS" \
  --usdc_token "$USDC_TOKEN_ADDRESS"

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
  --xlm_token "$XLM_SAC_ADDRESS" \
  --usdc_token "$USDC_TOKEN_ADDRESS"

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
  --relayer_1 "$RELAYER_1_ADDRESS" \
  --relayer_2 "$RELAYER_2_ADDRESS" \
  --relayer_3 "$RELAYER_3_ADDRESS"

echo ""
echo "==> All contracts initialized on MAINNET."
echo "    Consider testing set_paused(admin, true)/(admin, false) on each contract now,"
echo "    while amounts at risk are zero, to confirm the emergency switch works before real traffic."
