import type { ApiOrder } from '@/hooks/useTraderOrders';
import type { LocalOrder } from '@/store/ordersSlice';

const LIVE_STATUSES = new Set(['active', 'matched']);
const SETTLED_STATUSES = new Set(['settled', 'expired', 'cancelled']);

export interface MergedOrder {
  commitment: string;
  direction: 'buy' | 'sell';
  status: string;
  price: string;
  qty: string;
  value: string;
  batchId: number | null;
  timeIso: string | null;
  settlementTxHash: string | null;
  isLive: boolean;
  isPartial: boolean;
  refundedXlm: string | null;
}

function apiOrderQty(o: ApiOrder): string {
  // Show the FILLED amount once settled (partial fills trade less than ordered).
  const filled = parseFloat(o.filled_xlm ?? '0');
  if (o.status === 'settled' && filled > 0) return o.filled_xlm;
  return o.xlm_amount;
}

function apiOrderPrice(o: ApiOrder): string {
  return o.settlement_price ?? (Number(o.revealed_price) / 1e6).toFixed(4);
}

function apiOrderValue(o: ApiOrder): string {
  if (o.usdc_amount) return o.usdc_amount;
  const qty = parseFloat(apiOrderQty(o));
  const px = Number(o.revealed_price) / 1e6;
  return (qty * px).toFixed(2);
}

function toMergedFromApi(o: ApiOrder, forLive: boolean): MergedOrder {
  const refunded = parseFloat(o.refunded_xlm ?? '0');
  return {
    commitment: o.commitment,
    direction: o.direction,
    status: o.status,
    price: apiOrderPrice(o),
    qty: apiOrderQty(o),
    value: apiOrderValue(o),
    batchId: o.batch_id ?? null,
    timeIso: forLive ? o.submitted_at : o.settled_at,
    settlementTxHash: o.settlement_tx_hash,
    isLive: forLive,
    isPartial: o.is_partial,
    refundedXlm: o.is_partial && refunded > 0 ? o.refunded_xlm : null,
  };
}

/**
 * Merge relayer-confirmed orders (`apiOrders`) with locally-submitted orders
 * the relayer hasn't indexed yet, into live/settled buckets. Local orders
 * are dropped once the relayer starts reporting the same commitment.
 */
export function mergeOrders(
  apiOrders: ApiOrder[] | undefined,
  localOrders: LocalOrder[]
): { live: MergedOrder[]; settled: MergedOrder[] } {
  const apiByCommitment = new Map<string, ApiOrder>(
    (apiOrders ?? []).map((o) => [o.commitment, o])
  );
  const localOnlyCommitments = new Set(
    localOrders.map((o) => o.commitment).filter((c) => !apiByCommitment.has(c))
  );

  const live: MergedOrder[] = [];
  const settled: MergedOrder[] = [];

  for (const o of apiOrders ?? []) {
    const merged = toMergedFromApi(o, LIVE_STATUSES.has(o.status));
    if (LIVE_STATUSES.has(o.status)) live.push(merged);
    else if (SETTLED_STATUSES.has(o.status)) settled.push(merged);
  }

  for (const lo of localOrders) {
    if (!localOnlyCommitments.has(lo.commitment)) continue;
    const isLive = LIVE_STATUSES.has(lo.status);
    const merged: MergedOrder = {
      commitment: lo.commitment,
      direction: lo.direction,
      status: lo.status,
      price: lo.settlementPrice ?? (Number(lo.price) / 1e6).toFixed(4),
      qty: (Number(lo.quantity) / 1e7).toFixed(2),
      value: ((Number(lo.quantity) / 1e7) * (Number(lo.price) / 1e6)).toFixed(2),
      batchId: lo.batchId ?? null,
      timeIso: isLive ? lo.createdAt : lo.settledAt ?? null,
      settlementTxHash: lo.settlementTxHash ?? null,
      isLive,
      isPartial: lo.isPartial ?? false,
      refundedXlm: lo.isPartial && lo.refundedXlm ? lo.refundedXlm : null,
    };
    if (isLive) live.push(merged);
    else if (SETTLED_STATUSES.has(lo.status)) settled.push(merged);
  }

  return { live, settled };
}
