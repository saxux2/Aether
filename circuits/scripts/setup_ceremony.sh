#!/usr/bin/env bash
# Groth16 trusted setup — Phase 1 (public) + Phase 1->2 transition for all
# four circuits used on-chain: order_commitment, balance_proof, range_proof,
# match_proof.
#
# IMPORTANT — read before mainnet:
# This script only performs the INITIAL phase-2 setup (round 0000). A setup
# with a single contribution from one person is NOT safe for mainnet: whoever
# holds that one contribution's randomness (the "toxic waste") could forge
# proofs that pass verification on-chain — e.g. a fake balance proof or a
# fake match proof — without anyone being able to detect it.
#
# To make this safe you MUST run setup_ceremony_contribute.sh once per
# circuit for EACH of several independent, non-colluding contributors (ideally
# 3+ people who don't share machines or coordinate their randomness), each
# running it on their own machine, then run setup_ceremony_finalize.sh once
# at the end. See the comments in those two scripts for the full flow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD="$CIRCUITS_DIR/build"

cd "$BUILD"

# See export_vkeys.sh for why this points at the real CLI entry rather than
# node_modules/.bin/snarkjs (that path is a Windows-incompatible shell shim).
SNARKJS="node $(cd "$CIRCUITS_DIR/.." && pwd)/node_modules/snarkjs/build/cli.cjs"

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
  echo "==> Phase 2 initial setup (round 0000): $NAME"
  $SNARKJS groth16 setup \
    "${NAME}.r1cs" \
    "$PTAU" \
    "${NAME}_0000.zkey"
  echo "    Done: $BUILD/${NAME}_0000.zkey"
}

setup_circuit order_commitment
setup_circuit balance_proof
setup_circuit range_proof
setup_circuit match_proof

echo ""
echo "==> Round-0000 setup complete for all 4 circuits."
echo "    These files are NOT safe to use as-is (single contributor = you)."
echo "    Next: hand order_commitment_0000.zkey (etc.) to your first contributor"
echo "    and run setup_ceremony_contribute.sh — see that script's header for the flow."
