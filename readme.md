<div align="center">

<img width="2880" height="1573" alt="Screenshot from 2026-07-01 16-01-57" src="https://github.com/user-attachments/assets/b3174ee1-7216-4128-8129-cb2769df9625" />



<img src="https://img.shields.io/badge/Stellar-Soroban-7B2FBE?style=for-the-badge" />
<img src="https://img.shields.io/badge/Rust-1.70%2B-red?style=for-the-badge" />
<img src="https://img.shields.io/badge/Next.js-14-black?style=for-the-badge" />
<img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge" />
<img src="https://img.shields.io/badge/Status-Live%20on%20Testnet-brightgreen?style=for-the-badge" />

# Aether Dark Pool

> **Zero-Knowledge Institutional Dark Pool DEX on Stellar Soroban**
>
> XLM/USDC large-block trading where every order is sealed with a Groth16 ZK proof and matched via 60-second batch auctions — front-running is mathematically impossible.

</div>

---

## Live Demo

| Surface | URL |
|---|---|
| **Frontend (Vercel)** | https://aetherstellar.vercel.app/ |
| **Relayer API** | https://aether-w5p8.onrender.com |
| **Stellar Expert** | https://stellar.expert/explorer/testnet |
| **Demo Video** | https://youtu.be/QfoVpdBGuak?si=B0NtlL9a9txCRX4r |

---

## Table of Contents

