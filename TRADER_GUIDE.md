# Aether Dark Pool — Trader Guide

> XLM/USDC institutional dark pool on Stellar Soroban. Orders are **sealed** with
> zero-knowledge proofs and matched in **60-second batch auctions** at a single
> **uniform clearing price**. This guide explains exactly how your order behaves
> in every situation, the math behind fills and settlement, and how to trade when
> the book is hidden.

---

## 1. The 30-second mental model

1. You place a **limit order**: a side (Buy/Sell XLM), a **price** (USDC per XLM),
   and a **quantity** (XLM).
2. Your order is **sealed** — the network commits to it cryptographically; your
   price and size are not revealed to other traders while it rests.
3. Every **60 seconds** a batch auction runs. All crossing orders in the book
   settle together at **one fair clearing price** — not at your limit price.
4. Settlement is **atomic on-chain**: XLM and USDC swap in a single transaction,
   and any amount you over-committed (price improvement, or an unfilled
   remainder) is **refunded to your wallet automatically**.

You always pay/receive the **clearing price or better — never worse** than your
limit.

---

## 2. Placing an order: price & quantity ranges

| Field    | Unit                  | Min     | Max         | Notes |
|----------|-----------------------|---------|-------------|-------|
| Quantity | XLM                   | 100     | 10,000,000  | Size of the order in XLM. |
| Price    | USDC per 1 XLM        | 0.001   | 10.000      | Your **limit** — the worst price you'll accept. |
| Expiry   | seconds               | —       | —           | Default 3600s (1h). After this, an unfilled order is refunded. |

**Internal scaling (for reference / API):**
- XLM is held in **stroops**: `1 XLM = 10,000,000 (1e7) stroops`.
- Price is in **micro-USDC per XLM**: `$0.1945 → 194500`.
- USDC on Stellar uses 7 decimals: `19.45 USDC = 194500000 (1e7-scaled)`.

**What "price" means by side:**
- **Buy XLM**: your price is the **maximum** USDC you'll pay per XLM. You escrow
  USDC = `quantity × price`. If the batch clears cheaper, you pay less and the
  difference is refunded.
- **Sell XLM**: your price is the **minimum** USDC you'll accept per XLM. You
  escrow the XLM. If the batch clears higher, you receive more.

When you submit, the deposit is **locked in the EscrowVault** as part of the same
signed transaction. Your funds are never held by the relayer — only by the
audited vault contract, and only you (cancel/expire), the matching engine
(settle), can move them.

---

## 3. How matching works (the batch auction)

Every 60 seconds the relayer closes the current batch and runs the auction over
**all resting orders** (orders carry across batches until they fill, expire, or
are cancelled).

### Step 1 — Find the uniform clearing price `P`

The engine picks the single price that **maximizes executed volume**:

- For each candidate price `p` (every distinct limit price in the book):
  - `demand(p)` = total XLM of **buy** orders with limit **≥ p**
  - `supply(p)` = total XLM of **sell** orders with limit **≤ p**
  - `volume(p)` = `min(demand(p), supply(p))`
- `P` = the price that maximizes `volume`. If a range of prices ties, `P` is the
  **midpoint** of that range (fair to both sides).

If no price produces positive volume, **the book does not cross** — nothing
trades this batch and all orders rest to the next one.

> **Why a single price?** Per-pair midpoints would let the order in which trades
> are paired move each trade's price — unfair and manipulable. A uniform
> clearing price means everyone in the batch gets the **same** fair price, and
> pairing order cannot change it.

### Step 2 — Select eligible orders

- Buy orders with limit **≥ P** are eligible.
- Sell orders with limit **≤ P** are eligible.
- Orders priced away from `P` simply rest (they did not cross this batch).

### Step 3 — Allocate fills (price-time priority)

Eligible orders are filled best-price-first; ties broken by **earliest
submission time**. Each matched pair trades:

```
xlm_traded  = min(buyer_remaining, seller_remaining)
usdc_traded = xlm_traded × P            (the clearing price, not the limit)
```

### Worked example (the canonical case)

- **Buyer**: Buy 100 XLM, limit $0.1945
- **Seller**: Sell 120 XLM, limit $0.1945

Both cross at `P = $0.194500`. The trade is `min(100, 120) = 100 XLM`:

```
xlm_traded  = 100 XLM
usdc_traded = 100 × 0.1945 = 19.45 USDC
```

- Buyer is **fully filled**: receives 100 XLM, pays 19.45 USDC.
- Seller is **partially filled**: sells 100 XLM, receives 19.45 USDC, and the
  **unfilled 20 XLM is refunded** to the seller's wallet. → see §4.

---

## 4. Single-settlement & partial fills — **read this**

Aether v1 uses **all-or-nothing escrow per order**: an order's deposit settles
**exactly once**. At that settlement the EscrowVault:

1. pays the **matched amount** to the counterparty, and
2. **refunds the unfilled remainder** to you, in the same atomic transaction.

