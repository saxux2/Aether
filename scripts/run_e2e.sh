#!/usr/bin/env bash
# run_e2e.sh — Start the relayer if it is not running, execute the e2e test suite,
#              and exit with the test exit code.
#
# Usage:
#   bash scripts/run_e2e.sh
#   RELAYER_URL=http://localhost:3001 bash scripts/run_e2e.sh
#   ORDER_BOOK_ADDRESS=CXXX... bash scripts/run_e2e.sh   # enable full on-chain flow

set -euo pipefail

RELAYER_URL="${RELAYER_URL:-http://localhost:3001}"
RELAYER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/relayer"
TEST_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/e2e_test.js"
HEALTH_URL="${RELAYER_URL}/api/health"
MAX_WAIT_SECONDS=15

RELAYER_PID=""

# ── Colours ────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

info()    { echo -e "${CYAN}[run_e2e]${RESET} $*"; }
success() { echo -e "${GREEN}[run_e2e]${RESET} $*"; }
warn()    { echo -e "${YELLOW}[run_e2e]${RESET} $*"; }
error()   { echo -e "${RED}[run_e2e]${RESET} $*" >&2; }

# ── Cleanup: kill the relayer we started (but not an already-running one) ──────
cleanup() {
  if [[ -n "${RELAYER_PID}" ]]; then
    warn "Stopping relayer (PID ${RELAYER_PID})…"
    kill "${RELAYER_PID}" 2>/dev/null || true
    wait  "${RELAYER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── Step 1: Check if relayer is already up ─────────────────────────────────────
info "Checking relayer at ${HEALTH_URL}…"
if curl -sf --max-time 3 "${HEALTH_URL}" > /dev/null 2>&1; then
  success "Relayer is already running."
else
  # ── Step 2: Start the relayer in the background ──────────────────────────
  info "Relayer not reachable — starting it from ${RELAYER_DIR}…"

  if [[ ! -f "${RELAYER_DIR}/package.json" ]]; then
    error "Cannot find ${RELAYER_DIR}/package.json — is the monorepo checked out correctly?"
    exit 1
  fi

  # Prefer ts-node-dev if available (faster restarts), fall back to ts-node
  if command -v ts-node-dev &>/dev/null; then
    TS_CMD="ts-node-dev --respawn --transpile-only src/index.ts"
  else
    TS_CMD="npx ts-node src/index.ts"
  fi

  info "Running: cd ${RELAYER_DIR} && ${TS_CMD}"
  (cd "${RELAYER_DIR}" && ${TS_CMD}) &
  RELAYER_PID=$!
  info "Relayer process started (PID ${RELAYER_PID})."

  # ── Step 3: Wait up to 15 s for the health endpoint ─────────────────────
  info "Waiting up to ${MAX_WAIT_SECONDS}s for ${HEALTH_URL}…"
  ELAPSED=0
  until curl -sf --max-time 2 "${HEALTH_URL}" > /dev/null 2>&1; do
    if [[ ${ELAPSED} -ge ${MAX_WAIT_SECONDS} ]]; then
      error "Relayer did not become healthy within ${MAX_WAIT_SECONDS}s."
      error "Check the relayer logs above for startup errors."
      exit 1
    fi
    sleep 1
    ELAPSED=$((ELAPSED + 1))
    echo -n "."
  done
  echo ""
  success "Relayer is healthy after ${ELAPSED}s."
fi

# ── Step 4: Run the e2e test suite ────────────────────────────────────────────
info "Running e2e tests: node ${TEST_SCRIPT}"
echo ""

# Forward all relevant environment variables to the test process
node "${TEST_SCRIPT}"
TEST_EXIT=$?

echo ""
if [[ ${TEST_EXIT} -eq 0 ]]; then
  success "All tests passed."
else
  error "Some tests failed (exit code ${TEST_EXIT})."
fi

exit ${TEST_EXIT}
