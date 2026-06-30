#!/usr/bin/env bash
# Deploy all Soroban contracts to Stellar testnet.
# Run contracts/scripts/build.sh first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$CONTRACTS_DIR/.." && pwd)"

TARGET="$CONTRACTS_DIR/target/wasm32v1-none/release"
NETWORK="testnet"
SOURCE="darkpool-deployer"

# ── Key setup ──────────────────────────────────────────────────────────────
echo "==> Checking deployer key..."
if ! stellar keys address "$SOURCE" &>/dev/null; then
  echo "Creating deployer key..."
  stellar keys generate --global "$SOURCE" --network "$NETWORK"
fi

DEPLOYER_ADDRESS=$(stellar keys address "$SOURCE")
echo "    Deployer: $DEPLOYER_ADDRESS"

# Fund via Friendbot (safe to call even if already funded)
echo "==> Funding deployer via Friendbot..."
FUND_RESULT=$(curl -sf "https://friendbot.stellar.org/?addr=$DEPLOYER_ADDRESS" 2>&1 || true)
echo "    $FUND_RESULT" | head -1
sleep 3

# ── Deploy contracts ───────────────────────────────────────────────────────
deploy() {
  local NAME=$1
  local WASM="$TARGET/${NAME}.optimized.wasm"
  # Fall back to unoptimized if optimized doesn't exist
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

# ── Write root .env ────────────────────────────────────────────────────────
ROOT_ENV="$ROOT_DIR/.env"
cp "$ROOT_DIR/.env.example" "$ROOT_ENV" 2>/dev/null || cat > "$ROOT_ENV" << ENVEOF
ZK_VERIFIER_ADDRESS=
ESCROW_VAULT_ADDRESS=
ORDER_BOOK_ADDRESS=
MATCHING_ENGINE_ADDRESS=
SETTLEMENT_ADDRESS=
USDC_TOKEN_ADDRESS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
ENVEOF

sed -i "s|ZK_VERIFIER_ADDRESS=.*|ZK_VERIFIER_ADDRESS=$ZK_VERIFIER|"       "$ROOT_ENV"
sed -i "s|ESCROW_VAULT_ADDRESS=.*|ESCROW_VAULT_ADDRESS=$ESCROW_VAULT|"    "$ROOT_ENV"
sed -i "s|ORDER_BOOK_ADDRESS=.*|ORDER_BOOK_ADDRESS=$ORDER_BOOK|"          "$ROOT_ENV"
sed -i "s|MATCHING_ENGINE_ADDRESS=.*|MATCHING_ENGINE_ADDRESS=$MATCHING_ENGINE|" "$ROOT_ENV"
sed -i "s|SETTLEMENT_ADDRESS=.*|SETTLEMENT_ADDRESS=$SETTLEMENT|"          "$ROOT_ENV"

# ── Write relayer .env ─────────────────────────────────────────────────────
RELAYER_ENV="$ROOT_DIR/relayer/.env"
if [ -f "$RELAYER_ENV" ]; then
  sed -i "s|ZK_VERIFIER_ADDRESS=.*|ZK_VERIFIER_ADDRESS=$ZK_VERIFIER|"       "$RELAYER_ENV"
  sed -i "s|ESCROW_VAULT_ADDRESS=.*|ESCROW_VAULT_ADDRESS=$ESCROW_VAULT|"    "$RELAYER_ENV"
  sed -i "s|ORDER_BOOK_ADDRESS=.*|ORDER_BOOK_ADDRESS=$ORDER_BOOK|"          "$RELAYER_ENV"
  sed -i "s|MATCHING_ENGINE_ADDRESS=.*|MATCHING_ENGINE_ADDRESS=$MATCHING_ENGINE|" "$RELAYER_ENV"
  sed -i "s|SETTLEMENT_ADDRESS=.*|SETTLEMENT_ADDRESS=$SETTLEMENT|"          "$RELAYER_ENV"
  echo "==> Updated relayer/.env"
fi

# ── Write frontend .env.local ──────────────────────────────────────────────
FRONTEND_ENV="$ROOT_DIR/frontend/.env.local"
cat > "$FRONTEND_ENV" << EOF
NEXT_PUBLIC_RELAYER_URL=http://localhost:3001
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=$ZK_VERIFIER
NEXT_PUBLIC_ORDER_BOOK_ADDRESS=$ORDER_BOOK
NEXT_PUBLIC_ESCROW_VAULT_ADDRESS=$ESCROW_VAULT
NEXT_PUBLIC_MATCHING_ENGINE_ADDRESS=$MATCHING_ENGINE
NEXT_PUBLIC_SETTLEMENT_ADDRESS=$SETTLEMENT
NEXT_PUBLIC_XLM_TOKEN_ADDRESS=native
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
EOF
echo "==> Written frontend/.env.local"

# ── Summary ────────────────────────────────────────────────────────────────
echo ""
echo "==> Deployment complete."
echo "    ZK_VERIFIER:     $ZK_VERIFIER"
echo "    ESCROW_VAULT:    $ESCROW_VAULT"
echo "    ORDER_BOOK:      $ORDER_BOOK"
echo "    SETTLEMENT:      $SETTLEMENT"
echo "    MATCHING_ENGINE: $MATCHING_ENGINE"
echo ""
echo "    Run contracts/scripts/initialize.sh next."
