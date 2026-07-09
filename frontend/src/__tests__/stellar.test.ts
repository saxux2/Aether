import { decimalToBaseUnits } from '../utils/stellar';

describe('decimalToBaseUnits', () => {
  it('converts a whole-number Horizon balance to stroops', () => {
    expect(decimalToBaseUnits('100.0000000')).toBe(1_000_000_000n);
  });

  it('converts a fractional balance to stroops', () => {
    expect(decimalToBaseUnits('1.5000000')).toBe(15_000_000n);
  });

  it('handles a balance with no decimal point', () => {
    expect(decimalToBaseUnits('42')).toBe(420_000_000n);
  });

  it('handles zero', () => {
    expect(decimalToBaseUnits('0.0000000')).toBe(0n);
  });

  it('truncates rather than rounds fractional digits beyond 7 places', () => {
    expect(decimalToBaseUnits('1.00000009')).toBe(10_000_000n);
  });

  it('handles a negative balance defensively (should not occur from Horizon, but should not throw)', () => {
    expect(decimalToBaseUnits('-5.5000000')).toBe(-55_000_000n);
  });
});