So a "partial fill" here means: **the crossed amount trades, the rest is
refunded, and your order is done.** The remainder does **not** keep resting for a
later batch (that's a v2 feature — per-fill escrow).

> This is different from a classic central limit order book / Hyperliquid-style
> HLP, where a partially-filled order keeps resting until fully filled or
> cancelled. On Aether v1, **one order = one settlement**.

**In the example above**, the seller's 120 XLM order shows in your history as:

| Side | Status            | Filled | Refunded | Price   | Received  |
|------|-------------------|--------|----------|---------|-----------|
| SELL | `partially_filled`| 100 XLM| 20 XLM   | $0.1945 | 19.45 USDC|

The 20 XLM came straight back to your wallet. If you still want to sell it,
**place a new order** for 20 XLM.

---

## 5. Every order outcome, and what you'll see

| Status (UI)        | What happened | Your funds |
|--------------------|---------------|------------|
| `active` / open    | Resting in the book — hasn't crossed yet. | Escrowed in the vault. |
| `settling`         | Matched this batch; settlement tx in flight (a few seconds). | Locked, about to swap. |
| `filled`           | Fully traded at the clearing price. | You received the other asset; price-improvement surplus refunded. |
| `partially_filled` | Crossed amount traded; **remainder refunded**. Order is done (§4). | Filled portion swapped; remainder back in wallet. |
| `expired`          | Reached its expiry with no (further) fill. | **Fully refunded** to your wallet. |
| `cancelled`        | You cancelled while it was still active. | **Fully refunded** to your wallet. |

**Price improvement refunds (the other reason you might see a refund):** if you
bid $0.20 to buy and the batch clears at $0.18, you only pay $0.18 — the $0.02/XLM
you over-escrowed is refunded. You never pay more than the clearing price.

**You can always reclaim funds from an order that didn't fully fill:** cancel it
(while active) or let it expire — either way the vault returns your deposit.

---

## 6. "How do I choose a price and size if the book is hidden?"

A dark pool hides **resting orders** (so large blocks can't be front-run), but it
does **not** hide **executed trades**. You price off public, post-trade data plus
external references:

1. **Recent Trades tape** (Trade page → *Recent Trades*, and the chart): every
   settled batch publishes its **clearing price, volume, and tx hash** on-chain.
   This is your primary price signal — it's the real, fair price XLM/USDC last
   cleared at.
2. **24h ticker stats** (high/low/volume/last) derived from that settled tape.
3. **External reference price**: XLM/USDC trades on every major venue. Use the
   prevailing market price as your anchor.
4. **The clearing-price guarantee**: because you only ever trade at the uniform
   clearing price *or better*, you can **quote your true limit** without fear of
   "paying your own bid." Set the worst price you'd accept; the auction gives you
   the fair price if it's better.

**Practical recipe:**
- **Want to trade now, near market?** Set a limit slightly through the recent
  clearing price (buy a little above / sell a little below the last clear). You'll
  cross in the next batch at the fair clearing price, not your aggressive limit.
- **Want a specific price?** Set exactly that limit and wait. You rest until a
  batch clears at a price that satisfies you, or you expire/cancel.
- **Large block?** Size is sealed while resting — that's the point. Split across
  batches if you want to average in, since each order settles once (§4).
- **Quantity**: there's no hidden "available size" to match against; you choose
  how much XLM you want and the auction fills as much as crosses against the
  opposite side this batch. Whatever doesn't cross is refunded (single-settlement)
  or rests until expiry depending on price.

**What you do *not* need to know:** the resting orders of others. The auction
mechanism is designed so that quoting your honest limit is the optimal strategy —
you're protected from overpaying by the uniform clearing price and from
front-running by the sealed book.

---

## 7. Privacy: what's hidden vs. public

| Hidden while your order rests | Public (always or after settlement) |
|-------------------------------|-------------------------------------|
| Your limit price              | Settled clearing price per batch    |
| Your quantity                 | Settled volume per batch            |
| Your identity ↔ order link    | Settlement tx hash (amounts only)   |

> v1 trust model: the relayer sees revealed prices to run the auction off-chain;
> the **on-chain** settlement event publishes amounts only, never trader
> addresses or per-order prices. Full on-chain ZK verification (Groth16 +
> Poseidon) is a v2 milestone.

---

## 8. Quick reference — the formulas

```
# Scaling
1 XLM            = 10,000,000 stroops          (1e7)
price $0.1945    = 194,500 micro-USDC per XLM  (×1e6)
19.45 USDC       = 194,500,000                 (1e7-scaled, Stellar)

# Buy escrow (USDC you lock)
usdc_escrowed    = quantity_xlm × limit_price

# Clearing price P (per batch) — maximizes min(demand(p), supply(p)),
# midpoint of the max-volume price range.

# Per matched pair
xlm_traded       = min(buyer_remaining, seller_remaining)
usdc_traded      = xlm_traded × P

# Refunds (atomic, same tx)
buyer_refund     = usdc_escrowed − usdc_traded          # price improvement
seller_refund    = quantity_xlm  − xlm_traded           # unfilled remainder (XLM)
```

Eligibility & guarantees:
- A pair trades only if `buyer_limit ≥ P ≥ seller_limit` (enforced on-chain).
- You never trade worse than your limit.
- Every order settles **at most once**; unfilled size is refunded, not rested
  (v1).
```
