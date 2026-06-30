#!/usr/bin/env bash
# Groth16 trusted setup for all three circuits.
# Uses the Hermez Powers of Tau public ceremony (pot12 — 4096 constraints max).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD="$CIRCUITS_DIR/build"

cd "$BUILD"

SNARKJS="node $(cd "$CIRCUITS_DIR/.." && pwd)/node_modules/.bin/snarkjs"

# Download the Powers of Tau if not already present (GCS mirror — publicly accessible)
PTAU="$BUILD/pot12_final.ptau"
if [ ! -f "$PTAU" ] || [ "$(wc -c < "$PTAU")" -lt 1000000 ]; then
  echo "==> Downloading Hermez pot12_final.ptau (~4.6 MB)..."
  curl -L "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau" \
    -o "$PTAU"
fi

setup_circuit() {
  local NAME=$1
  echo ""
  echo "==> Phase 2 setup: $NAME"

  $SNARKJS groth16 setup \
    "${NAME}.r1cs" \
    "$PTAU" \
    "${NAME}_0.zkey"

  echo "$(head -c 32 /dev/urandom | base64)" | \
    $SNARKJS zkey contribute \
      "${NAME}_0.zkey" \
      "${NAME}_final.zkey" \
      --name="darkpool-v1"

  echo "    Done: $BUILD/${NAME}_final.zkey"
}

setup_circuit order_commitment
setup_circuit balance_proof
setup_circuit range_proof

echo ""
echo "==> Trusted setup complete."
echo "    Run scripts/export_vkeys.sh to export verification keys."
