#!/usr/bin/env bash
# Export Groth16 verification keys as JSON.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$(cd "$SCRIPT_DIR/../build" && pwd)"
# Invoke the real CLI entry directly rather than via node_modules/.bin/snarkjs:
# on POSIX that path is a symlink to this same file (so it'd work), but npm
# creates a POSIX shell-script shim there on Windows, which `node <path>`
# can't execute as JS — this form works cross-platform.
SNARKJS="node $(cd "$SCRIPT_DIR/../.." && pwd)/node_modules/snarkjs/build/cli.cjs"

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
export_vkey match_proof

echo ""
echo "==> All verification keys exported."
