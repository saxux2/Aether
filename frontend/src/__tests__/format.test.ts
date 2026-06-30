import {
  formatPrice,
  formatXlm,
  formatUsdc,
  shortAddress,
  shortHash,
  relativeTime,
  statusColor,
} from '../utils/format';

describe('formatPrice', () => {
  it('converts micro-USDC bigint to 6-decimal string', () => {
    expect(formatPrice(135000n)).toBe('0.135000');
    expect(formatPrice(1000000n)).toBe('1.000000');
    expect(formatPrice(0n)).toBe('0.000000');
  });

  it('accepts number and string inputs', () => {
    expect(formatPrice(135000)).toBe('0.135000');
    expect(formatPrice('2500000')).toBe('2.500000');
  });
});

describe('formatXlm', () => {
  it('converts stroops bigint to XLM display', () => {
    // 10_000_000 stroops = 1 XLM
    expect(formatXlm(10_000_000n)).toBe('1');
    expect(formatXlm(500_000_000n)).toBe('50');
  });

  it('handles zero', () => {
    expect(formatXlm(0n)).toBe('0');
  });
});

describe('formatUsdc', () => {
  it('converts Stellar USDC units to display with 2dp', () => {
    // 10_000_000 units = 1 USDC
    expect(formatUsdc(10_000_000n)).toBe('1.00');
    expect(formatUsdc(675_000_000n)).toBe('67.50');
    expect(formatUsdc(25_000_000n)).toBe('2.50');
  });
});

describe('shortAddress', () => {
  it('abbreviates a full Stellar address', () => {
    const addr = 'GABC1234567890XYZW';
    expect(shortAddress(addr)).toBe('GABC...XYZW');
  });

  it('returns short inputs unchanged', () => {
    expect(shortAddress('GABC')).toBe('GABC');
    expect(shortAddress('')).toBe('');
  });
});

describe('shortHash', () => {
  it('abbreviates a long commitment hash', () => {
    const hash = '0xdeadbeefcafe0000111122223333';
    expect(shortHash(hash)).toBe('0xdeadbe...3333');
  });

  it('returns short hashes unchanged', () => {
    expect(shortHash('abc')).toBe('abc');
  });
});

describe('statusColor', () => {
  it('returns a non-empty class string for known statuses', () => {
    for (const s of ['active', 'matched', 'settled', 'expired', 'cancelled']) {
      expect(statusColor(s).length).toBeGreaterThan(0);
    }
  });

  it('returns the fallback class for unknown status', () => {
    const fallback = statusColor('unknown');
    expect(fallback).toBe('bg-fg/[0.05] text-fg/40 border border-hairline/15');
  });
});

describe('relativeTime', () => {
  it('returns "just now" for very recent timestamps', () => {
    const recent = new Date(Date.now() - 5000);
    expect(relativeTime(recent)).toBe('just now');
  });

  it('returns minutes-ago string for timestamps under 1 hour', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(relativeTime(fiveMinutesAgo)).toMatch(/^\d+m ago$/);
  });
});
