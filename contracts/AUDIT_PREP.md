# Aether Dark Pool — Audit Prep Package

Prepared for external security review before mainnet launch. Covers the 5
Soroban contracts and their trust assumptions; the ZK circuits (`../circuits`)
should be reviewed as part of the same engagement since a circuit bug is as
exploitable as a contract bug here.

## What this system does

A zero-knowledge dark pool DEX on Stellar/Soroban. Traders submit sealed
orders (commitment + nullifier) gated by three Groth16 proofs (order
commitment, balance sufficiency, price range). A relayer batches crossing
orders every 60s and submits a fourth Groth16 proof (match proof) that proves
a valid clearing price without revealing order details. Settlement moves
funds atomically through a non-custodial escrow.

```
ZKVerifier ──────────────────────────────────────────────────────┐
  verify_order_proof / verify_balance_proof /                     │
  verify_range_proof / verify_match_proof                         │
                                                                  ▼
OrderBook ──────► MatchingEngine ──────► Settlement ──────► EscrowVault
  submit_order       submit_match          settle              deposit
  (ZK-gated)         (match proof)                            release
```

## Contracts in scope

| Contract | LOC | Unit tests | Notes |
|---|---|---|---|
| `zk_verifier` | ~330 | 7 | Real BN254 Groth16 pairing verification via Stellar host functions. Holds 4 verification keys. |
| `escrow_vault` | ~460 | 8 | Holds all trader funds. Highest-value target — any bug here is directly fund-draining. `deposit()` only accepts the two configured XLM/USDC tokens (see trust assumption 7). |
| `order_book` | ~460 | 10 | Binds proof public signals to submitted order fields; replay/nullifier protection; owns `cancel`/`expire` (routes through EscrowVault so status stays in sync). |
| `settlement` | ~170 | 3 | Executes the atomic two-sided release. Trusts MatchingEngine's auth; independently verifies each leg's deposit is the correct asset before releasing. |
| `matching_engine` | ~235 | 5 | Cross-contract orchestrator; verifies match proof then drives Settlement; explicitly rejects a pair matching itself. |

33 unit tests total (up from 14 at last audit pass), including a real
end-to-end `order_book.submit_order` test built on genuine Groth16 proofs
(not synthetic storage injection) — see
`contracts/order_book/src/lib.rs`'s `tests` module and the fixture generator
`circuits/scripts/gen_order_book_vector.js`. Integration/e2e coverage also
exists in `contracts/scripts/test_e2e.sh`, but that script only exercises
read-only smoke calls — the real integration coverage for the cross-contract
flow now lives in the unit tests above, not that script.

All 5 contracts now extend their instance storage TTL (and, for
`escrow_vault`/`order_book`, the relevant persistent per-key entry — deposits
and orders respectively) on every state-mutating call: 30 days threshold, 60
days extension, ~5s ledger close time assumed. Previously nothing in the
codebase called `extend_ttl` at all, meaning a long-dated or quiet-period
entry could be archived before a trader could act on it, requiring a manual
`RestoreFootprint` operation nothing here automated. Auditors should confirm
the threshold/extension values are appropriate for expected mainnet order
lifetimes and don't create excessive rent-extension cost per call.

## Trust assumptions (please scrutinize these specifically)

1. **Admin key** (per-contract, set at `initialize()`): can currently only
   flip the pause switch (`set_paused`) — it has no other privileged
   capability (no fund access, no upgrade, no key rotation). Verified by
   enumerating every function in all 5 contracts; covered by
   `test_set_paused_rejects_non_admin` in each contract that has the switch.
2. **Relayer trust (v1 known limitation)**: `matching_engine.submit_match`
   requires only `relayer_1.require_auth()` — a single key decides which
   crossing orders get matched, though the match proof constrains the *price*
   and *amounts* it can submit. `matching_engine/src/lib.rs` already documents
   this as "v1: requires relayer_1 auth... v2: upgrade to 2-of-3 threshold
   multisig" — this upgrade has not been implemented. A compromised or
   malicious relayer_1 cannot forge a bad price (proof-gated) but can censor
   or selectively delay matches, and can no longer trivially self-match (see
   `test_submit_match_rejects_self_match`). Auditors should assess the blast
   radius of a compromised relayer_1 key precisely.
3. **Cross-contract auth chain**: `EscrowVault.lock_for_settlement` trusts
   `matching_engine.require_auth()`; `EscrowVault.release` trusts
   `settlement.require_auth()`; `Settlement.settle` trusts
   `matching_engine.require_auth()`. `Settlement.settle` now also verifies
   each nullifier's actual escrowed asset matches the expected side
   (`buyer_deposit.asset == usdc_token`, `seller_deposit.asset == xlm_token`)
   before releasing — previously fund-movement direction was delegated
   entirely to the relayer's labeling and circuit correctness with no
   on-chain backstop; see `test_settle_rejects_buyer_deposit_in_wrong_asset`.
   Please verify there is no remaining path where one of these contracts can
   be called out of order or with a mismatched nullifier pair to move funds
   incorrectly.
4. **Nullifier/commitment replay protection**: `order_book` rejects reused
   nullifiers (`NullifierUsed`); `escrow_vault` rejects reused nullifiers on
   deposit; covered by `test_submit_order_rejects_replayed_nullifier`.
   `order_book.cancel`/`expire` (new) route through `EscrowVault` and keep
   both contracts' status in sync, closing a previous gap where a direct
   `EscrowVault.cancel` call would leave `order_book`'s own record
   permanently `Active`.
