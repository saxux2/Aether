<div align="center">

<img width="2880" height="1573" alt="Aether Dark Pool" src="https://github.com/user-attachments/assets/b3174ee1-7216-4128-8129-cb2769df9625" />

<img src="https://img.shields.io/badge/Stellar-Soroban-7B2FBE?style=for-the-badge" />
<img src="https://img.shields.io/badge/Rust-1.70%2B-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/Next.js-15-black?style=for-the-badge" />
<img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge" />
<img src="https://img.shields.io/badge/Status-Live%20on%20Mainnet-brightgreen?style=for-the-badge" />

# Aether

### Zero-Knowledge Institutional Dark Pool DEX on Stellar Soroban

**Large-block XLM ↔ USDC trading where every order is sealed with a Groth16 ZK proof and matched in 60-second batch auctions — front-running is mathematically impossible.**

[Live App](https://aether-frontend-ruby.vercel.app) · [Relayer API](https://aether-zpkh.onrender.com/api/health) · [Explorer](https://stellar.expert/explorer/public) · [Contracts](#-deployed-contracts) · [Architecture](#-architecture) · [Quick Start](#-quick-start)

</div>

---

## Table of Contents

- [Overview](#-overview)
- [Why Aether](#-why-aether)
- [How It Works](#-how-it-works)
- [Architecture](#-architecture)
- [Zero-Knowledge Layer](#-zero-knowledge-layer)
- [Smart Contracts](#-smart-contracts)
- [Deployed Contracts](#-deployed-contracts)
- [Verifying On-Chain](#-verifying-on-chain)
- [Relayer & API Reference](#-relayer--api-reference)
- [Frontend](#-frontend)
- [Quick Start](#-quick-start)
- [Environment Variables](#-environment-variables)
- [Contract Deployment Guide](#-contract-deployment-guide)
- [Testing](#-testing)
- [Security Notes](#-security-notes)
- [Roadmap](#-roadmap)
- [Tech Stack](#-tech-stack)

---

## 📌 Overview

Aether is a **production-grade zero-knowledge dark pool DEX** built on Stellar Soroban. It enables large-block XLM ↔ USDC trades where the price, quantity, and direction of every order are **cryptographically sealed** until settlement — so no bot can read an order and front-run it.

- Orders are sealed as **Poseidon commitments** and gated by **real BN254 Groth16 proofs** verified on-chain via Stellar's native `bn254` host functions — not stubs, not mocks.
- Matching happens in **60-second batch auctions** at a **uniform clearing price** — there is nothing in the mempool to read, so there is nothing to front-run.
- Settlement is **atomic and non-custodial** — the escrow vault releases the exact cleared amount and refunds any surplus in a single transaction. The relayer never holds funds.

**This is not an AMM. It is a sealed-bid auction that settles like a traditional order book.**

---

## 🧩 Why Aether

### The Problem With Public Order Books

On any transparent DEX, a 500,000 XLM order is visible the moment it hits the mempool. Bots see it, front-run it, and the trader eats hundreds of thousands in slippage.

```
Public DEX / AMM
├── Order size + price visible before it settles
├── MEV bots sandwich large trades
├── Slippage: you pay worse than you quoted
└── Institutions can't move size without moving the market
```

### Aether's Answer: Don't Reveal the Order Until After Matching

```
Aether (ZK Dark Pool)
├── Order sealed as Poseidon(price, qty, direction, salt)
├── Validity proven with Groth16 — chain never sees price/qty
├── Matched in a 60s batch at ONE uniform clearing price
├── Zero front-running: nothing to read, nothing to sandwich
└── Atomic settlement: exact fill released, surplus refunded
```

| Public DEX / AMM | Aether |
|---|---|
| Order size & price exposed pre-trade | Sealed until settlement — invisible to bots |
| Continuous matching → front-run window | 60s sealed batch → no ordering to exploit |
| Slippage on every large order | Uniform clearing price, exact fill |
| Custodial or reserve-locked liquidity | Non-custodial escrow, surplus auto-refunded |
| "Trust us" matching | Match validity **proven on-chain** (match_proof) |

---

## ⚙️ How It Works

### Order Lifecycle

```
1. SEAL (browser)
   Trader picks price + qty + side. snarkjs generates 3 proofs locally:
     • order_commitment  → commitment = Poseidon(price, qty, dir, salt)
     • balance_proof     → balance ≥ qty, derives a nullifier
     • range_proof       → PRICE_MIN ≤ price ≤ PRICE_MAX
   Private inputs (price, qty) NEVER leave the browser.

2. LOCK + SUBMIT (on-chain)
   escrow_vault.deposit()  locks funds against the nullifier.
   order_book.submit_order() stores the commitment — ZK-gated:
   the contract verifies all 3 proofs and binds their public
   signals to the tx args before accepting the order.

3. BATCH MATCH (relayer, every 60s)
   The relayer collects sealed orders, computes the uniform
   clearing price that maximizes executed volume, then generates
   a match_proof (Groth16) proving the match arithmetic is correct.

4. SETTLE (on-chain, atomic)
   matching_engine.submit_match() verifies the match_proof and
   binds the proven amounts to the call, then calls settlement.settle():
     • cleared XLM/USDC transferred to each counterparty
     • any surplus (bid better than clearing) refunded
   All in one transaction. Double-settlement is impossible.
```

### The Sealed Commitment

```
commitment = Poseidon(price, quantity, direction, salt)
```

The chain stores only this hash. Price and quantity are proven to be well-formed and in-range **without ever being revealed**, and the proof's public signals are bound to the on-chain order so a proof can't be replayed or a fill size faked.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       TRADER'S BROWSER                          │
│                                                                  │
│  Next.js 15 + React 19          snarkjs WASM Proof Engine       │
│  ┌─────────────────────┐       ┌─────────────────────────────┐  │
│  │  Trade UI           │──────▶│  1. order_commitment proof  │  │
│  │  TradingChart (v5)  │       │  2. balance_proof           │  │
│  │  OrdersStrip        │       │  3. range_proof             │  │
│  │  Freighter wallet   │       │  ───────────────────────    │  │
│  └──────────┬──────────┘       │  Private inputs STAY HERE   │  │
│             │                  └──────────────┬──────────────┘  │
│             │ commitment + 3 proofs            │                 │
└─────────────┼──────────────────────────────────┼────────────────┘
              │                                  │
              ▼                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│              RELAYER (Node.js + Express + MongoDB)               │
│                  https://aether-zpkh.onrender.com               │
│                                                                  │
│  REST API ─── BatchAuctionService (60s cycle)                   │
│                   │                                              │
│                   ├── findMatches() → uniform clearing price     │
│                   ├── generateMatchProof() (snarkjs)             │
│                   └── submitMatch() → Soroban                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │  match_proof + signals (no secrets)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 SOROBAN SMART CONTRACTS (MAINNET)               │
│                                                                  │
│  ZKVerifier ──── OrderBook ──── MatchingEngine                 │
│  (BN254 Groth16)  (commitments)  (verify match proof)           │
│                        │               │                        │
│                   EscrowVault ◀── Settlement                    │
│                   (non-custodial    (atomic release             │
│                    vault)           + refund)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Language | Responsibility |
|---|---|---|
| `circuits/` | Circom 2.0 + snarkjs | Define ZK circuits, generate/verify Groth16 proofs |
| `contracts/zk_verifier` | Rust / Soroban | Real BN254 Groth16 pairing via Stellar host functions |
| `contracts/escrow_vault` | Rust / Soroban | Lock funds; release cleared amount + refund surplus |
| `contracts/order_book` | Rust / Soroban | Accept ZK-gated sealed order commitments |
| `contracts/matching_engine` | Rust / Soroban | Verify match proof on-chain before settlement |
| `contracts/settlement` | Rust / Soroban | Atomic XLM/USDC swap via escrow release |
| `packages/sdk` | TypeScript | Client-side proof generation + Soroban tx builder |
| `relayer/` | TypeScript | Batch auction runner, match prover, order API |
| `frontend/` | Next.js 15 | Trade terminal, charts, order management |

### Project Structure

```
aether/
├── circuits/                     # Circom 2.0 circuits + trusted setup
│   ├── order_commitment.circom   # Order validity proof (price/size sealed)
│   ├── balance_proof.circom      # Sufficient-funds proof + nullifier
│   ├── range_proof.circom        # Price-bounds proof
│   ├── match_proof.circom        # Trustless match-validity proof
│   ├── build/                    # Compiled wasm + zkeys + exported Soroban VKs
│   └── scripts/                  # compile, trusted setup, VK export
│
├── contracts/                    # Soroban contracts — Rust, Cargo workspace
│   ├── zk_verifier/src/          # On-chain BN254 Groth16 pairing verifier
│   ├── escrow_vault/src/         # Non-custodial fund lock/release
│   ├── order_book/src/           # Sealed order commitment storage
│   ├── matching_engine/src/      # Verifies match_proof, binds signals
│   ├── settlement/src/           # Atomic XLM/USDC swap
│   └── scripts/                  # build.sh, deploy.sh, deploy-mainnet.sh, initialize.sh
│
├── packages/sdk/src/             # @aether/sdk — shared TS client library
│   ├── commitment.ts             # Poseidon commitment + nullifier derivation
│   ├── prover.ts                 # snarkjs witness + proof generation
│   ├── soroban.ts                # Tx builders, BN254 wire encoding
│   └── relayer.ts                # Relayer REST client
│
├── relayer/src/                  # Node.js batch auction service
│   ├── db/                       # MongoDB models + queries
│   ├── routes/                   # Express REST API (orders, orderbook, health, status)
│   ├── services/                 # batchAuction, matcher, matchProver, soroban
│   └── types/
│
├── frontend/src/                 # Next.js 15 trading terminal
│   ├── app/(app)/                # trade, orders, portfolio routes
│   ├── components/               # trade/, wallet/, mobile/, landing/
│   ├── hooks/                    # useWallet, useOrders, useProver, useBatch…
│   ├── lib/                      # stellarWallet.ts, stellarHorizon.ts, sdk/
│   ├── store/                    # Zustand slices (wallet, orders)
│   └── utils/                    # constants, format, Stellar helpers
│
├── scripts/                      # e2e_test.js, fund_usdc.js, run_e2e.sh
├── .github/workflows/            # ci.yml (test/build) + deploy.yml (contract → relayer → frontend CD)
├── contracts/README.md           # Per-contract API reference
├── TRADER_GUIDE.md               # Order lifecycle, clearing-price math, refund semantics
└── readme.md                     # This file
```

---

## 🔐 Zero-Knowledge Layer

### Circuits

Four Groth16 circuits (Circom 2.0, BN254 curve):

| Circuit | Proves | Constraints |
|---|---|---|
| `order_commitment` | `commitment = Poseidon(price, qty, direction, salt)` | ~2,200 |
| `balance_proof` | `balance ≥ qty` and derives a nullifier | ~1,800 |
| `range_proof` | `PRICE_MIN ≤ price ≤ PRICE_MAX` | ~1,500 |
| `match_proof` | crossing prices, exact `usdc = floor(xlm × clearing / 1e6)` | ~2,406 |

### Public Signal Binding (on-chain enforcement)

`order_book::submit_order` enforces that proof public signals match the transaction arguments — a proof cannot be replayed or repurposed:

```
order_signals[0]   == 1                (valid flag)
order_signals[1]   == commitment       (prevents proof replay)
balance_signals[0] == nullifier        (links proof to this order)
range_signals[0]   == PRICE_MIN (1000)
range_signals[1]   == PRICE_MAX (10_000_000)
```

`matching_engine::submit_match` enforces:

```
match_signals[0]  == buyer_commitment
match_signals[1]  == seller_commitment
match_signals[3]  == xlm_amount        (relayer can't lie about fill size)
match_signals[4]  == usdc_amount
```

### BN254 Wire Encoding (Stellar-specific)

Stellar's `bn254` host functions use a specific byte ordering:

| Type | Format | Size |
|---|---|---|
| G1 point | `be(x) ‖ be(y)` | 64 bytes |
| G2 point | `be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)` — **imaginary-first** | 128 bytes |
| Fr scalar | `be(scalar)` | 32 bytes |

> snarkjs outputs G2 as `[c0, c1]`. The SDK's `g2ToBytes()` swaps to `c1, c0`. Getting this wrong makes every pairing fail silently — the single hardest bug in the project.

### Groth16 Verification Equation

```
e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1
where  vk_x = IC[0] + Σᵢ sigᵢ · IC[i+1]
```

Implemented in `contracts/zk_verifier/src/groth16.rs` using `env.crypto().bn254()` — `g1_mul()`, `g1_add()`, and `pairing_check()`.

---

## 📜 Smart Contracts

All contracts are written in **Rust / Soroban SDK** (`#![no_std]`) and compiled to WebAssembly (`wasm32v1-none`).

### `zk_verifier`

Real BN254 Groth16 verification. Stores four verification keys, set at initialization.

```rust
pub fn initialize(env, admin, vk_order, vk_balance, vk_range, vk_match)
pub fn verify_order_proof(env, proof: Groth16Proof, public_signals: Vec<BytesN<32>>) -> bool
pub fn verify_balance_proof(env, proof, public_signals) -> bool
pub fn verify_range_proof(env, proof, public_signals) -> bool
pub fn verify_match_proof(env, proof, public_signals) -> bool
```

### `escrow_vault`

Non-custodial vault. Funds are never held by the relayer.

```rust
pub fn initialize(env, admin, matching_engine, settlement)
pub fn deposit(env, trader, asset, amount, nullifier, commitment, expires_at)
pub fn release(env, nullifier, recipient, amount: i128)
  // transfers `amount` to recipient; refunds `deposit - amount` to trader atomically
pub fn get_deposit(env, nullifier) -> Option<DepositRecord>
```

### `order_book`

ZK-gated order registry. Stores commitments, never prices.

```rust
pub fn initialize(env, admin, zk_verifier, escrow_vault)
pub fn submit_order(env, trader, commitment, nullifier, asset_in, asset_out,
                    amount_in, order_proof, order_signals,
                    balance_proof, balance_signals,
                    range_proof, range_signals, expires_at) -> BytesN<32>
pub fn get_current_batch(env) -> u64
pub fn is_nullifier_used(env, nullifier) -> bool
```

### `matching_engine`

Trustless match validation — the relayer cannot lie about the clearing price.

```rust
pub fn initialize(env, admin, order_book, escrow_vault, settlement, zk_verifier, relayer_1)
pub fn submit_match(env, buyer_commitment, seller_commitment,
                    xlm_amount, usdc_amount,
                    match_proof: Groth16Proof, match_public_signals: Vec<BytesN<32>>)
```

Flow: require relayer auth → `verify_match_proof` → bind signals to args → call `settlement.settle()`.

### `settlement`

Atomic swap executor. Called only by `matching_engine`.

```rust
pub fn initialize(env, admin, matching_engine, escrow_vault, xlm_token, usdc_token)
pub fn settle(env, buyer_nullifier, seller_nullifier,
              buyer_address, seller_address, xlm_amount, usdc_amount)
pub fn get_total_volume_xlm(env) -> i128
pub fn get_total_volume_usdc(env) -> i128
```

> Full per-contract API reference: [`contracts/README.md`](contracts/README.md).

---

## 🚀 Deployed Contracts

### Stellar Mainnet — Live

> Explorer: [stellar.expert/explorer/public](https://stellar.expert/explorer/public)

| Contract | Address | Explorer |
|---|---|---|
| **ZKVerifier** | `CDW4JQNQKMNVLXJKI5HEOKVD4UFH3GPH2HKXPZZCHVLIGMGGVBSQJHZ7` | [view](https://stellar.expert/explorer/public/contract/CDW4JQNQKMNVLXJKI5HEOKVD4UFH3GPH2HKXPZZCHVLIGMGGVBSQJHZ7) |
| **EscrowVault** | `CAJ3A27JEGOQEPAQIDJFER3QBEZQKTZJR6OF4MR726IX3NWTW3QUYWT2` | [view](https://stellar.expert/explorer/public/contract/CAJ3A27JEGOQEPAQIDJFER3QBEZQKTZJR6OF4MR726IX3NWTW3QUYWT2) |
| **OrderBook** | `CAXR5KWD7EGYD5BP5TPIULBN34JGCGEPQU6XCQXPV4DWVQ6IBE6ZOSA5` | [view](https://stellar.expert/explorer/public/contract/CAXR5KWD7EGYD5BP5TPIULBN34JGCGEPQU6XCQXPV4DWVQ6IBE6ZOSA5) |
| **MatchingEngine** | `CAOTNMFUXGRGA6QACDFVPJ4TFDDFNASWEMBCHPSVBJ3ZQSRWW5XF52H2` | [view](https://stellar.expert/explorer/public/contract/CAOTNMFUXGRGA6QACDFVPJ4TFDDFNASWEMBCHPSVBJ3ZQSRWW5XF52H2) |
| **Settlement** | `CAPWWZPALWF4TRUV6ZBHYDFO5BJFVVJDE36WRU4AHKEJ5INB3FUHKB56` | [view](https://stellar.expert/explorer/public/contract/CAPWWZPALWF4TRUV6ZBHYDFO5BJFVVJDE36WRU4AHKEJ5INB3FUHKB56) |

### Supporting Addresses

| | Address |
|---|---|
| Native XLM SAC (mainnet) | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| Admin / Deployer | `GAC67RJCVUQM43H7ZNM5FLVTP6WI62XZJRNACRWNU76HL6VSSAGLCRE5` |
| Relayer signer | `GD4K5M62FDJ6GHU5B6BP46W6NMEIO5GHR7ECYKHL5N2XOCZAF4HAPQD2` |

**Network passphrase:** `Public Global Stellar Network ; September 2015`

> **USDC pairing:** the mainnet USDC SAC is configured via `NEXT_PUBLIC_USDC_TOKEN_ADDRESS` (frontend) and `USDC_TOKEN_ADDRESS` (relayer). Set these to the Circle mainnet USDC contract before enabling USDC-side trading.

### Live Services

| Surface | URL |
|---|---|
| **Frontend (Vercel)** | https://aether-frontend-ruby.vercel.app |
| **Relayer API (Render)** | https://aether-zpkh.onrender.com |
| **Relayer health** | https://aether-zpkh.onrender.com/api/health |
| **Relayer status** | https://aether-zpkh.onrender.com/api/status |

---

## 🔎 Verifying On-Chain

Everything Aether claims is enforced by the deployed contracts — you can check it yourself.

**Query live relayer state:**
```bash
curl https://aether-zpkh.onrender.com/api/status
# → { "running": true, "network": "mainnet",
#     "order_book_address": "CAXR5KWD...", "current_batch_id": <n>, ... }
```

**Invoke the ZKVerifier directly** (real proof returns `true`; flip one signal byte and it returns `false`):
```bash
stellar contract invoke \
  --id CDW4JQNQKMNVLXJKI5HEOKVD4UFH3GPH2HKXPZZCHVLIGMGGVBSQJHZ7 \
  --source <your-key> --network mainnet \
  -- verify_order_proof \
  --proof '{"pi_a":"<hex64>","pi_b":"<hex128>","pi_c":"<hex64>"}' \
  --public_signals '["<hex32>","<hex32>"]'
```

**On-chain forgery rejection** (enforced by the live contracts):

| Attack | Result |
|---|---|
| Real proof + tampered clearing-price signal | `verify_match_proof → false` → VM trap |
| Valid proof + lied `usdc_amount` arg | signal binding fails → panic `"usdc amount not proven"` |

Browse all contract activity on [Stellar Expert (public network)](https://stellar.expert/explorer/public/contract/CAXR5KWD7EGYD5BP5TPIULBN34JGCGEPQU6XCQXPV4DWVQ6IBE6ZOSA5).

---

## 🤖 Relayer & API Reference

**Stack:** Node.js 20 · TypeScript · Express · Mongoose (MongoDB Atlas)

Base URL: `https://aether-zpkh.onrender.com`

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/orders/submit` | Accept a signed Soroban tx + ZK proofs |
| `GET` | `/api/orders` | List orders by trader address |
| `GET` | `/api/orders/:commitment` | Order status + settlement tx hash |
| `GET` | `/api/orderbook/depth` | Anonymized price-bucketed depth |
| `GET` | `/api/orderbook/trades` | Recent settled trades |
| `GET` | `/api/orderbook/batch` | Current batch ID + seconds remaining |
| `GET` | `/api/health` | Liveness + Mongo/Stellar connectivity |
| `GET` | `/api/status` | Network, batch interval, contract addresses |

### Batch Auction Service (every 60s)

```
1. Close current batch, open new one
2. Separate buyers (USDC→XLM) and sellers (XLM→USDC)
3. findMatches()        → uniform-price batch auction (maximizes executed volume)
4. generateMatchProof() → snarkjs Groth16 proof of matching validity
5. submitMatch()        → on-chain; the contract verifies the proof before settlement
```

### Uniform Clearing Price

```typescript
// Sweep all bid/ask prices for the price that maximizes executed XLM volume.
// Clearing price = midpoint of the max-volume range. Every pair settles at ONE price.
function computeClearingPrice(buyers, sellers): bigint | null {
  const candidates = [...buyPrices, ...sellPrices].sort();
  let bestVol = 0n, bestRange = [null, null];
  for (const p of candidates) {
    const vol = min(cumBuyVol(p), cumSellVol(p));
    if (vol > bestVol) { bestVol = vol; bestRange = [p, p]; }
    else if (vol === bestVol) bestRange[1] = p;
  }
  return bestRange[0] == null ? null : (bestRange[0] + bestRange[1]) / 2n;
}
```

---

## 🖥 Frontend

**Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS · lightweight-charts v5.2 · Freighter API v4 · Zustand 5 + TanStack Query 5

| Route | Description |
|---|---|
| `/` | Landing page with live settlement feed |
| `/trade` | Full trading terminal |
| `/orders` | Open + historical orders |
| `/portfolio` | P&L, filled / refunded amounts |

### Trade Terminal Layout

```
┌──────────────────────────────────────────────────┐
│  TickerBar  (24h stats: price, change, volume)   │
├────────────────────────┬─────────────────────────┤
│  TradingChart          │  TradePanel              │
│  (candles + vol SMA)   │  (Buy/Sell, % slider,   │
│                        │   proof step progress)   │
├────────────────────────┤  MarketPanel             │
│  OrdersStrip           │  (Order Book /           │
│  (Open / History)      │   Recent Trades tabs)    │
└────────────────────────┴─────────────────────────┘
```

- TradingChart uses the TradingView-style dark theme with a candlestick pane (76%) + volume histogram and Volume SMA(9) (24%), floating legends, crosshair tracking, and an interval selector.
- Wallet integration via **Freighter** — the app checks that Freighter's active network matches Aether's configured network (mainnet) before connecting, so a wallet on the wrong network fails fast with a clear message instead of an opaque signing error.
- Fully responsive: a stacked single-column mobile layout below the breakpoint.

---

## ⚡ Quick Start

### Prerequisites

- **Rust** 1.70+ with the `wasm32v1-none` target
- **Node.js** 20+
- **Stellar CLI** (`cargo install --locked stellar-cli --features opt`)
- **MongoDB** (local or Atlas)
- **Freighter** browser extension set to **Mainnet (Public)**
- A funded Stellar mainnet account (XLM for fees + a USDC trustline for USDC trades)

### 1. Clone & Install

```bash
git clone https://github.com/saxux2/Aether.git
cd Aether
npm install   # installs all workspaces (circuits, sdk, relayer, frontend)
```

### 2. Build Contracts

```bash
cd contracts
make build      # cargo build --target wasm32v1-none --release (5 contracts)
make optimize   # stellar contract optimize
```

### 3. Run the Relayer

```bash
cp relayer/.env.example relayer/.env    # fill in MongoDB URI + relayer key + contract addresses
npm run dev:relayer
# → Relayer listening on port 3001
# → [Relayer] Network: mainnet
```

### 4. Run the Frontend

```bash
cp frontend/.env.example frontend/.env.local   # fill in contract addresses + network
npm run dev:frontend
# → http://localhost:3000
```

> **Note:** `next dev` reads `.env.local`. Production behavior (mainnet) is baked at **build** time from `.env.production.local` — verify with `npm run build && npm run start`.

### 5. Place a Trade

1. Open the app and connect Freighter (set to **Mainnet / Public**).
2. Pick a side, price, and size on `/trade`.
3. Approve the proof + submission in Freighter — proofs are generated locally in your browser.
4. Your order joins the current 60s batch; watch it settle in the Orders strip.

---

## 🔑 Environment Variables

### `relayer/.env`

```env
PORT=3001
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/darkpool
MONGODB_DB_NAME=darkpool
RELAYER_SECRET_KEY=S...            # dedicated relayer key — NOT the admin key
STELLAR_NETWORK=mainnet
STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
BATCH_INTERVAL_SECONDS=60
ALLOWED_ORIGINS=https://aether-frontend-ruby.vercel.app
ZK_VERIFIER_ADDRESS=CDW4JQNQKMNVLXJKI5HEOKVD4UFH3GPH2HKXPZZCHVLIGMGGVBSQJHZ7
ESCROW_VAULT_ADDRESS=CAJ3A27JEGOQEPAQIDJFER3QBEZQKTZJR6OF4MR726IX3NWTW3QUYWT2
ORDER_BOOK_ADDRESS=CAXR5KWD7EGYD5BP5TPIULBN34JGCGEPQU6XCQXPV4DWVQ6IBE6ZOSA5
MATCHING_ENGINE_ADDRESS=CAOTNMFUXGRGA6QACDFVPJ4TFDDFNASWEMBCHPSVBJ3ZQSRWW5XF52H2
SETTLEMENT_ADDRESS=CAPWWZPALWF4TRUV6ZBHYDFO5BJFVVJDE36WRU4AHKEJ5INB3FUHKB56
```

### `frontend/.env.production.local`

```env
NEXT_PUBLIC_RELAYER_URL=https://aether-zpkh.onrender.com
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=CDW4JQNQKMNVLXJKI5HEOKVD4UFH3GPH2HKXPZZCHVLIGMGGVBSQJHZ7
NEXT_PUBLIC_ORDER_BOOK_ADDRESS=CAXR5KWD7EGYD5BP5TPIULBN34JGCGEPQU6XCQXPV4DWVQ6IBE6ZOSA5
NEXT_PUBLIC_ESCROW_VAULT_ADDRESS=CAJ3A27JEGOQEPAQIDJFER3QBEZQKTZJR6OF4MR726IX3NWTW3QUYWT2
NEXT_PUBLIC_MATCHING_ENGINE_ADDRESS=CAOTNMFUXGRGA6QACDFVPJ4TFDDFNASWEMBCHPSVBJ3ZQSRWW5XF52H2
NEXT_PUBLIC_SETTLEMENT_ADDRESS=CAPWWZPALWF4TRUV6ZBHYDFO5BJFVVJDE36WRU4AHKEJ5INB3FUHKB56
NEXT_PUBLIC_XLM_TOKEN_ADDRESS=native
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=    # Circle mainnet USDC SAC
```

---

## 🛠 Contract Deployment Guide

> Contracts are already live on mainnet (see [Deployed Contracts](#-deployed-contracts)). This is for a fresh deployment.

```bash
# 1. Create + fund a dedicated mainnet deployer (real XLM required — no Friendbot)
stellar keys generate --global darkpool-mainnet-deployer --network mainnet
#    Send ~60 XLM to its address for deploy + init fees.

# 2. Build + optimize
cd contracts
make build      # cargo build --target wasm32v1-none --release
make optimize   # produces .optimized.wasm for each contract

# 3. Deploy all 5 contracts to mainnet
./scripts/deploy-mainnet.sh
#    Writes the 5 fresh addresses into ../.env
#    Uses --inclusion-fee 10000000: the CLI's 100-stroop default is too low
#    for mainnet fee-market conditions and submissions time out without it.

# 4. Export verification keys + initialize (sets VKs, links contract addresses)
node circuits/scripts/export_soroban_vk.js
bash contracts/scripts/initialize.sh
```

### Gotchas

| Issue | Fix |
|---|---|
| `.optimized.wasm` is stale | Run `stellar contract optimize` after every `cargo build` — it does not auto-rebuild |
| VK arg parse fails | The CLI expects **hex**, not base64 |
| `rpc-url is used but network passphrase is missing` | Pass `--network-passphrase "Public Global Stellar Network ; September 2015"` |
| Mainnet deploy times out / `TxInsufficientFee` | Raise `--inclusion-fee` (the script uses `10000000`) |
| `txBadSeq` | The relayer key and trader key **must** be different accounts |

---

## 🧪 Testing

| Suite | Runner | Count | Status |
|---|---|---|---|
| ZKVerifier contract | `cargo test` | 7 | ✅ 7/7 |
| EscrowVault contract | `cargo test` | 4 | ✅ 4/4 |
| Relayer matcher | Jest | 12 | ✅ 12/12 |
| Frontend utilities | Jest | 13 | ✅ 13/13 |
| Full E2E (on-chain) | Node | 33 | ✅ 33/33 |

```bash
# Contracts
cd contracts && cargo test

# Relayer
cd relayer && npm test

# Frontend
cd frontend && npm test

# Full end-to-end (real BUY + SELL → match → settlement)
cd relayer && BATCH_INTERVAL_SECONDS=10 npx ts-node src/index.ts   # terminal 1
node scripts/e2e_test.js                                           # terminal 2
```

---

## 🛡 Security Notes

> **Aether is live on Stellar Mainnet and has not yet undergone a third-party
> security audit.** Trades move real funds — use at your own risk and start
> small. The table below reflects what is and isn't enforced today.

| Area | Current State | Production Recommendation |
|---|---|---|
| **Order privacy** | Price/qty sealed as Poseidon commitment, proven in ZK | Confirmed by design — never revealed pre-settlement |
| **Match integrity** | `match_proof` verified on-chain; amounts bound to signals | Confirmed — relayer cannot fake fills or clearing price |
| **Anti-replay** | Proof public signals bound to `commitment` / `nullifier` | Confirmed — enforced on-chain |
| **Custody** | Non-custodial escrow; relayer never holds funds | Confirmed |
| **Double-settlement** | `EscrowVault.release` closes the deposit atomically | Confirmed |
| **Relayer** | Single relayer (trust for liveness only) | Move to 2-of-3 threshold relayer set |
| **Partial fills** | v1 escrow is all-or-nothing; unfilled portion refunded | Add resting partial fills |
| **Admin key** | Single deployer/admin keypair | Migrate to multisig |
| **Audit** | **Not independently audited** | Full third-party audit |

### What the Relayer Cannot Do

- Forge a proof for an invalid match
- Lie about the clearing price or fill amounts (bound to proof public signals)
- Front-run orders (prices are never revealed until after escrow lock)
- Double-settle (deposits are marked settled atomically)

---

## 📈 Roadmap

### Phase 1 — Mainnet Launch (Current ✅)
- [x] 5 Soroban contracts deployed + initialized on Stellar mainnet
- [x] Real BN254 Groth16 verification via Stellar `bn254` host functions
- [x] Sealed order commitments + 3-proof ZK-gated submission
- [x] 60s uniform-clearing-price batch auction with on-chain match proof
- [x] Non-custodial atomic settlement with surplus refund
- [x] Next.js 15 trade terminal + Freighter mainnet integration
- [x] Live relayer (Render) + frontend (Vercel) with CI/CD

### Phase 2 — Protocol Maturation
- [ ] USDC pair fully wired on mainnet
- [ ] Resting partial fills (multi-batch orders)
- [ ] Threshold relayer set (2-of-3) for liveness
- [ ] Provable global volume-maximization for the clearing price

### Phase 3 — Hardening & Ecosystem
- [ ] Third-party security audit
- [ ] Additional pairs via wrapped assets
- [ ] Public API for aggregator / wallet integrations
- [ ] Protocol governance for fee + range parameters

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Stellar Mainnet (Soroban) |
| Contract language | Rust (`#![no_std]`, `soroban-sdk`) |
| Build target | `wasm32v1-none` |
| ZK proof system | Groth16 / BN254 via Stellar native `bn254` host functions |
| Circuit language | Circom 2.0 |
| Proof library | snarkjs |
| Frontend | Next.js 15 · React 19 · TypeScript |
| Styling | Tailwind CSS |
| Charts | lightweight-charts 5.2 |
| Wallet | Freighter (`@stellar/freighter-api`) |
| State | Zustand 5 · TanStack Query 5 |
| Relayer | Node.js 20 · TypeScript · Express |
| Database | MongoDB Atlas (Mongoose 8) |
| Package manager | npm workspaces |
| CI/CD | GitHub Actions |
| Frontend hosting | Vercel |
| Relayer hosting | Render |

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Build contracts: `cd contracts && make build`
4. Run all tests (contracts + relayer + frontend) — everything must pass
5. Submit a pull request with a clear description of the change

---

## 📄 License

MIT © 2026 Aether

---

<div align="center">

**Aether — Sealed Orders. Proven Matches. Zero Front-Runs.**

Built on Stellar Soroban · Proven by BN254 Groth16

[Live App](https://aether-frontend-ruby.vercel.app) · [Relayer API](https://aether-zpkh.onrender.com/api/health) · [GitHub](https://github.com/saxux2/Aether)

</div>
