# Trusted-setup ceremony status

**Current state: dev/testnet keys only. NOT safe for mainnet.**

## What's in `circuits/build/*_final.zkey` right now

All four circuits (`order_commitment`, `balance_proof`, `range_proof`,
`match_proof`) have fresh, mutually-consistent Groth16 keys, generated in a
single automated session by one operator (this development environment) —
not by genuinely independent human contributors. This is the same category
of setup the project's own `AUDIT_PREP.md` already flagged as unsafe for
mainnet; it has simply been regenerated so it's internally consistent with
two circuit fixes made alongside it (see below), not "fixed" into a real
ceremony. **No automated agent can produce a real multi-party ceremony** —
that requires actual separate people, on separate machines, contributing
entropy independently. That step is still owed by the team before mainnet.

The single-operator ledger/manifest files that dev session produced have
since been **cleared** (`circuits/build/*_ceremony_ledger.log`,
`*_ceremony_manifest.json` — both gitignored, so this was a local reset only)
so a real ceremony starts from a clean contributor count of zero, not one
that already has a fake entry sitting in it. The `*_final.zkey` / `*_vk.json`
files themselves are left in place so the app and test suite keep working in
the meantime — they're placeholders, not something that needs to round-trip
through the real ceremony to keep functioning day to day. `contracts/scripts/
initialize-mainnet.sh` reads the manifest (now absent) and will refuse to run
without one showing 3+ distinct contributors — verified this directly: with
no manifest present at all, the script's very first check on each circuit
fails closed with "no ceremony manifest found."

**Coordinating the real ceremony:** see `circuits/CEREMONY_COORDINATION.md`
for the step-by-step runbook, a contributor-instructions template, and
`circuits/scripts/ceremony_status.sh` for a live progress dashboard.

## Why the keys were regenerated in this session

Two real bugs were found and fixed in the circuits, both requiring fresh
proving/verification keys:

1. **`range_proof.circom`** was rewritten so its range check is bound to the
   same order commitment `order_commitment.circom` produces, instead of an
   independent, unbound `price_commitment`. Previously a trader could submit
   a real order at an out-of-band price alongside a valid range proof for an
   unrelated, in-band dummy price — the two proofs were individually sound
   but mutually meaningless. `order_book.rs` now checks the range proof's
   `commitment` public signal against the real order commitment.

2. **`match_proof.circom`**'s floor-division check (`usdc_amount ==
   floor(xlm_amount * clearing_price / 1e6)`) was rewritten after an
   adversarial test (`circuits/scripts/test_circuits.js`, "usdc_amount off
   by one from the exact floor-division result") caught a real soundness gap:
   the original check computed `rem = gross - scaled` as a single field
   subtraction fed into `LessThan(128)`, which is only sound when its input
   is genuinely bounded below 2^128. When the division was exact, an
   over-claimed `usdc_amount` made `rem` wrap to a field element near the
   BN254 modulus — outside `LessThan`'s valid range — and circom found a
   spurious valid witness rather than rejecting it. The fix compares
   `usdc_amount*1e6` and `xlm_amount*clearing_price` directly (both
   individually bounded, no subtraction, nothing to wrap) instead.

Both fixes are covered by regression tests in `test_circuits.js` that fail
against the old, buggy circuit versions.

## How to actually run a real ceremony before mainnet

1. `bash scripts/setup_ceremony.sh` — produces round-0000 zkeys (already done
   for the current circuit versions; re-run only if the `.circom` sources
   change again).
2. For **3 or more genuinely independent contributors**, each on their own
   machine, with no coordination of randomness: `ROUND=<n>
   CONTRIBUTOR=<name> bash scripts/setup_ceremony_contribute.sh <circuit>
   <input.zkey>`, passing each contribution to the next contributor only —
   never the entropy, never earlier rounds.
3. `LAST_ZKEY=<path> BEACON_HASH=<public random value, e.g. a not-yet-mined
   Bitcoin block hash> bash scripts/setup_ceremony_finalize.sh <circuit>` —
   refuses to run with fewer than 3 distinct contributors in the ledger
   (`MIN_CONTRIBUTORS` env var can override for non-mainnet test runs only).
4. `node scripts/export_soroban_vk.js` to produce the Soroban-wire-format
   verification keys `contracts/scripts/initialize-mainnet.sh` consumes.
5. Repeat for all four circuits, then `initialize-mainnet.sh` will verify
   each manifest before proceeding.
