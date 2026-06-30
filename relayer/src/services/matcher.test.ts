import { findMatches, computeClearingPrice, cmpBigInt } from './matcher';
import type { ActiveOrder } from '../types';

const XLM = 10_000_000n; // 1 XLM in stroops

let seq = 0;

function order(opts: {
  side: 'buy' | 'sell';
  price: bigint;          // micro-USDC per XLM
  qty: bigint;            // XLM stroops (full original quantity)
  filled?: bigint;        // XLM stroops already filled
  submittedAt?: Date;
  id?: string;
}): ActiveOrder {
  const filled = opts.filled ?? 0n;
  const id = opts.id ?? `order-${seq++}`;
  return {
    commitment: id,
    nullifier: `null-${id}`,
    traderAddress: `G${id}`,
    assetIn: opts.side === 'buy' ? 'USDC' : 'XLM',
    assetOut: opts.side === 'buy' ? 'XLM' : 'USDC',
    amountIn: opts.qty,
    revealedPrice: opts.price,
    xlmQuantity: opts.qty,
    filledQuantity: filled,
    remainingQuantity: opts.qty - filled,
    revealedSalt: '12345',
    submittedAt: opts.submittedAt ?? new Date('2026-06-11T00:00:00Z'),
  };
}

describe('cmpBigInt', () => {
  it('is precision-proof beyond 2^53', () => {
    const a = 2n ** 60n;
    const b = a + 1n;
    expect(cmpBigInt(a, b)).toBe(-1);
    expect(cmpBigInt(b, a)).toBe(1);
    expect(cmpBigInt(a, a)).toBe(0);
    // Number(a - b) would round to 0 for e.g. (2^60 + 2^10) vs 2^60? It's -1024,
    // safe — but Number(2n**70n - (2n**70n + 1n)) is fine too; the real hazard is
    // Number overflow semantics. Assert the comparator never relies on it:
    expect(cmpBigInt(2n ** 100n, 2n ** 100n + 1n)).toBe(-1);
  });
});

describe('computeClearingPrice', () => {
  it('returns null when the book does not cross', () => {
    const buyers = [order({ side: 'buy', price: 110_000n, qty: 100n * XLM })];
    const sellers = [order({ side: 'sell', price: 120_000n, qty: 100n * XLM })];
    expect(computeClearingPrice(buyers, sellers)).toBeNull();
  });

  it('returns null with an empty side', () => {
    expect(computeClearingPrice([], [order({ side: 'sell', price: 1n, qty: XLM })])).toBeNull();
    expect(computeClearingPrice([order({ side: 'buy', price: 1n, qty: XLM })], [])).toBeNull();
  });

  it('uses midpoint of the max-volume price range for a simple cross', () => {
    const buyers = [order({ side: 'buy', price: 125_000n, qty: 100n * XLM })];
    const sellers = [order({ side: 'sell', price: 115_000n, qty: 100n * XLM })];
    // volume = 100 at both candidates 115000 and 125000 → midpoint 120000
    expect(computeClearingPrice(buyers, sellers)).toBe(120_000n);
  });

  it('maximizes executed volume', () => {
    const buyers = [
      order({ side: 'buy', price: 130_000n, qty: 100n * XLM }),
      order({ side: 'buy', price: 120_000n, qty: 50n * XLM }),
    ];
    const sellers = [
      order({ side: 'sell', price: 110_000n, qty: 80n * XLM }),
      order({ side: 'sell', price: 125_000n, qty: 100n * XLM }),
    ];
    // p=110000/120000 → vol 80; p=125000/130000 → vol 100 → range [125000,130000]
    expect(computeClearingPrice(buyers, sellers)).toBe(127_500n);
  });
});

