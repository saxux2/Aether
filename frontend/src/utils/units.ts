/**
 * Base-unit conversions, dependency-free so both the Horizon layer and the
 * transaction builders can use them without importing each other.
 */

/** Horizon always reports balances with exactly 7 decimal places. */
export function decimalToBaseUnits(decimal: string): bigint {
  const negative = decimal.startsWith('-');
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, frac = ''] = unsigned.split('.');
  const fracPadded = frac.padEnd(7, '0').slice(0, 7);
  const units = BigInt(whole || '0') * 10_000_000n + BigInt(fracPadded || '0');
  return negative ? -units : units;
}
