#!/usr/bin/env bash
# One contributor's step in the Groth16 phase-2 ceremony.
#
# HOW TO ACTUALLY RUN A REAL CEREMONY (do this before mainnet):
#   1. Coordinator runs setup_ceremony.sh once, producing <circuit>_0000.zkey
#      for all four circuits, and sends those files (not any secret) to
#      contributor #1.
#   2. Contributor #1, on THEIR OWN machine (not the coordinator's), runs:
#        ROUND=1 CONTRIBUTOR="alice" ./setup_ceremony_contribute.sh order_commitment ./order_commitment_0000.zkey
#      for each of the 4 circuits. snarkjs will interactively ask them to
#      mash the keyboard for entropy — that entropy must never be typed by,
#      shown to, or logged by anyone else, including the coordinator.
#   3. Contributor #1 sends ONLY the resulting <circuit>_0001.zkey files
#      onward to contributor #2 — never their entropy, never round-0000.
#   4. Contributor #2 repeats step 2 with ROUND=2 and the _0001.zkey as input,
#      producing _0002.zkey, and so on for as many independent contributors
#      as you have (3+ recommended; more is stronger).
#   5. Once the last contributor is done, run setup_ceremony_finalize.sh.
#
# The security property only holds if AT LEAST ONE contributor in the chain
# is honest and actually destroys their local entropy/randomness afterward,
# AND the contributors are genuinely independent (separate people, separate
# machines, no coordination of randomness) — running this script multiple
# times yourself on one machine does NOT satisfy that, no matter how many
# rounds you run. setup_ceremony_finalize.sh's manifest is what
# scripts/initialize-mainnet.sh checks before it will touch mainnet, so it
# is deliberately hard to fake: it records who ran each round and refuses to
# finalize under a minimum contributor count.
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "Usage: ROUND=<n> CONTRIBUTOR=<name> $0 <circuit_name> <input_zkey_path>"
  echo "  e.g. ROUND=1 CONTRIBUTOR=alice $0 order_commitment ./order_commitment_0000.zkey"
  exit 1
fi

NAME=$1
INPUT_ZKEY=$2
ROUND="${ROUND:?ERROR: set ROUND to this contributions sequence number, e.g. ROUND=1}"
CONTRIBUTOR="${CONTRIBUTOR:?ERROR: set CONTRIBUTOR to your name or handle, recorded in the transcript}"

if [ ! -f "$INPUT_ZKEY" ]; then
  echo "ERROR: input zkey not found: $INPUT_ZKEY"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD="$CIRCUITS_DIR/build"
# See export_vkeys.sh for why this points at the real CLI entry rather than
# node_modules/.bin/snarkjs (that path is a Windows-incompatible shell shim).
SNARKJS="node $(cd "$CIRCUITS_DIR/.." && pwd)/node_modules/snarkjs/build/cli.cjs"

OUTPUT_ZKEY="$(dirname "$INPUT_ZKEY")/${NAME}_$(printf '%04d' "$ROUND").zkey"
LEDGER="$BUILD/${NAME}_ceremony_ledger.log"

echo "==> Contributing to $NAME as '$CONTRIBUTOR' (round $ROUND)"
echo "    Input:  $INPUT_ZKEY"
echo "    Output: $OUTPUT_ZKEY"
echo ""
echo "    You will be prompted for random keyboard input by snarkjs."
echo "    Type freely, do not paste, do not reuse entropy from any other session."
echo ""

CONTRIB_LOG="$(mktemp)"
$SNARKJS zkey contribute \
  "$INPUT_ZKEY" \
  "$OUTPUT_ZKEY" \
  --name="$CONTRIBUTOR" 2>&1 | tee "$CONTRIB_LOG"

CONTRIB_HASH="$(grep -A1 -i 'contribution hash' "$CONTRIB_LOG" | tr -d '\n' | tr -s ' ' || true)"
OUTPUT_SHA256="$(sha256sum "$OUTPUT_ZKEY" | awk '{print $1}')"
rm -f "$CONTRIB_LOG"

# Append-only ledger — this is what setup_ceremony_finalize.sh reads to
# count distinct contributors before it will let you finalize.
{
  echo "round=$ROUND contributor=$CONTRIBUTOR timestamp_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) output=$(basename "$OUTPUT_ZKEY") output_sha256=$OUTPUT_SHA256 contribution_hash=${CONTRIB_HASH:-unknown}"
} >> "$LEDGER"

echo ""
echo "==> Contribution recorded: $OUTPUT_ZKEY"
echo "    Ledger updated: $LEDGER"
echo "    Send $OUTPUT_ZKEY to the next contributor (or to the coordinator if you're last)."
echo "    Do NOT send $INPUT_ZKEY onward, and do not keep copies of your own randomness."
