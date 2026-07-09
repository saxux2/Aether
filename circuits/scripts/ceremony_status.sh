#!/usr/bin/env bash
# Coordinator dashboard: shows real progress on the multi-party ceremony for
# all 4 circuits — who has contributed so far, how many more are needed, and
# whether each circuit is ready to finalize. Reads only local state
# (ledgers/manifests in circuits/build/), so run it on the coordinator's own
# machine after each contributor sends their round file back.
#
# Usage: bash scripts/ceremony_status.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$(cd "$SCRIPT_DIR/../build" && pwd)"
MIN_CONTRIBUTORS="${MIN_CONTRIBUTORS:-3}"

echo "════════════════════════════════════════════════════════════════"
echo "  Aether Dark Pool — ZK Ceremony Status"
echo "════════════════════════════════════════════════════════════════"
echo ""

ALL_READY=true

for CIRC in order_commitment balance_proof range_proof match_proof; do
  echo "── ${CIRC} ──────────────────────────────────────────"

  MANIFEST="$BUILD/${CIRC}_ceremony_manifest.json"
  if [ -f "$MANIFEST" ]; then
    CONTRIBUTORS=$(grep -o '"distinct_contributors": *[0-9]*' "$MANIFEST" | grep -o '[0-9]*$')
    FINALIZED_AT=$(grep -o '"finalized_at_utc": *"[^"]*"' "$MANIFEST" | sed 's/.*: *"//;s/"$//')
    echo "  Status:       FINALIZED ✓  ($CONTRIBUTORS contributors, $FINALIZED_AT)"
    ACTUAL_SHA256=$(sha256sum "$BUILD/${CIRC}_final.zkey" 2>/dev/null | awk '{print $1}')
    RECORDED_SHA256=$(grep -o '"final_zkey_sha256": *"[a-f0-9]*"' "$MANIFEST" | grep -o '[a-f0-9]\{64\}')
    if [ "$ACTUAL_SHA256" = "$RECORDED_SHA256" ]; then
      echo "  Integrity:    zkey on disk matches manifest ✓"
    else
      echo "  Integrity:    ⚠ zkey on disk does NOT match manifest — investigate before using"
      ALL_READY=false
    fi
    echo ""
    continue
  fi

  LEDGER="$BUILD/${CIRC}_ceremony_ledger.log"
  if [ ! -f "$LEDGER" ]; then
    echo "  Status:       NOT STARTED — no contributions yet"
    echo "  Next step:    run setup_ceremony.sh once (if not already run), then have"
    echo "                the first contributor run setup_ceremony_contribute.sh"
    ALL_READY=false
    echo ""
    continue
  fi

  COUNT=$(grep -o 'contributor=[^ ]*' "$LEDGER" | sort -u | wc -l | tr -d ' ')
  echo "  Status:       IN PROGRESS — $COUNT/$MIN_CONTRIBUTORS contributors so far"
  echo "  Contributors:"
  grep -o 'round=[0-9]* contributor=[^ ]* timestamp_utc=[^ ]*' "$LEDGER" | while read -r line; do
    echo "                  $line"
  done
  if [ "$COUNT" -lt "$MIN_CONTRIBUTORS" ]; then
    NEEDED=$((MIN_CONTRIBUTORS - COUNT))
    echo "  Next step:    need $NEEDED more independent contributor(s), then finalize"
    ALL_READY=false
  else
    echo "  Next step:    ready to finalize — agree a beacon block height with"
    echo "                contributors, then run setup_ceremony_finalize.sh once it's mined"
  fi
  echo ""
done

echo "════════════════════════════════════════════════════════════════"
if [ "$ALL_READY" = true ]; then
  echo "  All 4 circuits finalized and verified. Ready for initialize-mainnet.sh."
else
  echo "  NOT all circuits are finalized yet — see per-circuit status above."
  echo "  initialize-mainnet.sh will refuse to run until every circuit is."
fi
echo "════════════════════════════════════════════════════════════════"
