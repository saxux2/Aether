import { patchFromServer, hasOrderChanges } from '../utils/orderPatch';
import type { LocalOrder } from '../store/ordersSlice';

const order: LocalOrder = {
  id: 'local-1',
  commitment: '0xabc',
  nullifier: '0xdef',
  direction: 'buy',
  quantity: 1_000_000_000n,
  price: 123_500n,
  status: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  salt: 7n,
  settlementTxHash: 'submit-tx-hash',
};

describe('patchFromServer', () => {
  it('falls back to the order submit hash when no settlement tx exists yet', () => {
    const patch = patchFromServer({ status: 'active', stellar_tx_hash: 'submit-tx-hash' });
    expect(patch).toEqual({ status: 'active', settlementTxHash: 'submit-tx-hash' });
  });

  it('prefers the settlement tx over the submit tx', () => {
    const patch = patchFromServer({
      stellar_tx_hash: 'submit-tx-hash',
      settlement_tx_hash: 'settle-tx-hash',
    });
    expect(patch?.settlementTxHash).toBe('settle-tx-hash');
  });

  it('strips currency formatting from a settlement price', () => {
    expect(patchFromServer({ settlement_price: '$0.123456' })?.settlementPrice).toBe('0.123456');
  });

  it('returns null when the response carries nothing usable', () => {
    expect(patchFromServer({})).toBeNull();
    expect(patchFromServer(undefined)).toBeNull();
  });
});

describe('hasOrderChanges', () => {
  it('reports no change for a patch that restates what the order already holds', () => {
    // The regression: every poll of a live order produced exactly this patch,
    // because stellar_tx_hash is present from submission onward. Treating a
    // present field as a change wrote to the store on every tick, which
    // changed the store array identity and re-triggered the polling effect.
    const patch = patchFromServer({ status: 'active', stellar_tx_hash: 'submit-tx-hash' });
    expect(patch).not.toBeNull();
    expect(hasOrderChanges(order, patch!)).toBe(false);
  });

  it('reports a change when the status actually advances', () => {
    expect(hasOrderChanges(order, { status: 'matched' })).toBe(true);
  });

  it('reports a change when settlement details arrive for the first time', () => {
    expect(hasOrderChanges(order, { settlementTxHash: 'settle-tx-hash' })).toBe(true);
    expect(hasOrderChanges(order, { settledAt: '2026-01-02T00:00:00.000Z' })).toBe(true);
  });

  it('ignores undefined fields rather than treating them as a clear', () => {
    expect(hasOrderChanges(order, { settledAt: undefined })).toBe(false);
  });

  it('reports no change for an empty patch', () => {
    expect(hasOrderChanges(order, {})).toBe(false);
  });
});
