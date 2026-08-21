/**
 * Price bucketing for the public depth chart.
 *
 * Depth is published in $0.0005 buckets so an individual resting order's exact
 * limit price stays private (see routes/orderbook.ts). Which way a bucket
 * rounds is not cosmetic: the bucket price is what the UI prints as the price
 * you could trade at.
 */
export const BUCKET_SIZE = 500n; // $0.0005 in micro-USDC

/**
 * Round a limit price into its display bucket, away from the trader reading it.
 *
 * Both sides used to floor, which is only conservative for one of them:
 *
 *   - A bid is someone willing to BUY at p. Flooring 0.123700 to 0.123500
 *     understates what that buyer would pay, so a seller reading the book
 *     expects less than they would actually get. Safe.
 *   - An ask is someone willing to SELL at p. Flooring 0.123700 to 0.123500
 *     advertises a seller at a price no seller will accept. A buyer sizing an
 *     order off the chart picks a limit two ticks below the real best ask, the
 *     batch does not cross, and the order rests unfilled for reasons nothing in
 *     the UI explains.
 *
 * So bids floor and asks ceil: every published level is a price at least as bad
 * as the real one, never better. A price already on a bucket boundary is exact
 * and stays put.
 */
export function bucketPrice(price: bigint, side: 'bids' | 'asks'): bigint {
  const floor = (price / BUCKET_SIZE) * BUCKET_SIZE;
  if (side === 'bids' || floor === price) return floor;
  return floor + BUCKET_SIZE;
}
