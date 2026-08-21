import { assertAccepted } from './soroban';

describe('assertAccepted', () => {
  it('accepts a queued transaction', () => {
    expect(() => assertAccepted('PENDING', 'abc')).not.toThrow();
  });

  it('accepts DUPLICATE — the same tx is already in flight, so the hash is real', () => {
    expect(() => assertAccepted('DUPLICATE', 'abc')).not.toThrow();
  });

  it('rejects TRY_AGAIN_LATER instead of returning a hash nobody queued', () => {
    expect(() => assertAccepted('TRY_AGAIN_LATER', 'abc')).toThrow(/never queued/);
  });

  it('rejects ERROR and keeps the RPC error result for the log', () => {
    expect(() => assertAccepted('ERROR', 'abc', { code: 'txBadSeq' })).toThrow(/txBadSeq/);
  });
});