describe('findMatches', () => {
  it('matches a simple cross in full at the clearing price', () => {
    const buyers = [order({ side: 'buy', price: 125_000n, qty: 100n * XLM, id: 'B' })];
    const sellers = [order({ side: 'sell', price: 115_000n, qty: 100n * XLM, id: 'S' })];

    const matches = findMatches(buyers, sellers);
    expect(matches).toHaveLength(1);
    const m = matches[0];
    expect(m.buyerCommitment).toBe('B');
    expect(m.sellerCommitment).toBe('S');
    expect(m.settlementPrice).toBe(120_000n);
    expect(m.xlmAmount).toBe(100n * XLM);
    // usdc = 1_000_000_000 stroops * 120_000 / 1_000_000 = 120_000_000 (12 USDC... in stroops)
    expect(m.usdcAmount).toBe((100n * XLM * 120_000n) / 1_000_000n);
    // MatchResult quantities are the FULL preimage quantities
    expect(m.buyerQuantity).toBe(100n * XLM);
    expect(m.sellerQuantity).toBe(100n * XLM);
    // limit prices preserved for the on-chain cross check
    expect(m.buyerPrice).toBe(125_000n);
    expect(m.sellerPrice).toBe(115_000n);
  });

  it('returns no matches when the book does not cross', () => {
    const buyers = [order({ side: 'buy', price: 110_000n, qty: 100n * XLM })];
    const sellers = [order({ side: 'sell', price: 120_000n, qty: 100n * XLM })];
    expect(findMatches(buyers, sellers)).toHaveLength(0);
  });

  it('partially fills the larger order, refunds the remainder, and does NOT rest it (single-settlement)', () => {
    // v1 escrow consumes the whole deposit on first settlement: the 100-XLM buy
    // crosses 60 XLM with the seller, the unfilled 40 XLM is refunded on-chain,
    // and the buyer is DONE — it must not rematch a second seller in the batch.
    const buy = order({ side: 'buy', price: 125_000n, qty: 100n * XLM, id: 'BIG-BUY' });
    const sellA = order({
      side: 'sell', price: 115_000n, qty: 60n * XLM, id: 'SELL-A',
      submittedAt: new Date('2026-06-11T00:00:00Z'),
    });
    const sellB = order({
      side: 'sell', price: 115_000n, qty: 40n * XLM, id: 'SELL-B',
      submittedAt: new Date('2026-06-11T00:00:30Z'),
    });

    const matches = findMatches([buy], [sellA, sellB]);
    // Exactly ONE match: the buyer is consumed after crossing SELL-A; its leftover
    // 40 XLM is refunded (not matched against SELL-B).
    expect(matches).toHaveLength(1);
    expect(matches[0].buyerCommitment).toBe('BIG-BUY');
    expect(matches[0].sellerCommitment).toBe('SELL-A');   // earlier seller, time priority
    expect(matches[0].xlmAmount).toBe(60n * XLM);          // filled = min(100, 60)
    expect(matches[0].buyerQuantity).toBe(100n * XLM);     // full preimage qty, NOT the fill
    expect(matches.some(m => m.sellerCommitment === 'SELL-B')).toBe(false);
  });

  it('ignores fully-filled orders (remainingQuantity = 0)', () => {
    const buy = order({ side: 'buy', price: 125_000n, qty: 100n * XLM, filled: 100n * XLM });
    const sell = order({ side: 'sell', price: 115_000n, qty: 100n * XLM });
    expect(findMatches([buy], [sell])).toHaveLength(0);
  });

  it('applies time priority at equal prices (earlier order fills first)', () => {
    const early = order({
      side: 'sell', price: 115_000n, qty: 50n * XLM, id: 'EARLY',
      submittedAt: new Date('2026-06-11T00:00:00Z'),
    });
    const late = order({
      side: 'sell', price: 115_000n, qty: 50n * XLM, id: 'LATE',
      submittedAt: new Date('2026-06-11T00:00:30Z'),
    });
    const buy = order({ side: 'buy', price: 125_000n, qty: 50n * XLM, id: 'BUY' });

    // Pass LATE first to prove sorting (not input order) decides priority
    const matches = findMatches([buy], [late, early]);
    expect(matches).toHaveLength(1);
    expect(matches[0].sellerCommitment).toBe('EARLY');
  });

  it('settles every pair in the batch at ONE uniform clearing price', () => {
    // Two independent crossing pairs (each order settles exactly once under the
    // single-settlement invariant) must clear at the SAME uniform price.
    const buyers = [
      order({ side: 'buy', price: 130_000n, qty: 50n * XLM, id: 'B1' }),
      order({ side: 'buy', price: 128_000n, qty: 50n * XLM, id: 'B2' }),
      order({ side: 'buy', price: 120_000n, qty: 50n * XLM, id: 'B3' }), // below clearing — excluded
    ];
    const sellers = [
      order({ side: 'sell', price: 125_000n, qty: 50n * XLM, id: 'S1' }),
      order({ side: 'sell', price: 126_000n, qty: 50n * XLM, id: 'S2' }),
    ];

    const matches = findMatches(buyers, sellers);
    // max volume 100 over [126000,128000] → midpoint clearing 127000
    expect(matches).toHaveLength(2);

    // One uniform price for the whole batch — pairing order cannot move prices
    const prices = new Set(matches.map(m => m.settlementPrice));
    expect(prices.size).toBe(1);
    expect([...prices][0]).toBe(127_000n);

    // B3 (bid 120000 < clearing 127000) must be excluded
    expect(matches.some(m => m.buyerCommitment === 'B3')).toBe(false);

    // Each order appears at most once (single-settlement invariant)
    const buyerIds = matches.map(m => m.buyerCommitment);
    const sellerIds = matches.map(m => m.sellerCommitment);
    expect(new Set(buyerIds).size).toBe(buyerIds.length);
    expect(new Set(sellerIds).size).toBe(sellerIds.length);

    // Total executed volume
    const totalXlm = matches.reduce((acc, m) => acc + m.xlmAmount, 0n);
    expect(totalXlm).toBe(100n * XLM);

    // Every pair satisfies the on-chain check: buyer_price >= seller_price
    for (const m of matches) {
      expect(m.buyerPrice >= m.sellerPrice).toBe(true);
      expect(m.buyerPrice >= m.settlementPrice).toBe(true);
      expect(m.sellerPrice <= m.settlementPrice).toBe(true);
    }
  });

  it('sorts correctly with prices beyond Number precision', () => {
    const huge = 2n ** 60n;
    const buyers = [
      order({ side: 'buy', price: huge + 1n, qty: 10n * XLM, id: 'HIGH' }),
      order({ side: 'buy', price: huge, qty: 10n * XLM, id: 'LOW' }),
    ];
    const sellers = [order({ side: 'sell', price: 1n, qty: 10n * XLM, id: 'ASK' })];

    const matches = findMatches(buyers, sellers);
    expect(matches).toHaveLength(1);
    // Number(huge+1n) === Number(huge) would make this flaky with the old comparator
    expect(matches[0].buyerCommitment).toBe('HIGH');
  });
});
