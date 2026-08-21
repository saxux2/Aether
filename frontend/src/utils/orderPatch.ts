import type { LocalOrder } from '@/store/ordersSlice';

/**
 * Build a LocalOrder patch from a relayer order-status response.
 * Written defensively: field names vary between relayer versions
 * (stellar_tx_hash vs tx_hash, settlement_price may be absent).
 */
export function patchFromServer(
  data: Record<string, unknown> | undefined
): Partial<LocalOrder> | null {
  if (!data) return null;
  const patch: Partial<LocalOrder> = {};
  if (typeof data.status === 'string') patch.status = data.status;
  if (typeof data.settled_at === 'string') patch.settledAt = data.settled_at;
  // Prefer the on-chain SETTLEMENT tx for the history link; fall back to the
  // order's submit tx only if no settlement tx is reported yet.
  const txHash = data.settlement_tx_hash ?? data.stellar_tx_hash ?? data.tx_hash;
  if (typeof txHash === 'string' && txHash.length > 0) patch.settlementTxHash = txHash;
  const price = data.settlement_price ?? data.fill_price;
  if (typeof price === 'string' && price.length > 0) {
    patch.settlementPrice = price.replace(/[^0-9.]/g, '');
  }
  if (typeof data.filled_xlm === 'string') patch.filledXlm = data.filled_xlm;
  if (typeof data.refunded_xlm === 'string') patch.refundedXlm = data.refunded_xlm;
  if (typeof data.is_partial === 'boolean') patch.isPartial = data.is_partial;
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Does this patch actually change the order?
 *
 * The poll loop's old guard was `patch.status !== o.status ||
 * patch.settlementTxHash || patch.settledAt` — the last two test whether the
 * field is *present*, not whether it differs. patchFromServer fills
 * settlementTxHash from `stellar_tx_hash`, the order's own submit hash, which
 * every order carries from the moment it exists. So the guard was true on
 * every poll for every non-final order, and each pass wrote an identical
 * patch into the store.
 *
 * That write is what made it expensive: updateOrder rebuilds the orders array
 * with .map(), so the store's reference changes even for a no-op patch, which
 * re-ran the polling effect, which polls immediately on mount — a tight
 * request loop against the relayer for as long as any order was in flight.
 * Comparing values instead of presence makes a no-op patch a no-op write.
 */
export function hasOrderChanges(order: LocalOrder, patch: Partial<LocalOrder>): boolean {
  return (Object.keys(patch) as Array<keyof LocalOrder>).some(
    (key) => patch[key] !== undefined && patch[key] !== order[key]
  );
}
