import type { ActiveOrder, MatchResult } from '../types';

const PRICE_SCALE = 1_000_000n; // price is in micro-USDC per XLM

/** Precision-proof BigInt comparator (Number(a - b) loses precision past 2^53). */
export function cmpBigInt(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

type QueueOrder = ActiveOrder & { remaining: bigint };

/**
 * Price-time priority comparator.
 * Primary: price (direction-dependent, passed in as priceCmp).
 * Tiebreak 1: earlier submittedAt wins (time priority).
 * Tiebreak 2: commitment — deterministic total order for identical timestamps.
 */
function byPriceTime(
  priceCmp: (a: ActiveOrder, b: ActiveOrder) => number
): (a: ActiveOrder, b: ActiveOrder) => number {
  return (a, b) => {
    const p = priceCmp(a, b);
    if (p !== 0) return p;
    const t = a.submittedAt.getTime() - b.submittedAt.getTime();
    if (t !== 0) return t;
    return a.commitment < b.commitment ? -1 : a.commitment > b.commitment ? 1 : 0;
  };
}

/**
 * Compute the uniform batch clearing price (micro-USDC per XLM).
 *
 * Standard batch-auction design: a SINGLE clearing price for the whole batch,
 * chosen to maximize executed volume. Per-pair midpoints (the old design) let
 * the order of pairing affect each trade's price — unfair and manipulable.
 *
 * Algorithm:
 *  - Candidate prices = every distinct limit price in the book.
 *  - For candidate p: demand(p) = Σ remaining of bids ≥ p,
 *                     supply(p) = Σ remaining of asks ≤ p,
 *                     volume(p) = min(demand, supply).
 *  - Pick p maximizing volume. The argmax is a price interval [lo, hi];
 *    tiebreak with the midpoint (lo + hi) / 2 (demand is non-increasing and
 *    supply non-decreasing in p, so the midpoint also attains max volume).
 *
 * Compatible with on-chain settlement: MatchingEngine.submit_match only checks
 * buyer_price >= seller_price (limit prices) and settles the explicit
 * xlm_amount/usdc_amount, so the clearing price never goes on-chain directly —
 * it is fully encoded in the usdc_amount we compute. Every eligible pair
 * satisfies buyer_price >= P >= seller_price, so the on-chain cross check holds.
 *
 * Returns null when the book does not cross (no executable volume).
 */
export function computeClearingPrice(
  buyers: ActiveOrder[],
  sellers: ActiveOrder[]
): bigint | null {
  const liveBuys = buyers.filter(o => o.remainingQuantity > 0n);
  const liveSells = sellers.filter(o => o.remainingQuantity > 0n);
  if (liveBuys.length === 0 || liveSells.length === 0) return null;

  const candidateSet = new Set<bigint>();
  for (const o of liveBuys) candidateSet.add(o.revealedPrice);
  for (const o of liveSells) candidateSet.add(o.revealedPrice);
  const candidates = [...candidateSet].sort(cmpBigInt);

  let maxVolume = 0n;
  let lo = 0n;
  let hi = 0n;

  for (const p of candidates) {
    let demand = 0n;
    for (const b of liveBuys) if (b.revealedPrice >= p) demand += b.remainingQuantity;
    let supply = 0n;
    for (const s of liveSells) if (s.revealedPrice <= p) supply += s.remainingQuantity;
    const volume = demand < supply ? demand : supply;

    if (volume > maxVolume) {
      maxVolume = volume;
      lo = p;
      hi = p;
    } else if (volume === maxVolume && maxVolume > 0n) {
      if (p < lo) lo = p;
      if (p > hi) hi = p;
    }
  }

  if (maxVolume === 0n) return null; // book does not cross
  return (lo + hi) / 2n;
}

/**
 * Batch-auction matching with a uniform clearing price and price-time priority.
 *
 * 1. Compute the single clearing price P that maximizes executed volume.
 * 2. Eligible orders: bids with limit ≥ P, asks with limit ≤ P.
 * 3. Allocate fills in price-time priority (best price first; earlier
 *    submittedAt breaks ties).
 * 4. Every pair settles at P.
 *
 * SINGLE-SETTLEMENT INVARIANT (v1 escrow):
 *   Each order's escrow is an all-or-nothing deposit. On its first (and only)
 *   on-chain settlement the EscrowVault pays the matched amount to the
 *   counterparty and REFUNDS the unfilled remainder to the depositor, marking
 *   the deposit Settled. A second settle for the same order panics
 *   ("deposit not active"). Therefore an order can appear in AT MOST ONE match:
 *   after it matches, both sides are consumed and the larger side's remainder is
 *   refunded on-chain — it does NOT rest for a future fill. This differs from a
 *   classic CLOB / Hyperliquid HLP where partial fills keep resting; here a
 *   partial fill is really "fill the crossed amount, refund the rest, done".
 *   Per-fill escrow (true resting remainders) lands with the v2 contracts.
 *
 * Quantities are XLM stroops; prices micro-USDC per XLM.
 */
export function findMatches(buyers: ActiveOrder[], sellers: ActiveOrder[]): MatchResult[] {
  const matches: MatchResult[] = [];

  const clearingPrice = computeClearingPrice(buyers, sellers);
  if (clearingPrice === null) return matches;

  // Highest bid first, then time priority
  const buyQueue: QueueOrder[] = buyers
    .filter(o => o.remainingQuantity > 0n && o.revealedPrice >= clearingPrice)
    .sort(byPriceTime((a, b) => cmpBigInt(b.revealedPrice, a.revealedPrice)))
    .map(o => ({ ...o, remaining: o.remainingQuantity }));

  // Lowest ask first, then time priority
  const sellQueue: QueueOrder[] = sellers
    .filter(o => o.remainingQuantity > 0n && o.revealedPrice <= clearingPrice)
    .sort(byPriceTime((a, b) => cmpBigInt(a.revealedPrice, b.revealedPrice)))
    .map(o => ({ ...o, remaining: o.remainingQuantity }));

  let bi = 0;
  let si = 0;

  while (bi < buyQueue.length && si < sellQueue.length) {
    const buyer = buyQueue[bi];
    const seller = sellQueue[si];

    const xlmAmount = buyer.remaining < seller.remaining ? buyer.remaining : seller.remaining;
    // USDC amount = xlm_amount * clearing_price / PRICE_SCALE
    const usdcAmount = (xlmAmount * clearingPrice) / PRICE_SCALE;

    matches.push({
      buyerCommitment: buyer.commitment,
      buyerPrice: buyer.revealedPrice,
      buyerQuantity: buyer.xlmQuantity, // FULL quantity — commitment preimage (see types.ts)
      buyerSalt: buyer.revealedSalt,
      sellerCommitment: seller.commitment,
      sellerPrice: seller.revealedPrice,
      sellerQuantity: seller.xlmQuantity, // FULL quantity — commitment preimage
      sellerSalt: seller.revealedSalt,
      xlmAmount,
      usdcAmount,
      settlementPrice: clearingPrice,
    });

    // Single-settlement invariant: consume BOTH orders, even on a partial fill.
    // The larger side's remainder is refunded on-chain at settle time — it is
    // never re-matched. (A classic CLOB would only advance the side that hit 0.)
    buyer.remaining -= xlmAmount;
    seller.remaining -= xlmAmount;
    bi++;
    si++;
  }

  return matches;
}
