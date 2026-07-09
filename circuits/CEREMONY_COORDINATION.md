# Ceremony Coordination — live tracking doc

**Status as of today: not started. 0 of 4 circuits have any real contribution.**
Update this file's status lines as the ceremony actually progresses — it's meant to be edited by hand, not regenerated. Run `bash scripts/ceremony_status.sh` any time for a machine-readable snapshot of the same information from the ledger files.

This exists because an AI agent cannot run a real multi-party ceremony — that
requires genuinely independent humans, on separate machines, contributing
entropy nobody else can predict or reconstruct. What's below is the
coordination scaffolding to make that easy for your team to actually do.

---

## 1. Who's coordinating, who's contributing

| Role | Name | Contact | Status |
|---|---|---|---|
| Coordinator | _(fill in)_ | | |
| Contributor 1 | _(fill in)_ | | not started |
| Contributor 2 | _(fill in)_ | | not started |
| Contributor 3 | _(fill in)_ | | not started |
| Contributor 4+ (optional, stronger) | _(fill in)_ | | not started |

**Choosing contributors:** each one only needs to be capable of running a bash
script and typing on a keyboard for a minute — no cryptography background
required. What matters is that they're **genuinely independent**: different
people, different machines, no coordinating or sharing entropy with each
other or with the coordinator. Good candidates: other engineers on the team,
a trusted engineer at a partner project, a security researcher you know,
community members if this is a public project. 3 is the minimum this repo's
tooling enforces (`MIN_CONTRIBUTORS`); more is strictly stronger since the
ceremony is only as safe as its single most honest participant.

Aim for contributors who won't all be reachable/colludable through one
channel (e.g., not "3 people in the same Slack DM who could coordinate in
5 minutes if they wanted to cut a corner") — the point is that no one of them
can convince themselves it's fine to skip destroying their entropy, because
they can't know whether the ceremony's security already rests entirely on them.

## 2. The process, in order

1. **Coordinator**: confirm `circuits/build/<circuit>_0000.zkey` exists for
   all 4 circuits (run `bash scripts/setup_ceremony.sh` once if not — this is
   the deterministic phase-2 init from the public Powers-of-Tau file, not a
   contribution by anyone, so it's fine for the coordinator to run this part).
2. **Coordinator**: send contributor #1 the four `*_0000.zkey` files (not
   this repo's git history, not any secret — just those 4 files) plus the
   [contributor instructions](#3-contributor-instructions-copy-paste-this-to-each-person) below.
3. **Contributor #1**, on their own machine: runs `setup_ceremony_contribute.sh`
   for each of the 4 circuits with `ROUND=1`, sends the resulting
   `*_0001.zkey` files back to the coordinator, and **destroys their local
   copies and any memory of the entropy they typed** (close the terminal,
   don't keep shell history if you're worried about it).
4. **Coordinator**: updates the roster above, runs
   `bash scripts/ceremony_status.sh` to confirm the ledger recorded it, sends
   the `*_0001.zkey` files to contributor #2.
5. **Repeat** for each contributor, incrementing `ROUND` each time
   (`ROUND=2` for contributor #2's `*_0002.zkey` output, etc.) — each person
   only ever receives the previous round's file, never anything earlier.
6. Once `ceremony_status.sh` shows all 4 circuits at 3+ distinct contributors:
   **agree a beacon block height** with the group — a Bitcoin (or similar
   public chain) block that hasn't been mined yet at the time you agree on
   it, so nobody can know its hash in advance. A block ~1 hour out from
   whenever you expect the last contribution to land is reasonable.
7. Once that block is mined, **coordinator** runs `setup_ceremony_finalize.sh`
   for all 4 circuits with that block's hash as `BEACON_HASH`, then
   `node scripts/export_soroban_vk.js`, then re-runs
   `contracts/scripts/copy_circuits_to_frontend.sh` so the frontend serves
   the real keys.
8. Commit the 4 new `*_ceremony_manifest.json` files (small, meant to be
   tracked — they're the provenance record) along with the regenerated
   `*_final.zkey` / `*_vk.json` / `*_soroban_vk.json` files.
9. `contracts/scripts/initialize-mainnet.sh` will now pass its manifest
   check. Re-run `bash scripts/ceremony_status.sh` one more time as a final
   sanity check before touching mainnet.

## 3. Contributor instructions (copy-paste this to each person)

> You're contributing entropy to a Groth16 trusted-setup ceremony for
> [Aether Dark Pool]. This takes about 5 minutes.
>
> 1. You'll receive 4 files named like `order_commitment_000N.zkey` (N will
>    vary depending on how many people have gone before you).
> 2. Clone the repo (or just copy `circuits/scripts/setup_ceremony_contribute.sh`
>    and the `node_modules/snarkjs` + `node_modules/circomlib` dependencies —
>    ask the coordinator which is easier) onto **your own machine**.
> 3. Put the 4 files you received into `circuits/build/`.
> 4. Run, for each of the 4 circuit names (`order_commitment`, `balance_proof`,
>    `range_proof`, `match_proof`):
>    ```
>    ROUND=<the number the coordinator tells you> CONTRIBUTOR="<your name/handle>" \
>      bash scripts/setup_ceremony_contribute.sh <circuit_name> build/<circuit_name>_<the file you received>.zkey
>    ```
> 5. When prompted, **type random characters on your keyboard** — don't
>    paste, don't use a password manager, don't reuse anything. Mash the
>    keys for a few seconds each time.
> 6. Send the resulting `*_000<N+1>.zkey` files back to the coordinator.
> 7. **Do not** send the input files you received onward, and don't keep
>    copies of what you typed (clear your terminal scrollback if you're
>    security-conscious about it). The only thing that matters for the
>    ceremony's security is that this entropy existed once and is now gone.

## 4. What "done" looks like

`bash scripts/ceremony_status.sh` reports all 4 circuits as `FINALIZED ✓`
with matching integrity hashes, and `git status` shows updated
`*_final.zkey` / `*_vk.json` / `*_soroban_vk.json` / `*_ceremony_manifest.json`
files ready to commit. At that point `contracts/scripts/initialize-mainnet.sh`
will pass its automated provenance check — see `circuits/CEREMONY_STATUS.md`
for what that check actually verifies.
