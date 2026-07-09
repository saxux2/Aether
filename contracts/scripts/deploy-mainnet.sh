#!/usr/bin/env bash
# Deploy all Soroban contracts to Stellar MAINNET.
# Run contracts/scripts/build.sh first. This is the mainnet counterpart of
# deploy.sh — it never calls Friendbot and never touches the testnet .env.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$CONTRACTS_DIR/.." && pwd)"

TARGET="$CONTRACTS_DIR/target/wasm32v1-none/release"
NETWORK="mainnet"
SOURCE="darkpool-mainnet-deployer"
PASSPHRASE="Public Global Stellar Network ; September 2015"

# Stellar's CLI does not ship a default mainnet RPC endpoint the way it does
# for testnet — you must supply one (a provider like a paid RPC node, or your
# own). Set STELLAR_MAINNET_RPC_URL before running this script.
: "${STELLAR_MAINNET_RPC_URL:?ERROR: set STELLAR_MAINNET_RPC_URL to a mainnet Soroban RPC endpoint before deploying}"

# ── Sanity checks before spending real money ────────────────────────────────
echo "==> Pre-flight checks..."

if ! stellar keys address "$SOURCE" &>/dev/null; then
  echo "ERROR: deployer key '$SOURCE' not found."
  echo "  Create it with: stellar keys generate --global $SOURCE --network $NETWORK"
  echo "  Then fund it with real XLM before re-running this script."
  exit 1
fi

DEPLOYER_ADDRESS=$(stellar keys address "$SOURCE")
echo "    Deployer: $DEPLOYER_ADDRESS"

# Register (or refresh) the mainnet network alias explicitly rather than
# assuming it's already configured on this machine.
stellar network add "$NETWORK" \
  --rpc-url "$STELLAR_MAINNET_RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  --overwrite

# There is no Friendbot on mainnet. Confirm the deployer actually has funds
# instead of silently failing partway through five deployments.
BALANCE_XLM=$(stellar contract invoke --id native --source "$SOURCE" --network "$NETWORK" -- balance --id "$DEPLOYER_ADDRESS" 2>/dev/null || echo "0")
echo "    Deployer XLM balance (raw stroops): $BALANCE_XLM"
if [ "$BALANCE_XLM" = "0" ]; then
  echo "ERROR: deployer account has no funds (or doesn't exist on-chain yet)."
  echo "  Send real XLM to $DEPLOYER_ADDRESS from an exchange or wallet, then re-run."
  exit 1
fi

read -r -p "About to deploy 5 contracts to MAINNET using $DEPLOYER_ADDRESS. Type 'yes' to continue: " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

# ── Deploy contracts ───────────────────────────────────────────────────────
deploy() {
  local NAME=$1
  local WASM="$TARGET/${NAME}.optimized.wasm"
  [ -f "$WASM" ] || WASM="$TARGET/${NAME}.wasm"
  echo "==> Deploying $NAME from $WASM..."
  local ADDR
  ADDR=$(stellar contract deploy \
    --wasm "$WASM" \
    --source "$SOURCE" \
    --network "$NETWORK")
  echo "    $NAME: $ADDR"
  echo "$ADDR"
}

ZK_VERIFIER=$(deploy zk_verifier)
ESCROW_VAULT=$(deploy escrow_vault)
ORDER_BOOK=$(deploy order_book)
SETTLEMENT=$(deploy settlement)
MATCHING_ENGINE=$(deploy matching_engine)

# ── Write mainnet env files (never overwrite the testnet .env files) ───────
MAINNET_ENV="$ROOT_DIR/.env.mainnet"
cat > "$MAINNET_ENV" << EOF
STELLAR_NETWORK=mainnet
STELLAR_RPC_URL=$STELLAR_MAINNET_RPC_URL
STELLAR_HORIZON_URL=https://horizon.stellar.org
STELLAR_NETWORK_PASSPHRASE=$PASSPHRASE
ZK_VERIFIER_ADDRESS=$ZK_VERIFIER
ESCROW_VAULT_ADDRESS=$ESCROW_VAULT
ORDER_BOOK_ADDRESS=$ORDER_BOOK
MATCHING_ENGINE_ADDRESS=$MATCHING_ENGINE
SETTLEMENT_ADDRESS=$SETTLEMENT
USDC_TOKEN_ADDRESS=
EOF
echo "==> Written $MAINNET_ENV (fill in USDC_TOKEN_ADDRESS with the real mainnet USDC issuer/SAC)"

RELAYER_ENV="$ROOT_DIR/relayer/.env.mainnet"
cat > "$RELAYER_ENV" << EOF
STELLAR_NETWORK=mainnet
STELLAR_RPC_URL=$STELLAR_MAINNET_RPC_URL
STELLAR_NETWORK_PASSPHRASE=$PASSPHRASE
ZK_VERIFIER_ADDRESS=$ZK_VERIFIER
ESCROW_VAULT_ADDRESS=$ESCROW_VAULT
ORDER_BOOK_ADDRESS=$ORDER_BOOK
MATCHING_ENGINE_ADDRESS=$MATCHING_ENGINE
SETTLEMENT_ADDRESS=$SETTLEMENT
RELAYER_SECRET_KEY=
EOF
echo "==> Written $RELAYER_ENV (fill in RELAYER_SECRET_KEY with the dedicated mainnet relayer key — do NOT reuse the deployer key)"

FRONTEND_ENV="$ROOT_DIR/frontend/.env.production.local"
cat > "$FRONTEND_ENV" << EOF
NEXT_PUBLIC_RELAYER_URL=
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_STELLAR_RPC_URL=$STELLAR_MAINNET_RPC_URL
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=$ZK_VERIFIER
NEXT_PUBLIC_ORDER_BOOK_ADDRESS=$ORDER_BOOK
NEXT_PUBLIC_ESCROW_VAULT_ADDRESS=$ESCROW_VAULT
NEXT_PUBLIC_MATCHING_ENGINE_ADDRESS=$MATCHING_ENGINE
NEXT_PUBLIC_SETTLEMENT_ADDRESS=$SETTLEMENT
NEXT_PUBLIC_XLM_TOKEN_ADDRESS=native
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=
EOF
echo "==> Written $FRONTEND_ENV (fill in NEXT_PUBLIC_RELAYER_URL and NEXT_PUBLIC_USDC_TOKEN_ADDRESS)"

echo ""
echo "==> Mainnet deployment complete."
echo "    ZK_VERIFIER:     $ZK_VERIFIER"
echo "    ESCROW_VAULT:    $ESCROW_VAULT"
echo "    ORDER_BOOK:      $ORDER_BOOK"
echo "    SETTLEMENT:      $SETTLEMENT"
echo "    MATCHING_ENGINE: $MATCHING_ENGINE"
echo ""
echo "    Fill in the USDC token address and relayer key above, then run:"
echo "    contracts/scripts/initialize-mainnet.sh"
