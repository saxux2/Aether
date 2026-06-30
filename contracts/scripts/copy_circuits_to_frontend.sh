#!/usr/bin/env bash
# Copy compiled ZK circuit artifacts to the Next.js public directory.
# Run after circuits/scripts/setup_ceremony.sh + export_vkeys.sh.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
BUILD="$ROOT_DIR/circuits/build"
DEST="$ROOT_DIR/frontend/public/circuits"

mkdir -p "$DEST"

for CIRC in order_commitment balance_proof range_proof; do
  cp "$BUILD/${CIRC}.wasm"        "$DEST/"
  cp "$BUILD/${CIRC}_final.zkey"  "$DEST/"
  cp "$BUILD/${CIRC}_vk.json"     "$DEST/"
  echo "Copied $CIRC artifacts"
done

echo ""
echo "==> Circuit artifacts ready in $DEST"
echo "    Restart the Next.js dev server to serve them."