1. [What This Is](#1-what-this-is)
2. [Architecture](#2-architecture)
3. [Zero-Knowledge Layer](#3-zero-knowledge-layer)
4. [Smart Contracts](#4-smart-contracts)
5. [Contract Deployment Addresses](#5-contract-deployment-addresses)
6. [Verified On-Chain Transactions](#6-verified-on-chain-transactions)
7. [Frontend](#7-frontend)
8. [Relayer](#8-relayer)
9. [Technology Stack](#9-technology-stack)
10. [Installation](#10-installation)
11. [Environment Variables](#11-environment-variables)
12. [Smart Contract Deployment Guide](#12-smart-contract-deployment-guide)
13. [Testing](#13-testing)
14. [CI/CD Pipeline](#14-cicd-pipeline)
15. [Event Streaming Architecture](#15-event-streaming-architecture)
16. [Security Model](#16-security-model)
17. [Troubleshooting](#17-troubleshooting)
18. [Screenshots](#18-screenshots)
19. [Git History](#19-git-history)
20. [User Feedback Implementation](#20-user-feedback-implementation)

---

## 1. What This Is

Aether is a **limit-order-book DEX** for the XLM/USDC pair on Stellar Soroban where:

- Orders are **cryptographically sealed** — price, quantity, and direction are hidden until settlement
- Matching happens in **60-second batch auctions** — no order can be front-run because there is nothing to read
- Settlement is **atomic and non-custodial** — escrow releases exact cleared amounts and refunds surplus in one transaction
- ZK proofs use **real BN254 Groth16 pairings** via Stellar's native `bn254` host functions — not stubs

This is not an AMM. This is a sealed-bid auction that settles like a traditional order book.

### Why Dark Pool?

On any public DEX, a 500k XLM order is visible the moment it hits the mempool. Bots front-run it and the trader loses hundreds of thousands. Aether's answer: **don't reveal the order until after matching is complete**. A Groth16 proof lets the chain verify the order is valid (price in range, funds locked, no double-spend) without ever seeing the price or quantity.

---

## 2. Architecture

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
│                   RELAYER (Node.js + MongoDB)                    │
│                                                                  │
│  Express API ─── BatchAuctionService (60s cycle)                │
│                   │                                              │
│                   ├── findMatches() → uniform clearing price     │
│                   ├── generateMatchProof() (snarkjs)             │
│                   └── submitMatch() → Soroban                    │
└──────────────────────────┬──────────────────────────────────────┘
                           │  match_proof + signals (no secrets)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  SOROBAN SMART CONTRACTS                         │
│                                                                  │
│  ZKVerifier ──── OrderBook ──── MatchingEngine                  │
│  (BN254 Groth16)  (commitments)  (verify match proof)           │
│                        │               │                        │
│                   EscrowVault ◀── Settlement                    │
│                   (non-custodial    (atomic release              │
│                    vault)           + refund)                    │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Language | Responsibility |
|---|---|---|
| `circuits/` | Circom 2.0 + snarkjs | Define ZK circuits, generate/verify Groth16 proofs |
| `contracts/zk_verifier` | Rust/Soroban | Real BN254 Groth16 pairing via Stellar host functions |
| `contracts/escrow_vault` | Rust/Soroban | Lock funds; release cleared amount + refund surplus |
| `contracts/order_book` | Rust/Soroban | Accept ZK-gated sealed order commitments |
| `contracts/matching_engine` | Rust/Soroban | Verify match proof on-chain before settlement |
| `contracts/settlement` | Rust/Soroban | Atomic XLM/USDC swap via escrow release |
| `packages/sdk` | TypeScript | Client-side proof generation + Soroban tx builder |
| `relayer/` | TypeScript | Batch auction runner, match prover, order API |
| `frontend/` | Next.js 15 | Trade terminal, charts, order management |

### Project Structure

```
aether/
├── circuits/                     # Circom 2.0 circuits + trusted setup
│   ├── order_commitment.circom   # Order validity proof (price/size sealed)
│   ├── balance_proof.circom      # Sufficient-funds proof
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
│   └── scripts/                  # build.sh, deploy.sh, initialize.sh
│
├── packages/sdk/src/             # @aether/sdk — shared TS client library
│   ├── commitment.ts             # Poseidon commitment + nullifier derivation
│   ├── prover.ts                 # snarkjs witness + proof generation
│   ├── soroban.ts                # Tx builders, BN254 wire encoding
│   └── relayer.ts                # Relayer REST client
│
├── relayer/src/                  # Node.js batch auction service
│   ├── db/                       # MongoDB models + queries
│   ├── routes/                   # Express REST API (orders, orderbook, health)
│   ├── services/                 # batchAuction, matcher, matchProver, soroban
│   └── types/
│
├── frontend/src/                 # Next.js 15 trading terminal
│   ├── app/(app)/                # trade, orders, portfolio routes
│   ├── components/
│   │   ├── trade/                # TradingChart, TradePanel, OrdersStrip, MarketPanel
│   │   ├── wallet/               # SendXlmForm, Freighter wallet UI
│   │   ├── mobile/               # Responsive mobile views
│   │   └── landing/              # Marketing page sections
│   ├── hooks/                    # useWallet, useOrders, useProver, useBatch...
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

## 3. Zero-Knowledge Layer

### Circuit Overview

Four Groth16 circuits (Circom 2.0, BN254 curve):

| Circuit | Purpose | Constraints |
|---|---|---|
| `order_commitment` | Proves `commitment = Poseidon(price, qty, direction, salt)` | ~2200 |
| `balance_proof` | Proves `balance ≥ qty` and derives nullifier | ~1800 |
| `range_proof` | Proves `PRICE_MIN ≤ price ≤ PRICE_MAX` | ~1500 |
| `match_proof` | Proves crossing prices, exact `usdc = floor(xlm × clearing / 1e6)` | ~2406 |

### Public Signal Binding (on-chain enforcement)

`order_book::submit_order` enforces that proof public signals match the transaction arguments:

```
order_signals[0]   == 1                  (valid flag)
order_signals[1]   == commitment         (prevents proof replay)
balance_signals[0] == nullifier          (links proof to this order)
range_signals[0]   == PRICE_MIN(1000)
range_signals[1]   == PRICE_MAX(10_000_000)
```

`matching_engine::submit_match` enforces:

```
match_signals[0]  == buyer_commitment
match_signals[1]  == seller_commitment
match_signals[3]  == xlm_amount          (prevents lying about fill size)
match_signals[4]  == usdc_amount
```

### BN254 Wire Encoding (Stellar-specific)

Stellar's `bn254` host functions use a specific byte ordering:

| Type | Format | Size |
|---|---|---|
| G1 point | `be(x) ‖ be(y)` | 64 bytes |
| G2 point | `be(x.c1) ‖ be(x.c0) ‖ be(y.c1) ‖ be(y.c0)` — **imaginary-first** | 128 bytes |
| Fr scalar | `be(scalar)` | 32 bytes |

> snarkjs outputs G2 as `[c0, c1]`. The SDK's `g2ToBytes()` swaps to `c1, c0`. Getting this wrong makes every pairing fail silently — the hardest bug in the project.

### Groth16 Verification Equation

```
e(−A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1

where  vk_x = IC[0] + Σᵢ sigᵢ · IC[i+1]
```

Implemented in `contracts/zk_verifier/src/groth16.rs` using:
- `env.crypto().bn254().g1_mul()` — scalar multiplication
- `env.crypto().bn254().g1_add()` — point addition
- `env.crypto().bn254().pairing_check()` — multi-pairing equality check

### Trusted Setup

```bash
# Phase 1 (Powers of Tau)
snarkjs powersoftau new bn128 12 pot12_0.ptau
snarkjs powersoftau contribute pot12_0.ptau pot12_final.ptau

# Phase 2 (per-circuit)
snarkjs groth16 setup order_commitment.r1cs pot12_final.ptau order_commitment_0.zkey
snarkjs zkey contribute order_commitment_0.zkey order_commitment_final.zkey

# Export VKs for Soroban (hex-encoded, G2 imaginary-first)
node circuits/scripts/export_soroban_vk.js
```

---

## 4. Smart Contracts

### ZKVerifier (`contracts/zk_verifier/`)

Real BN254 Groth16 verification. Stores four verification keys set at initialization.

```rust
pub fn initialize(env, admin, vk_order, vk_balance, vk_range, vk_match)
pub fn verify_order_proof(env, proof: Groth16Proof, public_signals: Vec<BytesN<32>>) -> bool
pub fn verify_balance_proof(env, proof, public_signals) -> bool
pub fn verify_range_proof(env, proof, public_signals) -> bool
pub fn verify_match_proof(env, proof, public_signals) -> bool
pub fn get_admin(env) -> Address
```

**7/7 tests passing** — real proof verifies, tampered signal rejects, wrong proof rejects, signal count mismatch rejects, match proof verifies, tampered clearing price rejects, double-init panics.

### EscrowVault (`contracts/escrow_vault/`)

Non-custodial vault. Funds are never held by the relayer.

```rust
pub fn initialize(env, admin, matching_engine, settlement)
pub fn deposit(env, trader, asset, amount, nullifier, commitment, expires_at)
pub fn release(env, nullifier, recipient, amount: i128)
  // transfers `amount` to recipient; refunds `deposit - amount` to trader atomically
pub fn get_deposit(env, nullifier) -> Option<DepositRecord>
```

### OrderBook (`contracts/order_book/`)

ZK-gated order registry. Stores commitments, never prices.

```rust
pub fn initialize(env, admin, zk_verifier, escrow_vault)
pub fn submit_order(env, trader, commitment, nullifier, asset_in, asset_out,
                    amount_in, order_proof, order_signals,
                    balance_proof, balance_signals,
                    range_proof, range_signals, expires_at) -> BytesN<32>
pub fn get_order(env, commitment) -> Option<OrderRecord>
pub fn get_current_batch(env) -> u64
pub fn is_nullifier_used(env, nullifier) -> bool
```

### MatchingEngine (`contracts/matching_engine/`)

Trustless match validation — the relayer cannot lie about the clearing price.

```rust
pub fn initialize(env, admin, order_book, escrow_vault, settlement, zk_verifier, relayer_1)
pub fn submit_match(env, buyer_commitment, seller_commitment,
                    xlm_amount, usdc_amount,
                    match_proof: Groth16Proof, match_public_signals: Vec<BytesN<32>>)
pub fn get_match_count(env) -> u64
```

`submit_match` flow: require relayer auth → `verify_match_proof` → bind signals to args → call `settlement.settle()`.

### Settlement (`contracts/settlement/`)

Atomic swap executor. Called only by MatchingEngine.

```rust
pub fn initialize(env, admin, matching_engine, escrow_vault, xlm_token, usdc_token)
pub fn settle(env, buyer_nullifier, seller_nullifier,
              buyer_address, seller_address, xlm_amount, usdc_amount)
pub fn get_settlement_count(env) -> u64
pub fn get_total_volume_xlm(env) -> i128
pub fn get_total_volume_usdc(env) -> i128
```

---

## 5. Contract Deployment Addresses

**Network:** Stellar Testnet · **Deployed:** 2026-06-30

| Contract | Address |
|---|---|
| **ZKVerifier** | `CCACFEJDSARJFCKNI2FLTKSAG3UW4NMQIBJKMRAHKVAN5SYI4AV2YDHG` |
| **EscrowVault** | `CCQIBBTXXLZQMYUUXINOCCLSI7JY535JWBEG23SUR3YEPL34BJ6O5EJR` |
| **OrderBook** | `CBHSOI5QFEG6WVNVGXMIOI4AVL2HWD6O6IQ5YA245HYDW25NBERSNAKP` |
| **Settlement** | `CBMIPVZCCT67UOEMXLFOY4A2EWGECGU74WJQ2COGXQIPW5RS4KEECTO4` |
| **MatchingEngine** | `CALBAJWC3EFVESRV3NABF6ULYTJ5SMSVTLTRFPIQPX7H2MBBLHAUXNDH` |

**Supporting addresses:**

| | Address |
|---|---|
| Native XLM SAC | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |
| USDC (testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Admin/deployer | `GD4RXXGZDAO2RKMLWAMU7ZDTFKHYMIECUZQDWCMZVCVDDDPDVUFIMPJW` |
| Relayer | `GD7ZTJ6XFHONCB5P52LBXOG2DQUOOKAWXPKTCTJCHI352RCWPKUBMG6Z` |

> [View on Stellar Expert →](https://stellar.expert/explorer/testnet/contract/CCACFEJDSARJFCKNI2FLTKSAG3UW4NMQIBJKMRAHKVAN5SYI4AV2YDHG)

---

## 6. Verified On-Chain Transactions

### Full E2E: BUY + SELL → Match → Settlement

| Step | Transaction Hash | Ledger |
|---|---|---|
| BUY submitted | `301e9023...` | Testnet |
| SELL submitted | `40c03552...` | Testnet |
| **Settlement** | `810f9a7e86c90e1ffebe3972f150a0f5ade34a11bb7e45a5f8b61963f6d7fd9c` | **3358708** |

**Settlement `asset_balance_changes` (ledger 3358708):**
```
USDC 67.50  →  seller    (cleared: 500 XLM × $0.135)
USDC  2.50  →  buyer     (refund: bid $0.140, cleared $0.135)
XLM 500.00  →  buyer
```

### On-Chain Forgery Rejection (Live Contract)

| Attack | Result |
|---|---|
| Real proof + tampered clearing_price signal | `verify_match_proof → false` → `VM trapped UnreachableCodeReached` |
| Valid proof + lied `usdc_amount` arg | `verify_match_proof → true` → panic `"usdc amount not proven"` |

Both visible in `stellar contract invoke` diagnostic event log — unambiguous on-chain proof enforcement.

### Invoke ZKVerifier Directly

```bash
# Verify a real order proof (returns true)
stellar contract invoke \
  --id CCACFEJDSARJFCKNI2FLTKSAG3UW4NMQIBJKMRAHKVAN5SYI4AV2YDHG \
  --source darkpool-relayer --network testnet \
  -- verify_order_proof \
  --proof '{"pi_a":"<hex64>","pi_b":"<hex128>","pi_c":"<hex64>"}' \
  --public_signals '["<hex32>","<hex32>"]'
# → true

# Tamper a signal byte → false
```

---

## 7. Frontend

**Stack:** Next.js 15 · React 19 · TypeScript · Tailwind CSS · lightweight-charts v5.2 · Freighter API v4

### Pages

| Route | Description |
|---|---|
| `/` | Landing page with live settlement feed |
| `/trade` | Full trading terminal |
| `/orders` | Open + historical orders |
| `/portfolio` | P&L, filled/refunded amounts |

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
│  (Open / History /     │   Recent Trades tabs)    │
│   Trade History)       │                          │
└────────────────────────┴─────────────────────────┘
```

### TradingChart (lightweight-charts v5)

- TV dark theme: `#131722` bg, `#1c2030` grid
- Candle colors: UP `#0ecb81`, DOWN `#f6465d`
- Two panes: candlestick (76%) + volume histogram + Volume SMA(9) line (24%)
- Continuous OHLC: `open = previous close` (eliminates invisible 1px dojis)
- Floating legends, crosshair-tracking, interval selector (1 5 15 30 60 240 D)

### Frontend Integration Files

**`src/lib/stellar-sdk.ts`** — SorobanRpc server + network passphrase:
```typescript
export const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
export const networkPassphrase = StellarSdk.Networks.TESTNET;
export { StellarSdk };
```

**`src/lib/contract.ts`** — generic Soroban contract caller:
```typescript
// Calls any contract method — simulate-only for reads, sign+submit for writes
export async function callContractFunction(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  signerSecret?: string,
): Promise<xdr.ScVal | null>

// Read-only demo: reads current batch ID from OrderBook
export async function readCurrentBatch(): Promise<number | null>
```

---

## 8. Relayer

**Stack:** Node.js 20 · TypeScript · Express · Mongoose (MongoDB Atlas)

### API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/orders/submit` | Accept signed Soroban tx + ZK proofs |
| `GET` | `/api/orders` | List orders by trader address |
| `GET` | `/api/orders/:commitment` | Order status + settlement tx hash |
| `GET` | `/api/orderbook/depth` | Anonymized price-bucketed depth |
| `GET` | `/api/orderbook/trades` | Recent settled trades |
| `GET` | `/api/orderbook/batch` | Current batch ID + seconds remaining |
| `GET` | `/api/health` | Liveness probe |

### Batch Auction Service (every 60s)

1. Close current batch, open new one
2. Separate buyers (USDC→XLM) and sellers (XLM→USDC)
3. `findMatches()` — uniform-price batch auction (maximizes executed volume)
4. `generateMatchProof()` — snarkjs Groth16 proof of matching validity
5. `submitMatch()` — on-chain call; contract verifies proof before settlement

### Uniform Clearing Price Algorithm

```typescript
// Sweep all bid/ask prices to find the price that maximizes XLM volume
// Clearing price = midpoint of the max-volume range
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

### Single-Settlement Invariant

v1 `EscrowVault.release(amount)` closes the deposit permanently. The matcher consumes both orders per match — no resting partial fills. The contract refunds the unfilled portion atomically.

---

## 9. Technology Stack

| Layer | Technology |
|---|---|
| Blockchain | Stellar Soroban |
| Contract language | Rust (`#![no_std]`, `soroban-sdk = "26.0.1"`) |
| Build target | `wasm32v1-none` (required for SDK 26.x) |
| ZK proof system | Groth16 / BN254 via Stellar native `bn254` host functions |
| Circuit language | Circom 2.0 |
| Proof library | snarkjs 0.7.3 |
| Frontend | Next.js 15 / React 19 / TypeScript |
| Styling | Tailwind CSS 3.4 |
| Charts | lightweight-charts 5.2 |
| Wallet | Freighter API v4 |
| State | Zustand 5 + TanStack Query 5 |
| Relayer | Node.js 20 / TypeScript 5.5 / Express |
| Database | MongoDB Atlas (Mongoose 8) |
| Package manager | npm workspaces |
| CI/CD | GitHub Actions |
| Frontend hosting | Vercel |
| Relayer hosting | Render |

---

## 10. Installation

### Prerequisites

```bash
rustup target add wasm32v1-none
cargo install --locked stellar-cli --features opt
# Node.js 20+, MongoDB Atlas URI
```

### Clone + Install

```bash
git clone https://github.com/anindha-biswas/aether.git
cd aether
npm install   # installs all workspaces
```

### Build Contracts

```bash
cd contracts
make build      # cargo build --target wasm32v1-none --release (5 contracts)
make optimize   # stellar contract optimize
```

### Run Development

```bash
# Terminal 1 — relayer
cp relayer/.env.example relayer/.env   # fill in MongoDB + keys + contract addresses
BATCH_INTERVAL_SECONDS=10 npm run dev:relayer

# Terminal 2 — frontend
cp frontend/.env.example frontend/.env.local   # fill in contract addresses
npm run dev:frontend
# → http://localhost:3000
```

---

## 11. Environment Variables

### `relayer/.env`

```env
PORT=3001
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/darkpool
RELAYER_SECRET_KEY=S...            # dedicated relayer key — NOT the admin key
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
BATCH_INTERVAL_SECONDS=60
CIRCUITS_DIR=/absolute/path/to/aether/circuits/build
ORDER_BOOK_ADDRESS=CBHSOI5QFEG6WVNVGXMIOI4AVL2HWD6O6IQ5YA245HYDW25NBERSNAKP
MATCHING_ENGINE_ADDRESS=CALBAJWC3EFVESRV3NABF6ULYTJ5SMSVTLTRFPIQPX7H2MBBLHAUXNDH
SETTLEMENT_ADDRESS=CBMIPVZCCT67UOEMXLFOY4A2EWGECGU74WJQ2COGXQIPW5RS4KEECTO4
ESCROW_VAULT_ADDRESS=CCQIBBTXXLZQMYUUXINOCCLSI7JY535JWBEG23SUR3YEPL34BJ6O5EJR
ZK_VERIFIER_ADDRESS=CCACFEJDSARJFCKNI2FLTKSAG3UW4NMQIBJKMRAHKVAN5SYI4AV2YDHG
```

### `frontend/.env.local`

```env
NEXT_PUBLIC_RELAYER_URL=http://localhost:3001
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org
NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=CCACFEJDSARJFCKNI2FLTKSAG3UW4NMQIBJKMRAHKVAN5SYI4AV2YDHG
NEXT_PUBLIC_ORDER_BOOK_ADDRESS=CBHSOI5QFEG6WVNVGXMIOI4AVL2HWD6O6IQ5YA245HYDW25NBERSNAKP
NEXT_PUBLIC_ESCROW_VAULT_ADDRESS=CCQIBBTXXLZQMYUUXINOCCLSI7JY535JWBEG23SUR3YEPL34BJ6O5EJR
NEXT_PUBLIC_MATCHING_ENGINE_ADDRESS=CALBAJWC3EFVESRV3NABF6ULYTJ5SMSVTLTRFPIQPX7H2MBBLHAUXNDH
NEXT_PUBLIC_SETTLEMENT_ADDRESS=CBMIPVZCCT67UOEMXLFOY4A2EWGECGU74WJQ2COGXQIPW5RS4KEECTO4
NEXT_PUBLIC_XLM_TOKEN_ADDRESS=native
NEXT_PUBLIC_USDC_TOKEN_ADDRESS=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA
```

### GitHub Secrets (CD)

| Secret | Value |
|---|---|
| `STELLAR_SECRET_KEY` | Deployer admin secret |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_ORDER_BOOK_ADDRESS` | `CBHSOI5Q...` |
| `NEXT_PUBLIC_ZK_VERIFIER_ADDRESS` | `CCACFEJD...` |
| `NEXT_PUBLIC_ESCROW_VAULT_ADDRESS` | `CCQIBBTZ...` |
| `NEXT_PUBLIC_MATCHING_ENGINE_ADDRESS` | `CALBAJWC...` |
| `NEXT_PUBLIC_SETTLEMENT_ADDRESS` | `CBMIPVZC...` |
| `NEXT_PUBLIC_USDC_TOKEN_ADDRESS` | `CBIELTK6...` |
| `NEXT_PUBLIC_RELAYER_URL` | Production relayer URL |
| `VERCEL_TOKEN` | Vercel deployment token |
| `VERCEL_ORG_ID` | Vercel org ID |
| `VERCEL_PROJECT_ID` | Vercel project ID |

---

## 12. Smart Contract Deployment Guide

### Prerequisites

```bash
# Fund deployer and dedicated relayer accounts
stellar keys generate deployer --network testnet
stellar keys generate darkpool-relayer --network testnet
stellar keys fund deployer --network testnet
stellar keys fund darkpool-relayer --network testnet
```

> **Critical:** Relayer key and admin/trader key MUST be different accounts. Sharing one key causes `txBadSeq` — the relayer's 60s batch broadcast and trader's order submission collide on the account sequence number.

### Build + Optimize

```bash
cd contracts
make build     # cargo build --target wasm32v1-none --release
make optimize  # stellar contract optimize (produces .optimized.wasm)
```

### Deploy

```bash
export STELLAR_SECRET_KEY=$(stellar keys show deployer --show-secret)

ZK=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/zk_verifier.optimized.wasm \
  --source "$STELLAR_SECRET_KEY" --network testnet)

EV=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/escrow_vault.optimized.wasm \
  --source "$STELLAR_SECRET_KEY" --network testnet)

OB=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/order_book.optimized.wasm \
  --source "$STELLAR_SECRET_KEY" --network testnet)

ST=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/settlement.optimized.wasm \
  --source "$STELLAR_SECRET_KEY" --network testnet)

ME=$(stellar contract deploy \
  --wasm target/wasm32v1-none/release/matching_engine.optimized.wasm \
  --source "$STELLAR_SECRET_KEY" --network testnet)
```

### Initialize

```bash
# Export real VKs (hex-encoded, G2 imaginary-first swap applied)
node circuits/scripts/export_soroban_vk.js

# Initialize all contracts (sets VKs, links contract addresses)
bash contracts/scripts/initialize.sh
```

### Gotchas

| Issue | Fix |
|---|---|
| `.optimized.wasm` is stale | `stellar contract optimize` after every `cargo build` — it does NOT auto-rebuild |
| VK arg parse fails | CLI expects **hex**, not base64 |
| `rpc-url is used but network passphrase is missing` | Pass `--network-passphrase "..."` explicitly |
| USDC deposit simulation fails | `node scripts/fund_usdc.js` — adds trustline + funds from mm1 |
| `txBadSeq` | Relayer key ≠ trader key |

---

## 13. Testing

### Test Summary

| Suite | Runner | Count | Status |
|---|---|---|---|
| ZKVerifier contract | `cargo test` | 7 | ✅ 7/7 |
| EscrowVault contract | `cargo test` | 4 | ✅ 4/4 |
| Relayer matcher | Jest | 12 | ✅ 12/12 |
| Frontend utilities | Jest | 13 | ✅ 13/13 |
| Full E2E (on-chain) | Node | 33 | ✅ 33/33 |

### Run Contract Tests

```bash
cd contracts && cargo test
```

```
running 7 tests
test tests::test_real_proof_verifies            ... ok
test tests::test_tampered_signal_rejected       ... ok
test tests::test_wrong_proof_rejected           ... ok
test tests::test_signal_count_mismatch_rejected ... ok
test tests::test_real_match_proof_verifies      ... ok
test tests::test_match_tampered_price_rejected  ... ok
test tests::test_double_initialize_rejected     ... ok

test result: ok. 7 passed; 0 failed
```

### Run Relayer Tests

```bash
cd relayer && npm test
```

```
PASS src/services/matcher.test.ts
  cmpBigInt
    ✓ is precision-proof beyond 2^53
  computeClearingPrice
    ✓ returns null when the book does not cross
    ✓ returns null with an empty side
    ✓ uses midpoint of the max-volume price range for a simple cross
    ✓ maximizes executed volume
  findMatches
    ✓ matches a simple cross in full at the clearing price
    ✓ returns no matches when the book does not cross
    ✓ partially fills — does NOT rest it (single-settlement)
    ✓ ignores fully-filled orders
    ✓ applies time priority at equal prices
    ✓ settles every pair at ONE uniform clearing price
    ✓ sorts correctly with prices beyond Number precision

Tests: 12 passed, 12 total
```

### Run Frontend Tests

```bash
cd frontend && npm test
```

```
PASS src/__tests__/format.test.ts
  formatPrice
    ✓ converts micro-USDC bigint to 6-decimal string
    ✓ accepts number and string inputs
  formatXlm
    ✓ converts stroops bigint to XLM display
    ✓ handles zero
  formatUsdc
    ✓ converts Stellar USDC units to display with 2dp
  shortAddress
    ✓ abbreviates a full Stellar address
    ✓ returns short inputs unchanged
  shortHash
    ✓ abbreviates a long commitment hash
    ✓ returns short hashes unchanged
  statusColor
    ✓ returns a non-empty class string for known statuses
    ✓ returns the fallback class for unknown status
  relativeTime
    ✓ returns "just now" for very recent timestamps
    ✓ returns minutes-ago string for timestamps under 1 hour

Tests: 13 passed, 13 total
```

### Full E2E (On-Chain)

```bash
# Terminal 1 — relayer (fast batches)
cd relayer && BATCH_INTERVAL_SECONDS=10 npx ts-node src/index.ts

# Terminal 2 — e2e (real BUY + SELL → settlement)
ORDER_BOOK_ADDRESS=CBHSOI5QFEG6WVNVGXMIOI4AVL2HWD6O6IQ5YA245HYDW25NBERSNAKP \
  BATCH_POLL_TIMEOUT_SECONDS=90 node scripts/e2e_test.js
# → 33 passing, 0 failing
```

---

## 14. CI/CD Pipeline

### CI (`.github/workflows/ci.yml`) — every push + PR

```yaml
jobs:
  contracts:        # cargo test + cargo build wasm32v1-none + clippy + fmt
  frontend:         # npm ci → lint → jest:ci → next build
  relayer:          # npm ci → jest → tsc
```

#### Contracts Job

```yaml
- uses: dtolnay/rust-toolchain@stable
  with:
    targets: wasm32v1-none
    components: clippy, rustfmt
- run: cargo test --workspace
- run: cargo build --target wasm32v1-none --release --workspace
- run: cargo clippy --workspace -- -D warnings
- run: cargo fmt --all -- --check
```

#### Frontend Job

```yaml
- run: npm ci                          # install all workspaces
- run: npm run lint                    # next lint
  working-directory: frontend
- run: npm run test:ci                 # jest --ci (13 tests)
  working-directory: frontend
- run: npm run build                   # next build
  working-directory: frontend
```

#### Relayer Job

```yaml
- run: npm ci
- run: npm test                        # jest (12 tests)
  working-directory: relayer
- run: npm run build                   # tsc
  working-directory: relayer
```

### CD (`.github/workflows/deploy.yml`) — push to `main` only

```yaml
jobs:
  deploy-contract:
    - cargo build --target wasm32v1-none --release
    - cargo install stellar-cli --features opt
    - stellar contract optimize (each WASM)
    - stellar contract deploy ... (5 contracts, env: STELLAR_SECRET_KEY)

  deploy-frontend:
    needs: [deploy-contract]
    - npm ci
    - npm run build (env vars from GitHub Secrets)
    - npx vercel --prod --token $VERCEL_TOKEN --yes
```

---

## 15. Event Streaming Architecture

### On-Chain Events

| Contract | Topic | Data | When |
|---|---|---|---|
| Settlement | `Symbol("settle")` | `(xlm_amount, usdc_amount)` | Every matched pair |
| EscrowVault | `Symbol("deposit")` | `(nullifier, amount)` | Order submitted |
| OrderBook | `Symbol("order")` | `(commitment, batch_id)` | Order accepted |

### Frontend Polling

```typescript
// Batch countdown — every 5s
useQuery({ queryKey: ['batch'], refetchInterval: 5000 })

// Order status — every 3s until settled
useQuery({
  queryKey: ['order', commitment],
  refetchInterval: (data) => data?.status === 'settled' ? false : 3000,
})

// Trade feed — every 10s
useQuery({ queryKey: ['trades'], refetchInterval: 10000 })
```

### Settlement Event Subscription

```typescript
const events = await server.getEvents({
  filters: [{
    type: 'contract',
    contractIds: [SETTLEMENT_ADDRESS],
    topics: [['AAAADwAAAAZzZXR0bGU=']]  // Symbol("settle") XDR base64
  }],
  startLedger: lastSeenLedger,
});
```

---

## 16. Security Model

### What Is Proven On-Chain

| Claim | Circuit | On-Chain Check |
|---|---|---|
| Order is well-formed | `order_commitment` | `verify_order_proof` |
| Trader has sufficient funds | `balance_proof` | `verify_balance_proof` |
| Price is within protocol range | `range_proof` | `verify_range_proof` |
| Match arithmetic is correct | `match_proof` | `verify_match_proof` |
| Proof is for THIS order (anti-replay) | Public signal binding | `signals[1] == commitment` |
| Relayer didn't fake the fill size | Public signal binding | `signals[3/4] == amounts` |

### What the Relayer Cannot Do

- Forge a proof for an invalid match
- Lie about the clearing price (bound to proof public signals)
- Lie about fill amounts (bound to proof public signals)
- Front-run orders (prices never revealed until after escrow lock)
- Double-settle (EscrowVault marks deposits `Settled` atomically)

### Known Limitations (v1)

- Single relayer — trust for liveness (no 2-of-3 threshold yet)
- No resting partial fills — v1 escrow is all-or-nothing (unfilled portion refunded)
- Clearing price is locally valid (crossing) but not globally volume-maximizing provably

---

## 17. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `txBadSeq` on order submit | Relayer key = trader key | Use dedicated `darkpool-relayer` key |
| USDC deposit simulation fails | No USDC trustline/balance | `node scripts/fund_usdc.js` |
| `.optimized.wasm` stale / wrong size | `cargo build` doesn't update it | Run `stellar contract optimize` after every build |
| `rpc-url used but no passphrase` | Testnet alias missing passphrase | Pass `--network-passphrase "Test SDF Network ; September 2015"` |
| Relayer circuit not found | Relative `CIRCUITS_DIR` | Set absolute path in `relayer/.env` |
| `Bad union switch: 4` | Old `fromXDR` call in relayer | Pass `{ toXDR: () => signedXdr }` directly |
| Orders stuck `active` | Old partial-fill bug | Clear `orders`+`matches` collections; relayer fix is in `matcher.ts` |
| Frontend 500 after tailwind change | Dev server cache | Restart dev server |

---

## 18. Screenshots

### Trading Terminal — Desktop

> Full-bleed terminal at `/trade` — TickerBar / TradingChart / TradePanel / OrdersStrip

<img width="2880" height="1567" alt="Screenshot from 2026-07-02 22-23-07" src="https://github.com/user-attachments/assets/63a92713-c901-460f-a4e3-f49886df1c51" />


### Mobile Responsive UI

> Stacked single-column layout — all panels accessible via scroll

<div align="center">
  <img 
    width="280" 
    alt="Screenshot from 2026-07-07 18-31-25" 
    src="https://github.com/user-attachments/assets/636295b2-15dc-495c-89ea-849ebac3c041" 
  />
</div>


### CI/CD Pipeline Running

> GitHub Actions — contracts + frontend + relayer jobs all green
> 
<img width="2857" height="1116" alt="image" src="https://github.com/user-attachments/assets/51aba39f-e4ea-46f1-bfdf-399a3824866f" />

---

## 19. Git History

Minimum 10 meaningful commits with logical development progression:

| # | Commit Message | Description |
|---|---|---|
| 1 | `chore: init npm workspace — circuits, sdk, relayer, frontend` | Project scaffold |
| 2 | `feat(circuits): order_commitment, balance_proof, range_proof circom circuits` | ZK circuit definitions + trusted setup |
| 3 | `feat(contracts): ZKVerifier with real BN254 Groth16 pairing` | groth16.rs, test vectors, 7 passing tests |
| 4 | `feat(contracts): EscrowVault, OrderBook, Settlement, MatchingEngine` | Four contracts; ZK-gated submit_order |
| 5 | `feat(sdk): Soroban tx builder + client-side proof SDK` | g2ToBytes imaginary-first encoding |
| 6 | `feat(relayer): batch auction service + uniform clearing price matcher` | matcher.ts, batchAuction.ts, 12 unit tests |
| 7 | `feat(frontend): trade terminal — TradingChart, TradePanel, OrdersStrip` | Next.js 15, lightweight-charts v5.2 |
| 8 | `fix: dedicate relayer key to eliminate txBadSeq collisions` | Separate darkpool-relayer account |
| 9 | `fix(escrow): release exact cleared amount, refund surplus atomically` | Bug A fix; redeployed all contracts |
| 10 | `feat(zk): match_proof circuit + trustless on-chain matching` | match_proof.circom, VkMatch, submit_match proof binding |
| 11 | `fix(matcher): single-settlement invariant — consume both orders per match` | Bug C fix; partial-fill stuck orders resolved |
| 12 | `feat(frontend): add lib/stellar-sdk.ts and lib/contract.ts integration` | callContractFunction, readCurrentBatch |
| 13 | `test(frontend): 13 Jest unit tests for format utilities` | jest.config.js, format.test.ts |
| 14 | `ci: GitHub Actions CI (contracts + frontend + relayer) and CD (Vercel)` | ci.yml, deploy.yml, contracts/Makefile |
| 15 | `docs: complete project README, contracts/README.md, TRADER_GUIDE.md` | Full documentation |

---

## 20. User Feedback Implementation

Each row maps a specific issue found while actually using the trade terminal to the fix shipped for it.

| # | User Feedback | Implementation | Commit |
|---|---|---|---|
| 1 | Order book depth and recent trades panels render as an empty state when the relayer is slow to wake up or a CORS request fails — visually indistinguishable from "no liquidity yet." Traders can't tell a dead connection from a quiet market. | Added a distinct `ErrorFiller` state to both the `OrderBookTab` and `RecentTradesTab` in `MarketPanel.tsx`, with a retry action, instead of silently collapsing to the same empty-state UI used for zero liquidity. | [`65756ce`](https://github.com/anindhabiswas25/aether/commit/65756ce6172f9af1ba26bceebab1632713279cc8) |
| 2 | Order History in the trade page footer goes blank on a page refresh, even right after an order has fully settled — it only reflects the current session's in-memory state, not what actually happened on-chain. | Rewired `OrdersStrip` to read from `useTraderOrders` + `mergeOrders` — the same durable, wallet-scoped relayer data source the Portfolio page already used — instead of the resettable Zustand store. | [`5bfbecc`](https://github.com/anindhabiswas25/aether/commit/5bfbecc703c89e83c1587b1fd23f4b3f6dc95911) |
| 3 | The trade page is unusable on a phone — order book, chart, and order entry panel are all crammed into the desktop three-column layout and require pinch-zooming to tap anything. | Added `MobileTradeView`, `MobileCard`, `OrderList`, and a `useIsMobile` hook; reworked the trade, orders, portfolio pages plus the header/layout to render a proper stacked mobile layout below the breakpoint. | [`879a04f`](https://github.com/anindhabiswas25/aether/commit/879a04f308ed381286ae58414e42492120bab713) |
| 4 | With several tabs open, the Aether tab is impossible to pick out — it's still the default Next.js icon and a long generic title. | Replaced the favicon with a tightly-cropped Aether glyph on a transparent background and shortened the browser tab title to "Aether." | [`8418b82`](https://github.com/anindhabiswas25/aether/commit/8418b82bdd6082e858ba42f6a8591aa8b892e165) |
| 5 | Portfolio page shows "0 USDC (no trustline)" for a wallet that actually holds real USDC — balance lookup is grabbing the wrong trustline. | Root cause: Horizon returns every trustline sharing the asset code `"USDC"` regardless of issuer, and the balance lookup matched on `asset_code` alone via `.find()`, silently picking up an unrelated zero-balance trustline instead of the real Circle testnet USDC. Both the portfolio page and `TradePanel` now also check `asset_issuer` against a canonical `USDC_ISSUER` constant. | [`c2d8736`](https://github.com/anindhabiswas25/aether/commit/c2d8736361869b93fdf2986f5044fbb1b9c93028) |
| 6 | Wallet balance is visible in the app, but there's no way to actually send XLM anywhere without leaving Aether and using Freighter's own extension popup directly. | Added `lib/stellarWallet.ts` (Freighter detect/connect/sign) and `lib/stellarHorizon.ts` (build/submit native payment tx), exposed as `useWallet().sendXlm()` with loading/success/error state, and a `SendXlmForm` with a tx-hash success banner linking to stellar.expert. | [`8716157`](https://github.com/anindhabiswas25/aether/commit/871615749be38758de5b1e5bc35a5acf081ea912) |

---

## License

MIT © 2026 Aether / Anindha Biswas

---

<div align="center">
  <sub>Built on Stellar Soroban · Proven by BN254 Groth16 · 0 front-runs guaranteed</sub>
</div>