5. **Pause switch**: `set_paused` on `escrow_vault`, `order_book`,
   `matching_engine` blocks new deposits/orders/matches only — `cancel`,
   `expire`, and `release` are intentionally left always-callable so a pause
   can never trap user funds. `test_cancel_still_works_while_paused` and
   `test_submit_order_rejected_while_paused` cover this. `set_paused` itself
   can still in principle be front-run — this is inherent to any on-chain
   pause mechanism, not a contract-fixable gap.
6. **ZK proof signal binding**: `order_book.submit_order` now checks that
   (a) the range proof's public `commitment` signal equals the order's real
   commitment (previously the range proof committed to price via a separate,
   unbound hash — a trader could submit a real out-of-band-priced order
   alongside a valid range proof for an unrelated, in-band dummy price), and
   (b) the balance proof's public `minimum_balance` equals the real
   `amount_in` being escrowed (previously unchecked, so a prover could claim
   sufficiency for a trivial amount while escrowing an arbitrary real
   amount). Both are covered by real-proof tests:
   `test_submit_order_rejects_range_proof_for_different_commitment`,
   `test_submit_order_rejects_amount_in_not_matching_balance_proof`.
7. **EscrowVault token allowlist**: `deposit()` now rejects any `asset`
   that isn't the `xlm_token`/`usdc_token` pair set at `initialize()` —
   previously it would pull funds using whatever token contract the caller
   named, with no on-chain restriction (a legitimate trader could only ever
   escrow their own funds this way, so the practical risk was limited, but it
   meant nothing at the deposit boundary enforced "this pool only ever holds
   XLM and USDC," only `settlement.settle()`'s asset check at the *release*
   boundary did — see trust assumption 3). Covered by
   `test_deposit_rejects_unlisted_asset`. This is an additive parameter on
   `EscrowVault.initialize()` — `contracts/scripts/initialize.sh` and
   `initialize-mainnet.sh` were both updated to pass it; any other deploy
   tooling calling `EscrowVault.initialize()` directly needs the same update.

## Known, accepted gaps (out of this audit's fix scope, flagged for awareness)

- **ZK trusted setup**: still not safe for mainnet — see
  `circuits/CEREMONY_STATUS.md` for the current state. All 4 circuits'
  `_final.zkey` files were regenerated in a single dev session (needed
  because two circuit bugs were fixed alongside — see below) and their
  ceremony manifests honestly report `distinct_contributors: 1`.
  `contracts/scripts/initialize-mainnet.sh` now programmatically verifies
  each circuit's manifest reports at least 3 distinct contributors (and that
  the on-disk zkey's sha256 matches what the manifest recorded) before it
  will proceed — previously the only safeguard was asking a human to type
  "yes". A real multi-party ceremony with genuinely independent contributors
  is still owed before mainnet; no automated process can substitute for that.
- **No upgrade mechanism**: none of the 5 contracts have an upgrade path. A
  bug found post-launch requires a full redeploy + fund migration, not a
  patch. If auditors think this tradeoff is wrong given the pause switch
  already exists, that's useful feedback.
- **`order_book.ActiveOrders` is a bounded-but-not-indexed index**: entries
  are removed on match/cancel/expire (previously grew forever, a DoS risk —
  see `test_cancel_reclaims_funds_and_removes_from_active`), but it's still a
  linear scan/rewrite on every mutation. Fine at expected order-book depth;
  would need a different structure if resting-order volume grows much larger.

## Circuits (separate but connected scope)

Located in `../circuits`: `order_commitment.circom`, `balance_proof.circom`,
`range_proof.circom`, `match_proof.circom`. Built with circomlib `^2.0.5`,
proved with snarkjs `^0.7.6` (Groth16, BN254). The on-chain contracts trust
these circuits' constraints completely — an under-constrained circuit (e.g.
missing a range check that lets `clearing_price` be forged) would bypass
every on-chain guard even if the contracts themselves are perfect.

Two real soundness bugs were found (by adversarial cases in
`circuits/scripts/test_circuits.js`, not just static review) and fixed:

1. `range_proof.circom` committed to price independently of
   `order_commitment.circom`, with no on-chain check tying the two together
   — fixed by having `range_proof` re-derive the same commitment from the
   same preimage, and `order_book.rs` checking it (see trust assumption 6
   above).
2. `match_proof.circom`'s floor-division check (`usdc_amount ==
   floor(xlm_amount * clearing_price / 1e6)`) used a field subtraction
   (`gross - scaled`) that could wrap to a huge field element and produce a
   spurious valid witness when the division was exact and `usdc_amount` was
   overstated by exactly 1 — fixed by comparing `scaled` and `gross`
   directly instead of their difference. Full root-cause writeup in
   `circuits/CEREMONY_STATUS.md`.

Recommend the audit re-review constraint-completeness of all four
`.circom` files given these fixes, not assume the previous review (if any)
still applies to the current source.

## Environment / dependency versions

- `soroban-sdk = 26.0.1`
- Rust target: `wasm32v1-none`
- circomlib `^2.0.5`, snarkjs `^0.7.3`

## How to reproduce the test suite locally

```bash
cd contracts
bash scripts/build.sh   # builds all 5 in dependency order (required before cargo test)
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt --all -- --check
```
