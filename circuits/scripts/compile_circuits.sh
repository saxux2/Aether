#!/usr/bin/env bash
# Requires: circom 2.x (cargo install --git https://github.com/iden3/circom --tag v2.2.2)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$CIRCUITS_DIR/.." && pwd)"

cd "$CIRCUITS_DIR"
mkdir -p build

# circom -l needs the dir that CONTAINS node_modules/circomlib
LIB_PATH="$ROOT_DIR"

CIRCOM_BIN="${HOME}/.cargo/bin/circom"
if ! command -v "$CIRCOM_BIN" &>/dev/null; then
  CIRCOM_BIN="circom"
fi
echo "==> Using circom: $("$CIRCOM_BIN" --version)"

for CIRC in order_commitment balance_proof range_proof match_proof; do
  echo "==> Compiling ${CIRC}.circom..."
  "$CIRCOM_BIN" "${CIRC}.circom" --r1cs --wasm --sym -o build/ -l "$LIB_PATH"
  # Flatten WASM from JS subdir to build/ for snarkjs
  cp "build/${CIRC}_js/${CIRC}.wasm" "build/${CIRC}.wasm"
done

echo ""
echo "==> Circuit compilation complete. Artifacts in: $CIRCUITS_DIR/build/"
echo "    Next step: run scripts/setup_ceremony.sh"
