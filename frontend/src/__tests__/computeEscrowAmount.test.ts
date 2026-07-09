import { computeEscrowAmount, PRICE_SCALE, XLM_SCALE } from '../utils/constants';

describe('computeEscrowAmount', () => {
  it('sell orders escrow the XLM quantity directly', () => {
    const quantity = 500n * XLM_SCALE; // 500 XLM
    const price = 140_000n; // $0.14/XLM, unused for sells
    expect(computeEscrowAmount('sell', quantity, price)).toBe(quantity);
  });

  it('buy orders escrow quantity * price / PRICE_SCALE (USDC base units)', () => {
    const quantity = 100n * XLM_SCALE; // 100 XLM
    const price = 140_000n; // $0.14/XLM in micro-USDC
    // 100 XLM * $0.14 = $14.00 => 14 * 10^7 USDC base units
    expect(computeEscrowAmount('buy', quantity, price)).toBe(
      (quantity * price) / PRICE_SCALE
    );
    expect(computeEscrowAmount('buy', quantity, price)).toBe(140_000_000n);
  });

  it('matches the exact formula order_book.rs and the relayer both expect', () => {
    // Regression guard: this formula is duplicated (by necessity) into the
    // on-chain transaction, the balance-proof witness, and the relayer
    // payload — they must all derive from this single function so they can
    // never drift apart and break order_book's minimum_balance == amount_in
    // check for honest orders.
    const quantity = 12_345n * XLM_SCALE;
    const price = 987_654n;
    expect(computeEscrowAmount('buy', quantity, price)).toBe((quantity * price) / PRICE_SCALE);
    expect(computeEscrowAmount('sell', quantity, price)).toBe(quantity);
  });
});
