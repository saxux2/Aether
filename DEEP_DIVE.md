# Aether ZK Dark Pool — Complete Deep Dive
## Everything You Need to Understand This System, In Plain Language

---

## Table of Contents

1. [What Is This System? The One-Paragraph Summary](#1-what-is-this-system)
2. [The Big Picture — How All Pieces Connect](#2-the-big-picture)
3. [What Is a ZK Proof? (No Math Required)](#3-what-is-a-zk-proof)
4. [The Three ZK Circuits — What Each One Proves](#4-the-three-zk-circuits)
5. [How ZK Proofs Are Generated — Step by Step](#5-how-zk-proofs-are-generated)
6. [Why packages/sdk Exists — Do Users Need It?](#6-why-packagessdk-exists)
7. [Why the Relayer Exists — What It Does](#7-why-the-relayer-exists)
8. [The ZK Order Book — Where Does It Live?](#8-the-zk-order-book)
9. [Full Frontend Flow — What Happens When You Click Submit](#9-full-frontend-flow)
10. [Order Matching — Every Possible Situation With Examples](#10-order-matching)
11. [Full End-to-End Testing Guide](#11-full-end-to-end-testing-guide)
12. [What Is Public vs What Is Hidden](#12-what-is-public-vs-hidden)
13. [Glossary of Terms](#13-glossary)

---

## 1. What Is This System?

Aether is a **trading exchange for XLM and USDC** (Stellar's native coins) where your trade orders are **completely invisible** to everyone — including the exchange itself — until they are matched and settled.

Think of it like going to a stock exchange where you write your offer on a piece of paper, seal it in an envelope, and hand it in. Nobody opens any envelope until the auction ends. At auction time, envelopes are matched, and the trades happen. Nobody outside the matched pair ever sees what price or quantity you wrote.

This is the opposite of every public DEX (like Uniswap) where your order is immediately visible to every bot, trader, and front-runner the moment you submit it.

**The technical secret that makes this possible:** Zero-Knowledge (ZK) cryptographic proofs.

---

## 2. The Big Picture

Here is every component and how they talk to each other:

```
YOUR BROWSER
│
│  You type: "Buy 500,000 XLM at $0.14"
│
│  [ZK Proof Engine - runs inside your browser as WASM code]
│    - Takes your price, quantity, direction as SECRET inputs
│    - Produces: a COMMITMENT (like a sealed envelope ID)
│                 three PROOFS (mathematical certificates)
│                 a NULLIFIER (unique anti-reuse token)
│
│  Your private data NEVER leaves your browser.
│
│  What leaves your browser: commitment + proofs + nullifier (no secrets)
│
▼
RELAYER (Backend Server - Node.js)
│
│  - Receives commitment + proofs from your browser
│  - Pre-checks the proofs are mathematically valid (fast rejection)
│  - Broadcasts your signed Soroban transaction to Stellar
│  - Stores your order with the REVEALED price (v1 trust assumption)
│  - Runs a 60-second timer (batch auction)
│  - At 60s: finds which buy/sell pairs have crossing prices
│  - Sends matched pairs to the smart contract for settlement
│
▼
SOROBAN SMART CONTRACTS (On-chain, Stellar blockchain)
│
│  [ZKVerifier contract]
│    - Validates each of the three proofs mathematically
│    - Rejects any order where proofs don't check out
│
│  [EscrowVault contract]
│    - Locks your actual USDC or XLM when you submit an order
│    - No one can touch these funds until the contract says so
│    - Only the Settlement contract can release them
│
│  [OrderBook contract]
│    - Stores the commitment hashes of all active orders
│    - Stores NO prices, NO quantities, NO directions — just hashes
│
│  [MatchingEngine contract]
│    - Receives the matched pair from the relayer
│    - Re-verifies that the revealed prices actually hash to the commitments
│    - Verifies buyer price >= seller price (prices cross)
│    - Calls Settlement to release funds
│
│  [Settlement contract]
│    - Atomically: releases buyer's USDC to seller, seller's XLM to buyer
│    - Both transfers happen in the same transaction (atomic = all or nothing)
│
▼
STELLAR LEDGER (Public blockchain)
│
│  Records ONLY:
│    "EscrowVault sent 69,500 USDC to Address B"
│    "EscrowVault sent 500,000 XLM to Address A"
│
│  Does NOT record: price, order size, who placed which order, strategy
```

---

## 3. What Is a ZK Proof?

### The Simple Explanation

Imagine you have a locked safe. Inside it is a number. You want to prove to me that the number inside is greater than 100, **without ever opening the safe or telling me what the number is**.

A Zero-Knowledge proof lets you do exactly this. You can prove a **statement is true** without revealing the **data that makes it true**.

### In This System

A ZK proof lets a trader prove:

- "My order commitment is the correct hash of my real price, quantity, direction, and salt" (without revealing the price, quantity, direction, or salt)
- "I have enough funds in escrow to cover this order" (without revealing my balance or identity)
- "My price is within the acceptable range of $0.001 to $10.00" (without revealing the actual price)

The blockchain only ever sees:
- The commitment hash (like the envelope ID)
- The proof (like a certificate saying "the contents are valid")
- The nullifier (like a receipt number to prevent re-use)

### What Is Groth16?

Groth16 is the specific ZK proof system this project uses. It was invented in 2016 and is used by Zcash (the privacy cryptocurrency). It produces proofs that are:
- Only 192 bytes small (fits in a tweet)
- Very cheap to verify on-chain
- Mathematically proven secure

### What Is Poseidon Hash?

A regular hash function (like SHA256) takes data and produces a fingerprint. Poseidon is a special hash function designed specifically to work efficiently inside ZK circuits. It works in the same mathematical "space" that ZK proofs use, making it much cheaper (fewer constraints) than SHA256 inside a circuit.

In this project: `commitment = Poseidon(price, quantity, direction, salt)`

---

## 4. The Three ZK Circuits

A "circuit" is the definition of what gets proven. Think of it as a mathematical rulebook. The prover follows the rulebook with their private data and produces a certificate. The verifier checks the certificate against the rulebook without seeing the private data.

### Circuit 1: OrderCommitment

**What it proves:** "I computed the commitment hash correctly from my real order parameters."

**Secret inputs (only you know):**
- `price` — your limit price in micro-USDC (e.g., 140000 = $0.14)
- `quantity` — XLM amount in stroops (e.g., 5000000000000 = 500,000 XLM)
- `direction` — 0 for buy, 1 for sell
- `salt` — a random 32-byte number you generated (prevents anyone from guessing your order by brute force)

**Public inputs (everyone can see):**
- `commitment` — the Poseidon hash of the four inputs above

**What the circuit enforces:**
1. `commitment` must equal `Poseidon(price, quantity, direction, salt)` — you can't lie about what's in your envelope
2. `direction` must be exactly 0 or 1 — no invalid directions
3. `price` must be greater than 0 — no free orders
4. `quantity` must be greater than 0 — no empty orders

**Analogy:** The circuit is like a notary that checks the sealed envelope matches a specific hash without opening it.

---

### Circuit 2: BalanceProof

**What it proves:** "I have enough funds in escrow to cover this order, and this order is unique."

**Secret inputs (only you know):**
- `secret` — your private secret (derived deterministically from your wallet address)
- `balance` — your actual escrow balance in stroops
- `quantity` — the XLM quantity you're ordering
- `nonce` — a unique number for this specific order (prevents reusing the same proof)

**Public inputs (everyone can see):**
- `nullifier` — `Poseidon(secret, nonce)` — a unique fingerprint per order
- `minimum_balance` — the quantity being committed (the public floor)

**What the circuit enforces:**
1. `nullifier` must equal `Poseidon(secret, nonce)` — you computed it honestly
2. `balance >= quantity` — you can't order more than you have
3. `quantity == minimum_balance` — the public amount matches your private quantity

**Why the nullifier matters:** If you submit the same order twice, both would produce the same nullifier (same secret, same nonce). The contract rejects any order whose nullifier already exists. This prevents double-spending — you can't lock the same funds twice.

**Analogy:** The nullifier is like a check number. Once a check with number 1001 is cashed, another check with number 1001 will bounce.

---

### Circuit 3: RangeProof

**What it proves:** "My hidden price is within the protocol's acceptable range, without revealing the price."

**Secret inputs (only you know):**
- `price` — your actual limit price
- `price_salt` — a salt for the price commitment

**Public inputs (everyone can see):**
- `price_min` — 1,000 micro-USDC ($0.001 minimum)
- `price_max` — 10,000,000 micro-USDC ($10.00 maximum)
- `price_commitment` — `Poseidon(price, price_salt)`

**What the circuit enforces:**
1. `price >= price_min` — no absurdly low prices
2. `price <= price_max` — no absurdly high prices
3. `price_commitment == Poseidon(price, price_salt)` — the commitment is honest

**Why this matters:** Without this proof, someone could submit an order at $0.000001 and disrupt the system. The range proof guarantees the price is reasonable without revealing it.

---

## 5. How ZK Proofs Are Generated

### Where Does Generation Happen?

**Inside your browser.** Not on any server. Not on the blockchain.

The ZK circuits are compiled to **WebAssembly (WASM)** — a binary format that runs at near-native speed inside a browser. When you submit an order, the browser downloads these WASM files (once, then cached) and runs the proof generation locally.

Your private data (price, quantity, salt, secret) **never leaves your computer.** Only the output (commitment, proofs, nullifier) is sent over the network.

### The Step-by-Step Generation Process

When you click "Submit sealed buy order" in the UI:

**Step 1 — Convert to internal units**
```
You typed: "500000 XLM at $0.14"
Converted to:
  quantity_stroops = 500000 × 10,000,000 = 5,000,000,000,000
  price_micro_usdc = 0.14 × 1,000,000   = 140,000
  direction        = 0 (buy)
```
These are exact integers — no floating point, no rounding errors.

**Step 2 — Generate random values**
```
salt  = crypto.getRandomValues(32 bytes) → a random bigint
nonce = Date.now() → current timestamp as bigint
```
The salt prevents anyone from brute-forcing your order by hashing all possible price/quantity combinations. The nonce makes your nullifier unique to this specific order.

**Step 3 — Derive your secret**
```
secret = SHA256("zk-dark-pool-secret-v1:" + your_wallet_address)
```
This is deterministic — the same wallet always produces the same secret. This means you don't need to store the secret; you can always re-derive it from your wallet. The secret is used to compute your nullifier.

**Step 4 — Compute commitments locally**
```
commitment       = Poseidon(price, quantity, direction, salt)
nullifier        = Poseidon(secret, nonce)
price_salt       = salt XOR price
price_commitment = Poseidon(price, price_salt)
```
These are just math — no network calls yet.

**Step 5 — Run Circuit 1: OrderCommitment proof (~2 seconds)**

The browser calls `snarkjs.groth16.fullProve()` with:
- Private inputs: price, quantity, direction, salt
- Public inputs: commitment
- The WASM file (the compiled circuit)
- The `.zkey` file (the trusted setup parameters)

Output: a Groth16 proof object (~192 bytes of math) + public signals

**Step 6 — Run Circuit 2: BalanceProof (~2 seconds)**

The browser calls `snarkjs.groth16.fullProve()` with:
- Private inputs: secret, balance, quantity, nonce
- Public inputs: nullifier, minimum_balance

Output: another Groth16 proof object

**Step 7 — Run Circuit 3: RangeProof (~1 second)**

The browser calls `snarkjs.groth16.fullProve()` with:
- Private inputs: price, price_salt
- Public inputs: price_min, price_max, price_commitment

Output: a third Groth16 proof object

**Step 8 — Build the Soroban transaction**

Now the browser has: commitment, nullifier, three proofs, three public signal sets.

It builds a Stellar transaction that calls `OrderBook.submit_order()` with all this data. This transaction also includes the USDC/XLM transfer (to lock funds in escrow).

**Step 9 — Sign with Freighter**

The Freighter browser wallet (like MetaMask for Stellar) shows you the transaction. You approve it. Your private key signs it. The signed XDR (transaction bytes) is ready.

**Step 10 — Send to relayer**

```
POST /api/orders/submit
{
  signed_transaction_xdr: "...",
  commitment: "0xabc...",
  nullifier: "0xdef...",
  revealed_price: "140000",   ← relayer sees this (v1 trust assumption)
  order_proof: {...},
  balance_proof: {...},
  range_proof: {...},
  ...
}
```

---

## 6. Why packages/sdk Exists

### What Is packages/sdk?

`packages/sdk` is a TypeScript library that lives at `packages/sdk/src/`. It contains all the proof-generation logic, type definitions, and helper functions needed to interact with the Aether system.

Key files:
- `packages/sdk/src/prover.ts` — the `generateOrderProofs()` function
- `packages/sdk/src/commitment.ts` — commitment and nullifier computation
- `packages/sdk/src/relayer.ts` — functions to submit orders to the relayer API
- `packages/sdk/src/soroban.ts` — functions to build Soroban transactions
- `packages/sdk/src/types.ts` — TypeScript type definitions

### Why Is It Separate From the Frontend?

The SDK is a **shared library**. The frontend imports from it:
```typescript
import { generateOrderProofs, OrderInputs } from '@zk-dark-pool/sdk';
```

This separation exists because:

1. **Reusability** — If someone wants to build a bot, a CLI tool, or a mobile app that trades on Aether, they can import the SDK directly instead of copy-pasting proof generation code.

2. **Testability** — The SDK can be unit-tested independently. You can test `generateOrderProofs()` without running the full frontend.

3. **Versioning** — The SDK can be published to npm with a version number. API integrators can pin to a specific version.

4. **Separation of concerns** — The frontend deals with UI (buttons, forms, status). The SDK deals with cryptography and protocol logic. These are different concerns and should live separately.

### Do Regular Users Need to Use the SDK Directly?

**No. Regular users never touch the SDK.**

Regular users interact only with the React frontend in their browser. They click buttons, fill forms, approve transactions in Freighter. The frontend uses the SDK internally — the user never sees it.

The SDK is for **developers** who want to:
- Build trading bots
- Integrate Aether into another application
- Write automated test scripts
- Build a CLI trading tool

**Example: A regular user's perspective**
```
User: Opens browser → Goes to aether.app → Connects Freighter wallet
      → Fills "Buy 1000 XLM at $0.14" → Clicks Submit
      → Sees "Generating proofs..." for 5 seconds
      → Approves in Freighter → Done
```
They never see the SDK. The frontend handles everything.

**Example: A developer's perspective**
```typescript
// A trading bot developer might write:
import { generateOrderProofs } from '@zk-dark-pool/sdk';

const proofs = await generateOrderProofs({
  price: 140000n,
  quantity: 10000000n,
  direction: 0n,
  salt: randomBigInt(),
  secret: mySecret,
  nonce: BigInt(Date.now()),
  balance: myBalance,
});
// Then submit via the relayer API
```

---

## 7. Why the Relayer Exists

### What Is the Relayer?

The relayer is a Node.js server (`relayer/src/`) that sits between your browser and the Stellar blockchain. It does several things that cannot be done on-chain or in the browser efficiently.

### Why Can't the Frontend Just Talk to Stellar Directly?

For some things it can (and does — the signed transaction is broadcast to Stellar). But several critical functions require an off-chain server:

**Reason 1: Order Book Storage**

The Soroban chain only stores commitment hashes — it doesn't know prices. To run a matching engine, someone needs to know prices. In v1, the relayer stores the `revealed_price` in PostgreSQL alongside each commitment. This is a **trust assumption** explicitly noted in the architecture — the relayer can see prices but cannot move funds (only the smart contracts can).

The relayer is trusted to:
- Store prices honestly
- Run the matching algorithm honestly
- Submit matches to the chain honestly

The relayer is NOT trusted to:
- Move funds (it can't — EscrowVault only accepts calls from Settlement)
- Forge ZK proofs (mathematically impossible)
- Fake a match (MatchingEngine re-verifies commitments on-chain)

**Reason 2: Batch Auction Orchestration**

Every 60 seconds, the relayer:
1. Closes the current batch
2. Fetches all active orders
3. Runs the matching algorithm
4. Submits each matched pair to the MatchingEngine contract

This cannot happen on-chain because Soroban contracts are reactive (they respond to transactions) — they don't run scheduled jobs. Something off-chain must trigger the batch.

**Reason 3: Pre-verification (Gas Savings)**

Before broadcasting a transaction to Stellar (which costs fees), the relayer runs `snarkjs.groth16.verify()` server-side. If the proof is invalid, the relayer rejects it immediately without spending any gas. This protects the relayer's signing account from wasted fees.

**Reason 4: Transaction Broadcasting**

The signed transaction XDR arrives from the browser. The relayer broadcasts it to the Stellar RPC endpoint and polls for confirmation. This keeps the browser light and handles retries gracefully.

**Reason 5: Anonymized Market Data**

The relayer's `/api/orderbook/depth` endpoint returns aggregated price buckets — not individual orders. This lets the frontend show market depth (like "there are ~500K XLM worth of bids near $0.14") without revealing individual orders.

### What the Relayer CANNOT Do

- Steal funds (EscrowVault.release() only accepts Settlement contract auth)
- Forge a match (MatchingEngine re-computes Poseidon hashes on-chain)
- Submit an invalid ZK proof (ZKVerifier rejects it)
- Prevent you from canceling (you sign the cancel transaction yourself)
- Know which trader placed which order (it knows the commitment hash but not whose wallet it is, unless the trader reveals it — in v1 trader_address is stored for status lookups)

---

## 8. The ZK Order Book

### What Is an "Order Book"?

In traditional trading, an order book is a list of:
- All active buy orders (bids) — sorted from highest to lowest price
- All active sell orders (asks) — sorted from lowest to highest price

When a bid price is >= an ask price, a match happens.

### Is the ZK Order Book on the Frontend or Where?

The order book exists in **three places** simultaneously, each holding different information:

**Location 1: The Soroban OrderBook Contract (on-chain)**
- Stores: `commitment hash → OrderRecord{trader, amount_in, asset_in, status}`
- Does NOT store: price, quantity (hidden), direction (hidden)
- This is the authoritative, tamper-proof record
- Anyone can query it but they only see hashes and statuses

**Location 2: The Relayer's PostgreSQL Database (off-chain)**
- Stores: commitment, nullifier, trader address, asset_in, amount_in, **revealed_price**, batch_id, status
- This is where prices live (the "trust layer" of v1)
- The matching algorithm reads from here
- Access controlled by the relayer

**Location 3: The Frontend's Memory (in-browser)**
- Stores: the orders you submitted in this session (your order IDs, statuses)
- Polls the relayer API every 5 seconds for status updates
- Shows you "your orders" in the Orders page

### How Does the Order Book Stay Private?

Because the on-chain record only stores hashes:
```
OrderRecord {
  commitment: "0x7f3a...",   ← hash of (price, qty, dir, salt)
  trader: "GABCD...",
  amount_in: 70000_0000000,  ← this is public (needed for escrow sizing)
  status: Active
}
```

An observer on Stellar can see:
- That an order exists
- How much total USDC or XLM is locked
- The commitment hash (meaningless without the preimage)
- The order status

An observer cannot see:
- The price (hidden in the hash)
- Whether it's a buy or sell (hidden in the hash)
- The exact XLM quantity (hidden, only USDC deposited amount is visible for buy orders)

---

## 9. Full Frontend Flow

### What Happens When You Open the App

1. **App loads** (`frontend/src/App.tsx`) — sets up React Query, router, layout
2. **Wallet check** (`useWallet.ts`) — checks if Freighter is installed and connected
3. **Dashboard loads** — fetches batch info, recent trades, depth data from relayer

### What Happens When You Connect Your Wallet

1. App calls `getPublicKey()` from `@stellar/freighter-api`
2. Freighter asks you to approve the connection
3. Your Stellar address (like `GABCD...`) is stored in Zustand state
4. App starts showing your balances

### What Happens When You Go to the Trade Page

1. The WASM circuit files are lazily downloaded from `frontend/public/circuits/`
   - `order_commitment.wasm` (~3MB)
   - `order_commitment_final.zkey` (~8MB)
   - `balance_proof.wasm` (~3MB)
   - `balance_proof_final.zkey` (~8MB)
   - `range_proof.wasm` (~3MB)
   - `range_proof_final.zkey` (~8MB)
   
   These are downloaded once and cached by the browser. Subsequent visits are instant.

2. The `BatchCountdown` component starts polling `/api/orderbook/batch` every second, showing the countdown timer.

3. The `OrderBook` component fetches `/api/orderbook/depth` to show the anonymized price depth.

### What Happens When You Fill the Order Form

The `OrderForm` component (`frontend/src/components/OrderForm.tsx`) has:
- Buy/Sell toggle
- Quantity input (XLM)
- Price input (USDC per XLM)
- Total USDC display (auto-calculated)

When you click "Submit sealed buy order":

```
useProver.submitOrder() is called with:
  direction: "buy"
  quantity: "500000"    (XLM, human readable)
  price: "0.14"         (USDC per XLM, human readable)
  expiresInSeconds: 3600
```

The `ProofStatus` component appears, showing each step:

```
Step 1: Deriving cryptographic secret...
  → SHA256("zk-dark-pool-secret-v1:" + GABCD...)
  → Takes ~100ms

Step 2: Generating order commitment proof...
  → snarkjs.groth16.fullProve(order_commitment.wasm, ...)
  → Takes ~2000ms

Step 3: Generating balance proof...
  → snarkjs.groth16.fullProve(balance_proof.wasm, ...)
  → Takes ~2000ms

Step 4: Generating range proof...
  → snarkjs.groth16.fullProve(range_proof.wasm, ...)
  → Takes ~1000ms

Step 5: Building transaction...
  → buildSubmitOrderTransaction() creates Soroban XDR
  → Takes ~200ms

Step 6: Sign in Freighter wallet...
  → Freighter popup appears
  → You click Approve
  → Takes as long as you take

Step 7: Broadcasting to Stellar...
  → POST /api/orders/submit
  → Relayer pre-verifies proofs
  → Relayer broadcasts to Stellar RPC
  → Stellar confirms in ~5 seconds

Step 8: Confirmed!
  → Order ID = commitment hash
  → batch_id = 42
  → estimated_match_at = in ~34 seconds
```

After confirmation, the order appears in your Orders list and the UI polls its status every 5 seconds.

---

## 10. Order Matching

### How the Matching Algorithm Works

Every 60 seconds, the relayer's `BatchAuctionService.runBatchCycle()` runs.

The algorithm is a classic **price-time priority order book matching** with one key difference: it processes sealed orders in batches rather than continuously.

Here is the algorithm in plain English:

1. Fetch all active orders for the just-closed batch
2. Separate buyers (asset_in = USDC) and sellers (asset_in = XLM)
3. Sort buyers by price descending (highest bids first)
4. Sort sellers by price ascending (lowest asks first)
5. Walk through the two sorted lists simultaneously
6. While the best bid price >= best ask price: create a match
7. Settlement price = midpoint of bid and ask

### Situation 1: Perfect Match (Full Fill)

**Setup:**
- Alice submits: Buy 500,000 XLM at $0.140
- Bob submits: Sell 500,000 XLM at $0.138

**Relayer at 60-second mark:**
```
Buyers sorted desc:  [Alice: price=140000, qty=500,000 XLM]
Sellers sorted asc:  [Bob:   price=138000, qty=500,000 XLM]

Step 1: buyer[0].price = 140000 >= seller[0].price = 138000 → CROSS
Step 2: settlement_price = (140000 + 138000) / 2 = 139000 ($0.139)
Step 3: xlm_amount = min(500000, 500000) = 500,000 XLM
Step 4: usdc_amount = 500000 × 139000 / 1,000,000 = 69,500 USDC
Step 5: buyer remaining = 500000 - 500000 = 0 → advance buyer pointer
Step 6: seller remaining = 500000 - 500000 = 0 → advance seller pointer
Step 7: both pointers past end → done
```

**Result:**
- Alice receives: 500,000 XLM (deposited 70,000 USDC, gets back 500 USDC as overpay? No — she deposited exactly `quantity × her_price` = 70,000 USDC. Settlement is at $0.139 so seller gets 69,500 USDC, the 500 USDC difference is... in v1 this is handled by using only the amount needed)
- Bob receives: 69,500 USDC (for his 500,000 XLM)
- Settlement price: $0.139 (midpoint)

---

### Situation 2: No Match (Prices Don't Cross)

**Setup:**
- Alice submits: Buy 500,000 XLM at $0.130
- Bob submits: Sell 500,000 XLM at $0.140

**Relayer at 60-second mark:**
```
Buyers sorted desc:  [Alice: price=130000]
Sellers sorted asc:  [Bob:   price=140000]

Step 1: buyer[0].price = 130000 < seller[0].price = 140000 → NO CROSS
Break out of loop.
```

**Result:**
- No match found for this batch
- Both orders remain Active
- Both orders carry forward to the next batch (unless they expire)
- If the order has `expires_at` set to 1 hour from submission, it will be automatically expired by the relayer after 1 hour and funds returned via `EscrowVault.expire()`

---

### Situation 3: Partial Fill (Buyer Has More Than Seller)

**Setup:**
- Alice submits: Buy 1,000,000 XLM at $0.140
- Bob submits: Sell 300,000 XLM at $0.138

**Relayer at 60-second mark:**
```
Buyers: [Alice: price=140000, qty=1,000,000 XLM]
Sellers: [Bob:  price=138000, qty=300,000 XLM]

Step 1: 140000 >= 138000 → CROSS
settlement_price = 139000
xlm_amount = min(1,000,000, 300,000) = 300,000 XLM (Bob is limiting factor)
usdc_amount = 300000 × 139000 / 1,000,000 = 41,700 USDC

buyer.remaining = 1,000,000 - 300,000 = 700,000 → DON'T advance buyer pointer
seller.remaining = 300,000 - 300,000 = 0 → advance seller pointer

No more sellers → loop ends
```

**Result:**
- Alice gets a partial fill: receives 300,000 XLM, pays 41,700 USDC
- Alice still has 700,000 XLM remaining in her order (still Active)
- Bob gets full fill: receives 41,700 USDC, sends 300,000 XLM

**Important note:** In v1, the EscrowVault locks the full order amount upfront. For partial fills, the architecture requires additional logic to release only the matched portion and keep the remainder locked. This is a known v1 limitation.

---

### Situation 4: One Buyer, Multiple Sellers (Sweeping the Book)

**Setup:**
- Alice submits: Buy 500,000 XLM at $0.145
- Bob submits: Sell 200,000 XLM at $0.138
- Carol submits: Sell 200,000 XLM at $0.140
- Dave submits: Sell 200,000 XLM at $0.143

**Relayer at 60-second mark:**
```
Buyers sorted desc:  [Alice: price=145000, qty=500,000]
Sellers sorted asc:  [Bob:   price=138000, qty=200,000]
                     [Carol: price=140000, qty=200,000]
                     [Dave:  price=143000, qty=200,000]

Iteration 1:
  buyer = Alice (remaining=500,000), seller = Bob (200,000)
  145000 >= 138000 → CROSS
  settlement_price = (145000 + 138000) / 2 = 141500 ($0.1415)
  xlm_amount = min(500,000, 200,000) = 200,000
  usdc_amount = 200,000 × 141,500 / 1,000,000 = 28,300 USDC
  Match 1: Alice←200,000 XLM, Bob←28,300 USDC
  Alice remaining = 300,000, Bob remaining = 0 → advance seller to Carol

Iteration 2:
  buyer = Alice (remaining=300,000), seller = Carol (200,000)
  145000 >= 140000 → CROSS
  settlement_price = (145000 + 140000) / 2 = 142500 ($0.1425)
  xlm_amount = min(300,000, 200,000) = 200,000
  usdc_amount = 200,000 × 142,500 / 1,000,000 = 28,500 USDC
  Match 2: Alice←200,000 XLM, Carol←28,500 USDC
  Alice remaining = 100,000, Carol remaining = 0 → advance seller to Dave

Iteration 3:
  buyer = Alice (remaining=100,000), seller = Dave (200,000)
  145000 >= 143000 → CROSS
  settlement_price = (145000 + 143000) / 2 = 144000 ($0.1440)
  xlm_amount = min(100,000, 200,000) = 100,000
  usdc_amount = 100,000 × 144,000 / 1,000,000 = 14,400 USDC
  Match 3: Alice←100,000 XLM, Dave←14,400 USDC
  Alice remaining = 0 → advance buyer (no more buyers)
  Dave remaining = 100,000 (partial fill, stays active)
```

**Result:**
- Alice's 500,000 XLM buy is fully filled across 3 matches at different prices
  - 200,000 XLM at $0.1415 from Bob
  - 200,000 XLM at $0.1425 from Carol
  - 100,000 XLM at $0.1440 from Dave
- Bob: fully filled, receives 28,300 USDC
- Carol: fully filled, receives 28,500 USDC
- Dave: partially filled, receives 14,400 USDC, 100,000 XLM remains active
- Each match is submitted to Soroban as a separate `MatchingEngine.submit_match()` call

---

### Situation 5: Multiple Buyers, Multiple Sellers

**Setup:**
- Alice: Buy 200,000 XLM at $0.142
- Bob: Buy 300,000 XLM at $0.141
- Carol: Sell 250,000 XLM at $0.139
- Dave: Sell 250,000 XLM at $0.140

**Relayer at 60-second mark:**
```
Buyers sorted desc: [Alice: 142000, 200k], [Bob: 141000, 300k]
Sellers sorted asc: [Carol: 139000, 250k], [Dave: 140000, 250k]

Iteration 1: Alice vs Carol
  142000 >= 139000 → CROSS
  settlement_price = (142000 + 139000) / 2 = 140500
  xlm = min(200k, 250k) = 200k
  usdc = 200k × 140500 / 1M = 28,100 USDC
  Alice remaining = 0 (advance), Carol remaining = 50k

Iteration 2: Bob vs Carol (remaining 50k)
  141000 >= 139000 → CROSS
  settlement_price = (141000 + 139000) / 2 = 140000
  xlm = min(300k, 50k) = 50k
  usdc = 50k × 140000 / 1M = 7,000 USDC
  Bob remaining = 250k, Carol remaining = 0 (advance)

Iteration 3: Bob (250k remaining) vs Dave
  141000 >= 140000 → CROSS
  settlement_price = (141000 + 140000) / 2 = 140500
  xlm = min(250k, 250k) = 250k
  usdc = 250k × 140500 / 1M = 35,125 USDC
  Bob remaining = 0 (advance), Dave remaining = 0 (advance)
  
No more buyers or sellers → done
```

**Total matches this batch: 3**
**Result:**
- Alice: received 200,000 XLM, fully filled
- Bob: received 300,000 XLM (50k from Carol + 250k from Dave), fully filled
- Carol: received 35,100 USDC (28,100 from Alice + 7,000 from Bob), fully filled
- Dave: received 35,125 USDC from Bob, fully filled

---

### Situation 6: Order Expires Without Match

**Setup:**
- Alice submits: Buy 100,000 XLM at $0.100 (a very low bid, unlikely to match)
- No sellers come at that price for 1 hour

**After 1 hour:**
```
Relayer calls db.expireStaleOrders()
  → Finds Alice's order: expires_at < now
  → Calls EscrowVault.expire(alice_nullifier) on Soroban

EscrowVault.expire():
  Checks: record.status == Active ✓
  Checks: now >= record.expires_at ✓
  Transfers: USDC back to Alice
  Sets: record.status = Expired
```

Alice gets her USDC back. Nothing was ever public about her order — not even the attempted price.

---

### Situation 7: Trader Cancels Their Own Order

**Setup:**
- Alice submits a buy order
- Market moves against her, she wants to cancel before the batch runs

**Alice clicks "Cancel" in the UI:**
```
Frontend builds a Soroban transaction calling:
  EscrowVault.cancel(alice_address, alice_nullifier)

Alice signs it with Freighter.

Relayer broadcasts it to Stellar.

EscrowVault.cancel():
  Checks: record.trader == alice ✓
  Checks: record.status == Active ✓
  Transfers: USDC back to Alice
  Sets: record.status = Cancelled
```

The commitment hash still exists in the OrderBook (status = Cancelled). The batch matcher skips Cancelled orders.

---

### Situation 8: Front-Running Attempt (Why It Fails)

**Setup:**
- Alice submits a buy order
- A bot sees Alice's transaction in the mempool and tries to front-run

**What the bot sees in the mempool:**
```
Stellar transaction:
  Calls: OrderBook.submit_order(
    commitment: "0x7f3a9b...",   ← just a hash
    nullifier:  "0x2a8f1c...",   ← just a hash
    asset_in: USDC,
    amount_in: 70000_0000000,   ← total USDC deposited
    proof_1: [192 bytes],
    proof_2: [192 bytes],
    proof_3: [192 bytes],
  )
```

The bot knows Alice deposited 70,000 USDC. It can guess this means a ~500,000 XLM order at around $0.14. But it has no:
- Exact price
- Exact quantity
- Direction confirmed

More importantly: even if the bot guesses the price, it cannot:
1. Forge a ZK proof (mathematically impossible without the private inputs)
2. Submit a sell order that matches Alice's specific commitment (the matching is done at batch time, not arrival time)
3. Affect the settlement price (it's a sealed batch auction, not a continuous book)

Front-running is neutralized because:
- There is no continuous order book to read (orders are sealed)
- Settlement happens at batch time, not submission time
- All orders submitted within the 60-second window get the same settlement opportunity

---

### How the On-Chain Match Validation Works

When the relayer calls `MatchingEngine.submit_match()`, it reveals the private data:
```
buyer_commitment:  0x7f3a9b...
buyer_price:       140000         ← revealed
buyer_quantity:    5000000000000  ← revealed
buyer_salt:        0xa3f2...      ← revealed

seller_commitment: 0x2b8c4d...
seller_price:      138000         ← revealed
seller_quantity:   5000000000000  ← revealed
seller_salt:       0x7c1a...      ← revealed
```

The MatchingEngine contract then:

1. Recomputes `Poseidon(140000, 5T, 0, 0xa3f2...)` and checks it equals `buyer_commitment`. If the relayer lied about the price or quantity, this check fails.

2. Recomputes `Poseidon(138000, 5T, 1, 0x7c1a...)` and checks it equals `seller_commitment`. Same protection.

3. Checks `140000 >= 138000` — prices must cross.

4. Looks up both commitments in the OrderBook contract — both must be Active.

Only after all four checks pass does settlement proceed. The relayer cannot forge a fake match because it would require finding inputs that hash to a commitment hash, which is computationally infeasible (would take longer than the universe has existed).

---

## 11. Full End-to-End Testing Guide

### Prerequisites

Before testing, ensure all components are running:

```bash
# Terminal 1: PostgreSQL
docker run -d --name darkpool-postgres \
  -e POSTGRES_DB=darkpool \
  -e POSTGRES_USER=darkpool \
  -e POSTGRES_PASSWORD=localdev \
  -p 5432:5432 postgres:15

# Terminal 2: Relayer
cd relayer && npm run dev
# Should print: "Relayer running on port 3001"
# Should print: "Starting batch auction — interval: 60s"

# Terminal 3: Frontend
cd frontend && npm run dev
# Should print: "Local: http://localhost:5173"
```

---

### Test 1: Circuit Correctness Test

**What it tests:** That the Circom circuits correctly accept valid inputs and reject invalid inputs.

```bash
cd circuits
node scripts/test_circuits.js
```

**Expected results:**

`OrderCommitment circuit — valid case:`
```
Input:  price=140000, qty=5000000000000, direction=0, salt=<random>
Output: proof generated, commitment verified ✓
```

`OrderCommitment circuit — invalid direction:`
```
Input:  direction=2 (neither 0 nor 1)
Output: Error: Constraint violated — dirSquared !== direction ✓
```

`BalanceProof circuit — balance too low:`
```
Input:  balance=100, quantity=1000
Output: Error: Constraint violated — balance < quantity ✓
```

`RangeProof circuit — price out of range:`
```
Input:  price=999 (below min of 1000)
Output: Error: Constraint violated — price < price_min ✓
```

---

### Test 2: Contract Unit Tests

```bash
cd contracts
cargo test --package escrow_vault -- --nocapture
```

**Key tests to watch:**

`test_deposit_and_cancel:`
```
1. Initialize vault
2. Deposit 1000 USDC with nullifier A
3. Check vault holds 1000 USDC ✓
4. Cancel with alice's address
5. Check alice's balance restored ✓
6. Check nullifier A status = Cancelled ✓
```

`test_double_nullifier_rejected:`
```
1. Submit order with nullifier A → succeeds ✓
2. Submit order with nullifier A again → panics "nullifier already used" ✓
```

`test_release_only_by_settlement:`
```
1. Deposit funds, mark as Matched
2. Call release() from a random address → panics "unauthorized" ✓
3. Call release() from Settlement address → succeeds ✓
```

---

### Test 3: Relayer Matching Algorithm Unit Tests

```bash
cd relayer && npm test
```

**Test: Perfect match**
```typescript
// Input
buyers  = [{ price: 140000n, qty: 500000n, commitment: "0xabc" }]
sellers = [{ price: 138000n, qty: 500000n, commitment: "0xdef" }]

// Expected
matches.length === 1
matches[0].settlement_price === 139000n
matches[0].xlm_amount === 500000n
```

**Test: No match**
```typescript
buyers  = [{ price: 130000n, qty: 500000n }]
sellers = [{ price: 140000n, qty: 500000n }]

// Expected
matches.length === 0
```

**Test: Partial fill**
```typescript
buyers  = [{ price: 140000n, qty: 1000000n }]
sellers = [{ price: 138000n, qty: 300000n }]

// Expected
matches.length === 1
matches[0].xlm_amount === 300000n  // limited by seller
```

---

### Test 4: Full End-to-End Test (Two Real Accounts)

```bash
# From project root
npm run test:e2e
```

This test script:

**Step 1: Create two Stellar testnet accounts**
```
Alice: GABCD... (buyer)
Bob:   GEFGH... (seller)
```

**Step 2: Fund both via Friendbot**
```
GET https://friendbot.stellar.org/?addr=GABCD...
GET https://friendbot.stellar.org/?addr=GEFGH...
Each receives 10,000 XLM
```

**Step 3: Mint test USDC to Alice**
```
Using the USDC test token contract, mint 10,000 USDC to Alice
(Real USDC is Circle-issued. On testnet, we deploy a mock.)
```

**Step 4: Alice generates ZK proofs and submits buy order**
```javascript
// In the test script, using the SDK directly:
const proofs = await generateOrderProofs({
  price: 141000n,       // $0.141
  quantity: 1000_0000000n,  // 1000 XLM
  direction: 0n,         // buy
  salt: randomBigInt(),
  secret: aliceSecret,
  nonce: BigInt(Date.now()),
  balance: 10000_0000000n,
});

// Build and sign transaction
// Submit to relayer
const { order_id, batch_id } = await submitOrder(alice, proofs, ...);
console.log("Alice's order_id:", order_id); // commitment hash
```

**Step 5: Bob generates ZK proofs and submits sell order**
```javascript
const proofs = await generateOrderProofs({
  price: 139000n,       // $0.139
  quantity: 1000_0000000n,  // 1000 XLM
  direction: 1n,         // sell
  ...
});

await submitOrder(bob, proofs, ...);
```

**Step 6: Wait for batch (up to 60 seconds)**
```javascript
while (true) {
  const status = await getOrderStatus(alice_order_id);
  if (status === 'settled') break;
  await sleep(5000);
}
```

**Step 7: Verify results**
```javascript
// Check Alice received XLM
const aliceXlmBalance = await getStellarBalance(alice, 'XLM');
assert(aliceXlmBalance >= 1000n); // received ~1000 XLM ✓

// Check Bob received USDC
const bobUsdcBalance = await getStellarBalance(bob, 'USDC');
assert(bobUsdcBalance >= 139n);   // received ~140 USDC ✓

// Check settlement price is midpoint
const match = await getMatchDetails(alice_order_id);
assert(match.settlement_price === 140000n); // $0.140 midpoint ✓

// Verify order details were never public
// (by checking that no Stellar event reveals price or direction)
const events = await getStellarEvents(alice_order_id);
const settleEvent = events.find(e => e.name === 'settle');
assert(settleEvent.data.includes('xlm_amount'));
assert(!settleEvent.data.includes('price'));   // price NOT in event ✓
assert(!settleEvent.data.includes('alice'));   // address NOT in event ✓
```

---

### Test 5: Manual Frontend Test

Open `http://localhost:5173` in a browser with Freighter installed.

**Checklist:**

```
[ ] Connect Freighter wallet → address appears in header
[ ] Dashboard shows batch countdown timer ticking down
[ ] Dashboard shows "0 active orders" initially
[ ] Go to Trade page → WASM files download (~25MB total)
[ ] Enter: Buy 1000 XLM at $0.14
[ ] Click Submit → ProofStatus component appears
[ ] "Deriving cryptographic secret" appears (fast, <1s)
[ ] "Generating order commitment proof" appears (~2s)
[ ] "Generating balance proof" appears (~2s)
[ ] "Generating range proof" appears (~1s)
[ ] "Building transaction" appears (<1s)
[ ] Freighter popup opens → click Approve
[ ] "Broadcasting to Stellar" appears
[ ] "Confirmed! Order submitted" appears
[ ] Go to Orders page → order appears with status "Active"
[ ] Order shows commitment hash (long hex string)
[ ] Order shows "Waiting for batch match"
[ ] Wait for batch timer to hit 0:00
[ ] Order status changes to "Matched" then "Settled"
[ ] Go to Portfolio page → XLM balance increased
```

---

### Test 6: Security / Rejection Tests

**Test invalid proof rejection:**
```bash
# Manually submit garbage proof data to the relayer
curl -X POST http://localhost:3001/api/orders/submit \
  -H "Content-Type: application/json" \
  -d '{
    "commitment": "0x1234...",
    "order_proof": {"pi_a": [0,0], "pi_b": [[0,0],[0,0]], "pi_c": [0,0]},
    "order_public_signals": ["0x1234..."],
    ...
  }'

# Expected: 400 {"error": "Invalid ZK proof"}
```

**Test double nullifier rejection:**
```bash
# Submit the same order (same nullifier) twice
# First submission: succeeds
# Second submission: fails at the Soroban contract level
# Expected on-chain: panic "nullifier already used"
```

**Test price out of range:**
```bash
# Try to generate a proof with price = 0 (below minimum of 1000)
# Expected: circuit constraint fails during proof generation
# Error: "Error in template RangeProof: Constraint violated"
```

---

## 12. What Is Public vs What Is Hidden

| Information | Public (on Stellar) | Hidden |
|---|---|---|
| Order exists | ✓ (as a commitment hash) | |
| Order price | | ✓ (inside hash) |
| Order quantity | | ✓ (inside hash) |
| Buy or sell direction | | ✓ (inside hash) |
| Which wallet submitted it | ✓ (transaction signer) | |
| How much USDC/XLM was locked | ✓ (escrow deposit) | |
| Settlement happened | ✓ (settlement event) | |
| Settlement price | | ✓ (not in event) |
| Which wallet is buyer | | ✓ (not in event) |
| Which wallet is seller | | ✓ (not in event) |
| Total XLM volume traded | ✓ (in settlement event) | |
| Total USDC volume traded | ✓ (in settlement event) | |

The settlement event only emits:
```
event: "settle"
data: { xlm_amount: 5000000000000, usdc_amount: 695000000000 }
```
No addresses. No price. Just volumes.

---

## 13. Glossary

| Term | Plain English Meaning |
|---|---|
| **Commitment** | A hash (fingerprint) of your order's private details. Like sealing your order in an envelope. |
| **Nullifier** | A unique token that, once used, prevents the same order from being re-submitted. Like a check number. |
| **Salt** | A random number added to your order before hashing. Prevents anyone from guessing your order. |
| **Groth16** | The specific ZK proof system used. Small proofs, fast verification, used in Zcash since 2016. |
| **Poseidon** | A hash function optimized for ZK circuits. Like SHA256 but much cheaper inside proofs. |
| **Circuit** | The mathematical rulebook that defines what a ZK proof is proving. |
| **WASM** | WebAssembly — compiled code that runs in the browser at near-native speed. |
| **Zkey** | The "trusted setup" file for a circuit. Contains public parameters that make proofs verifiable. |
| **Relayer** | The off-chain server that orchestrates matching and submits results to the blockchain. |
| **EscrowVault** | The smart contract that holds your funds while your order is active. |
| **Batch Auction** | Orders are collected for 60 seconds, then matched all at once — not one-by-one continuously. |
| **Settlement price** | The price both parties trade at. Always the midpoint of bid and ask. |
| **Stroops** | The smallest unit of XLM. 1 XLM = 10,000,000 stroops. (Like cents but finer.) |
| **Micro-USDC** | The internal unit for prices. 1,000,000 micro-USDC = $1.00 per XLM. |
| **Freighter** | The Stellar browser wallet extension (like MetaMask but for Stellar). |
| **Soroban** | Stellar's smart contract platform (like Ethereum's EVM but for Stellar). |
| **XDR** | External Data Representation — Stellar's binary format for transactions. |
| **Cross** | When a buyer's price is >= a seller's price. The condition for a match to exist. |
| **Dark Pool** | A trading venue where orders are hidden until matched. Used by institutions to trade large blocks without market impact. |
| **Front-running** | When a bot sees your order before it's processed and submits a competing order first. Mathematically prevented here. |

---

*This document describes the Aether ZK Dark Pool as designed. The v1 trust assumption (relayer knows revealed prices) is explicitly noted throughout. The mitigation is that the relayer cannot move funds — all fund movements require smart contract authorization that the relayer cannot forge.*
