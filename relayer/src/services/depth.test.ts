import { bucketPrice, BUCKET_SIZE } from './depth';

describe('bucketPrice', () => {
  it('floors a bid so it never overstates what a buyer will pay', () => {
    expect(bucketPrice(123_700n, 'bids')).toBe(123_500n);
  });

  it('ceils an ask so it never advertises a seller that does not exist', () => {
    // Flooring here would print $0.1235 while the only seller wants $0.1237.
    expect(bucketPrice(123_700n, 'asks')).toBe(124_000n);
  });

  it('leaves a price already on a bucket boundary exact on both sides', () => {
    expect(bucketPrice(123_500n, 'bids')).toBe(123_500n);
    expect(bucketPrice(123_500n, 'asks')).toBe(123_500n);
  });

  it('never publishes a level better than the real order', () => {
    for (let p = 100_000n; p < 100_020n; p++) {
      expect(bucketPrice(p, 'bids')).toBeLessThanOrEqual(p);
      expect(bucketPrice(p, 'asks')).toBeGreaterThanOrEqual(p);
    }
  });

  it('keeps every bucket on a BUCKET_SIZE boundary', () => {
    for (const side of ['bids', 'asks'] as const) {
      for (let p = 1n; p < 40n; p++) {
        expect(bucketPrice(p * 137n, side) % BUCKET_SIZE).toBe(0n);
      }
    }
  });
});
