# Incident Response — Aether Dark Pool

This is a runbook for real incidents, not a general security policy. It
assumes you're already mid-incident and need to know what to check and what
to run — background/rationale is kept short on purpose.

**Fill in before this is useful:** the `[ ]` contact placeholders below.
An untested runbook with no on-call contact is a document, not a runbook.

## Quick triage

| Symptom | Likely cause | Jump to |
|---|---|---|
| Orders stop matching, no new settlements | Relayer down, or batch loop wedged | [Relayer down or degraded](#relayer-down-or-degraded) |
| `keepalive` workflow filed a GitHub issue labeled `relayer-degraded` | Same as above — this is the automated version of noticing it | [Relayer down or degraded](#relayer-down-or-degraded) |
| Funds moving unexpectedly / a trader reports a bad settlement | Contract or circuit bug — **highest severity** | [Suspected fund-safety incident](#suspected-fund-safety-incident) |
| Relayer logs show unexpected Mongo writes, or you suspect DB access was compromised | Database credential compromise | [Database compromise](#database-compromise) |
| `matching_engine.submit_match` calls failing auth, or relayer's signing behavior looks wrong | Relayer signing key (`relayer_1`) compromised or lost | [Relayer key compromised](#relayer-signing-key-compromised-or-lost) |
| Frontend unreachable but relayer health check is green | Vercel outage — traders can't submit new orders, but nothing is at risk | [Frontend outage](#frontend-outage) |
| A push to `main` deployed something nobody intended | Compromised commit / CI credential | [Unexpected deploy](#unexpected-deploy) |

## Severity

- **SEV1 — funds at risk or moving incorrectly.** Pause affected contracts
  immediately, page everyone, don't wait for full root-cause before acting.
- **SEV2 — service degraded, funds not at risk.** Relayer down, batch loop
  stalled, frontend outage. Existing deposits stay safe — `cancel`/`expire`/
  `release` remain callable on every contract even while paused, by design
  (see `contracts/AUDIT_PREP.md` trust assumption 5). Fix on a normal
  incident timeline.
- **SEV3 — degraded but self-healing or cosmetic.** A single missed batch
  cycle, a transient RPC blip the retry logic already absorbed.

## The first 5 minutes (any SEV1/SEV2)

1. Check `GET {RELAYER_URL}/api/health` — this now reports `mongodb`,
   `stellar`, and `batch_auction.stale`/`last_cycle_error` individually, so
   it usually tells you which subsystem is the actual problem before you
   guess.
2. Check for an open GitHub issue labeled `relayer-degraded` (auto-filed by
   `.github/workflows/keepalive.yml`) — it'll have the health payload from
   the moment it started failing.
3. Check Render's dashboard for the relayer service (deploy status, recent
   logs, restarts) and MongoDB Atlas's dashboard (connection count,
   recent alerts).
4. **If you suspect funds are at risk** (not just degraded liveness), skip
   straight to [pausing](#how-to-pause-a-contract) — you can always unpause
   once you've confirmed it's a false alarm, but you can't undo a drain.
5. Post in `[ ] incident channel` so this isn't happening in one person's
   head.

## How to pause a contract

Every contract except `zk_verifier` has `set_paused(admin, paused: bool)`.
Pausing blocks **new** exposure only — `cancel`, `expire`, and `release`
remain callable on every contract so a pause can never trap funds already
escrowed (verified by `test_cancel_still_works_while_paused` and
`test_submit_order_rejected_while_paused` in the relevant contracts' test
suites).

```bash
# Repeat --id for whichever of escrow_vault / order_book / matching_engine
# need pausing — usually all three together, since order_book feeding a
# paused escrow_vault (or vice versa) just produces confusing partial
# failures rather than a clean stop.
stellar contract invoke \
  --id $ESCROW_VAULT_ADDRESS --source darkpool-deployer --network <testnet|mainnet> \
  -- set_paused --admin $DEPLOYER --paused true

stellar contract invoke \
  --id $ORDER_BOOK_ADDRESS --source darkpool-deployer --network <testnet|mainnet> \
  -- set_paused --admin $DEPLOYER --paused true

stellar contract invoke \
  --id $MATCHING_ENGINE_ADDRESS --source darkpool-deployer --network <testnet|mainnet> \
  -- set_paused --admin $DEPLOYER --paused true
```

To unpause, same command with `--paused false`. `settlement` and
`zk_verifier` have no pause switch — `settlement.settle()` can only be
reached via `matching_engine.submit_match()`, so pausing `matching_engine`
already blocks that path.

**Consider testing this now, before you need it under pressure** —
`AUDIT_PREP.md` explicitly recommends confirming pause/unpause works while
amounts at risk are zero.

---

## Relayer down or degraded

1. Check `/api/health`'s three fields separately:
   - `mongodb: "disconnected"` → Atlas issue. Check Atlas dashboard; check
     `MONGODB_URI` env var on Render hasn't been rotated/expired.
   - `stellar: "unreachable"` → Soroban RPC issue. Check
     `STELLAR_RPC_URL` is still a live endpoint (public RPC endpoints do
     go down or get rate-limited); consider a backup RPC provider.
   - `batch_auction.stale: true` with a `last_cycle_error` → the matching
     loop itself is failing, not just connectivity. Check Render logs
     around the timestamp in `last_cycle_completed_at` for the actual
     exception. Common cause: `SorobanService.submitMatch` failing
     repeatedly (relayer key issue — see next section — or the relayer
     account is out of XLM for fees).
2. **No funds are at risk from this alone** — orders just stop matching.
   Existing escrowed funds can still be cancelled/expired by their traders
   the whole time.
3. If Render itself is down (not just the app): redeploy via Render
   dashboard, or `git push` an empty commit to `main` to trigger `deploy.yml`.
4. On recovery, run `bash circuits/scripts/ceremony_status.sh`-style sanity —
   actually, check the relayer logs for `[Startup] Reconciled N stale
   pending match(es)` — this confirms `reconcileStalePendingMatches()` ran
   and cleaned up anything stuck mid-settlement from the crash.

## Suspected fund-safety incident

**Pause first, investigate second.** This is the one case where speed beats
certainty.

1. [Pause](#how-to-pause-a-contract) `escrow_vault`, `order_book`, and
   `matching_engine` immediately.
2. Do NOT pause in a way that stops traders from exiting — confirm
   `cancel`/`expire` still work post-pause (they should, by design, but
   verify against the actual deployed bytecode, not just trust the source).
3. Pull the specific transaction(s) via Stellar Expert
   (`https://stellar.expert/explorer/<testnet|public>/tx/<hash>`) and
   identify: which contract function, which caller, what the effect was.
4. Cross-reference against `contracts/AUDIT_PREP.md`'s trust assumptions —
   most fund-safety bugs will map to one of the six points listed there
   (auth chain, nullifier replay, asset binding, etc.) or to the circuit
   layer (`circuits/CEREMONY_STATUS.md` documents the two soundness bugs
   already found and fixed there — if this looks similar, that's a strong
   lead).
5. **There is no upgrade mechanism** (documented, accepted tradeoff — see
   `AUDIT_PREP.md`). If the bug is in deployed contract logic, the fix is a
   full redeploy + fund migration, not a patch. Get this decision made by
   `[ ] whoever owns that call]`, not unilaterally mid-incident.
6. Public disclosure: `[ ] decide your policy here — responsible disclosure
   timeline, whether/how to notify affected traders]`.

## Database compromise

This project has already had one real credential exposure (a MongoDB Atlas
connection string was briefly committed to `relayer/.env.example` before
being caught and redacted — see git history). Take this scenario seriously,
not hypothetically.

1. **Rotate the MongoDB Atlas password immediately** — Atlas dashboard →
   Database Access → edit user → regenerate. Update `MONGODB_URI` in
   Render's environment variables and redeploy.
2. Check Atlas's own audit log (if enabled) for connections from unexpected
   IPs, and for any writes you didn't expect.
3. **What an attacker with DB access can and can't do**, so you know what
   to actually check for: they CANNOT move funds — that requires a real
   cryptographic proof and an on-chain transaction, neither of which the
   database can forge. They CAN: read every trader's `revealedPrice` (a
   documented v1 trust-model tradeoff, but a real privacy breach if
   exploited), and potentially write fake `status: 'settled'` records that
   mislead the frontend into showing a trader a false confirmation. Cross-
   check any suspicious "settled" order against the actual on-chain
   `Settlement` contract events (`get_settlement_count`,
   `get_total_volume_xlm`/`usdc`) — the database is not the source of truth,
   the chain is.
4. If Atlas IP-allowlisting isn't already configured, this is the moment to
   add it (Render's outbound IPs, not `0.0.0.0/0`).

## Relayer signing key compromised or lost

Per `AUDIT_PREP.md` trust assumption 2: `relayer_1` can only affect
*which* crossing orders get matched and *when* — the match proof
cryptographically constrains price and amounts, so a compromised key
cannot forge a bad fill. The blast radius is censorship/delay, not theft.

1. If **lost** (can't sign anymore): relayer service is now unable to call
   `submit_match` at all — functionally equivalent to
   [relayer down](#relayer-down-or-degraded), except no key rotation will
   fix it. You need a new `relayer_1` address, which means calling
   `matching_engine.initialize` again — **not possible, no re-init path**.
   This is a "no upgrade mechanism" scenario; a real key-loss here requires
   redeploying `matching_engine` (and re-pointing `order_book`/
   `escrow_vault` at it, which themselves may need redeploying too since
   their `matching_engine` address is also set once at `initialize()`).
   This is expensive enough that key custody for `relayer_1` deserves real
   operational rigor (hardware wallet / secrets manager, not a plaintext
   `.env` file) — treat this section as the argument for that investment,
   not just a recovery plan.
2. If **compromised** (attacker has the key, you still have it too): same
   redeploy problem — you cannot revoke a compromised `relayer_1` address
   without redeploying `matching_engine`. In the meantime,
   [pause `matching_engine`](#how-to-pause-a-contract) to stop the attacker
   from submitting any matches (censoring is the worst they could already
   do; pausing just makes that total and intentional instead of them
   picking and choosing).
3. Either way: rotate `RELAYER_SECRET_KEY` in Render's env vars once a new
   key exists, and treat the old key as permanently burned.

## Frontend outage

Lowest severity of anything in this doc. The relayer and contracts don't
depend on the frontend at all — existing orders keep processing normally.

1. Check Vercel's status dashboard and deployment logs.
2. Worst case, redeploy: `npx vercel deploy --prod` locally, or re-trigger
   `deploy.yml`'s `deploy-frontend` job via `workflow_dispatch`.
3. No pause, no urgency beyond normal "traders can't place new orders" UX
   impact.

## Unexpected deploy

A push to `main` triggered `deploy.yml` and shipped something nobody
intended (compromised contributor account, leaked `GITHUB_TOKEN`, etc.).

1. `deploy.yml`'s three jobs now reference the `Production` GitHub
   Environment — check Settings → Environments → Production for whether
   required-reviewer protection is configured. If not yet configured
   (was true as of the last review — see repo history), there is currently
   no gate stopping an unexpected push from deploying; getting reviewers
   configured is a standing action item, not just an incident response step.
2. Contract deploys are opt-in (require `STELLAR_SECRET_KEY` to be set) and
   currently only ever target testnet (`contracts/scripts/deploy.sh`
   hardcodes `NETWORK="testnet"`) — an unexpected push cannot reach mainnet
   through this pipeline as currently wired.
3. Relayer/frontend deploys are NOT opt-in — they redeploy on every push to
   `main` regardless. If the deployed code is bad, revert the commit on
   `main` and let the pipeline redeploy the revert; don't try to manually
   patch a running Render/Vercel deployment out of band, or the next
   legitimate push will silently overwrite your manual fix.
4. Rotate any credential (`STELLAR_SECRET_KEY`, `RENDER_API_KEY`,
   `VERCEL_TOKEN`) you have reason to think was exposed.

---

## Contacts (fill in)

| Role | Name | Contact |
|---|---|---|
| Primary on-call | `[ ]` | |
| Contract admin key holder | `[ ]` | |
| MongoDB Atlas admin | `[ ]` | |
| Render account admin | `[ ]` | |
| Vercel account admin | `[ ]` | |

## After the incident

- Write down what happened while it's fresh — doesn't need to be formal,
  a paragraph in a shared doc beats nothing.
- If it was a contract/circuit bug: update `contracts/AUDIT_PREP.md` and
  (if circuits were involved) `circuits/CEREMONY_STATUS.md` — both are
  meant to stay accurate as the system's current-state reference, not just
  a one-time snapshot.
- If it was process (no reviewer gate, no key rotation plan, etc.): fix the
  gap in this doc so the next person doesn't rediscover it mid-incident.
