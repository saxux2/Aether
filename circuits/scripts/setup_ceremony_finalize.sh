#!/usr/bin/env bash
# Finalize the Groth16 ceremony: apply a public random beacon on top of the
# last contributor's zkey, verify the full contribution chain, export
# verification keys, and write a signed-in-the-sense-of-recorded provenance
# manifest that scripts/initialize-mainnet.sh requires before it will touch
# mainnet.
#
# The beacon step adds one more contribution using randomness nobody could
# have predicted in advance — the standard choice is the hash of a Bitcoin
# (or similar public chain) block that does not exist yet at ceremony-planning
# time. Agree on a target block height with your contributors ahead of time,
# then once that block is mined, use its hash here.
#
# Usage:
#   LAST_ZKEY=order_commitment_0003.zkey BEACON_HASH=<64-hex-chars> \
#     ./setup_ceremony_finalize.sh order_commitment
#
# Refuses to finalize unless setup_ceremony_contribute.sh's ledger for this
# circuit shows at least MIN_CONTRIBUTORS (default 3) DISTINCT contributor
# names — see setup_ceremony_contribute.sh's header for why running several
# rounds yourself does not satisfy this; it exists specifically so nobody
# (including an automated agent) can shortcut this step and produce a
# manifest that looks like a real ceremony when it wasn't one.
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: LAST_ZKEY=<path> BEACON_HASH=<64-hex-chars> $0 <circuit_name>"
  exit 1
fi

NAME=$1
LAST_ZKEY="${LAST_ZKEY:?ERROR: set LAST_ZKEY to the final contributors zkey path for this circuit}"
BEACON_HASH="${BEACON_HASH:?ERROR: set BEACON_HASH to a public, unpredictable-at-planning-time hex value (e.g. a future Bitcoin block hash)}"
MIN_CONTRIBUTORS="${MIN_CONTRIBUTORS:-3}"

if [ ! -f "$LAST_ZKEY" ]; then
  echo "ERROR: $LAST_ZKEY not found."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD="$CIRCUITS_DIR/build"
# See export_vkeys.sh for why this points at the real CLI entry rather than
# node_modules/.bin/snarkjs (that path is a Windows-incompatible shell shim).
SNARKJS="node $(cd "$CIRCUITS_DIR/.." && pwd)/node_modules/snarkjs/build/cli.cjs"

LEDGER="$BUILD/${NAME}_ceremony_ledger.log"
if [ ! -f "$LEDGER" ]; then
  echo "ERROR: no contribution ledger found at $LEDGER."
  echo "       Run setup_ceremony_contribute.sh at least $MIN_CONTRIBUTORS times (by"
  echo "       genuinely independent contributors) before finalizing."
  exit 1
fi

DISTINCT_CONTRIBUTORS="$(grep -o 'contributor=[^ ]*' "$LEDGER" | sort -u | wc -l | tr -d ' ')"
if [ "$DISTINCT_CONTRIBUTORS" -lt "$MIN_CONTRIBUTORS" ]; then
  echo "ERROR: ledger for $NAME shows only $DISTINCT_CONTRIBUTORS distinct contributor(s),"
  echo "       need at least $MIN_CONTRIBUTORS. Refusing to finalize — a ceremony with"
  echo "       too few independent contributors provides no real security margin over"
  echo "       the single-operator setup this process exists to replace."
  echo "       (Override only for non-mainnet test runs: MIN_CONTRIBUTORS=1)"
  exit 1
fi

FINAL_ZKEY="$BUILD/${NAME}_final.zkey"

echo "==> Applying public beacon to $NAME..."
$SNARKJS zkey beacon \
  "$LAST_ZKEY" \
  "$FINAL_ZKEY" \
  "$BEACON_HASH" \
  10 \
  --name="final beacon"

echo ""
echo "==> Verifying the full contribution transcript for $NAME..."
$SNARKJS zkey verify \
  "$BUILD/${NAME}.r1cs" \
  "$BUILD/pot12_final.ptau" \
  "$FINAL_ZKEY"

echo ""
echo "==> Exporting verification key for $NAME..."
$SNARKJS zkey export verificationkey \
  "$FINAL_ZKEY" \
  "$BUILD/${NAME}_vk.json"

FINAL_SHA256="$(sha256sum "$FINAL_ZKEY" | awk '{print $1}')"
MANIFEST="$BUILD/${NAME}_ceremony_manifest.json"
CONTRIBUTOR_LIST="$(grep -o 'contributor=[^ ]*' "$LEDGER" | sed 's/contributor=//' | sort -u | sed 's/.*/"&"/' | paste -sd, -)"

cat > "$MANIFEST" <<EOF
{
  "circuit": "$NAME",
  "distinct_contributors": $DISTINCT_CONTRIBUTORS,
  "contributors": [$CONTRIBUTOR_LIST],
  "beacon_hash": "$BEACON_HASH",
  "final_zkey_sha256": "$FINAL_SHA256",
  "finalized_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ledger_file": "$(basename "$LEDGER")"
}
EOF

echo ""
echo "==> $NAME ceremony finalized: $FINAL_ZKEY"
echo "    Verification key: $BUILD/${NAME}_vk.json"
echo "    Manifest written: $MANIFEST (checked by scripts/initialize-mainnet.sh)"
echo "    Repeat for the remaining circuits, then run:"
echo "    node scripts/export_soroban_vk.js  (converts all 4 vk.json into Soroban wire format)"
