#!/usr/bin/env bash
# Export Groth16 verification keys as JSON.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$(cd "$SCRIPT_DIR/../build" && pwd)"
SNARKJS="node $(cd "$SCRIPT_DIR/../.." && pwd)/node_modules/.bin/snarkjs"

export_vkey() {
  local NAME=$1
  echo "==> Exporting verification key: $NAME"
  $SNARKJS zkey export verificationkey \
    "$BUILD/${NAME}_final.zkey" \
    "$BUILD/${NAME}_vk.json"
  echo "    Written: $BUILD/${NAME}_vk.json"
}

export_vkey order_commitment
export_vkey balance_proof
export_vkey range_proof

echo ""
echo "==> All verification keys exported."
