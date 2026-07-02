'use client';

import type { MergedOrder } from '@/utils/mergeOrders';
import { formatDateTime } from '@/utils/format';

interface OrderListProps {
  orders: MergedOrder[];
  showCancel?: boolean;
  cancelOrder?: (id: string) => void;
  isCancelling?: boolean;
  emptyMessage: string;
  emptySubtitle?: string;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'matched':
      return 'bg-accent/10 text-accent';
    case 'settled':
      return 'bg-up/10 text-up';
    case 'cancelled':
      return 'bg-down/10 text-down';
    case 'expired':
      return 'bg-fg/[0.06] text-fg/40';
    default:
      return 'bg-fg/[0.06] text-fg/50';
  }
}

/** Compact, card-friendly order list shared by the mobile Trade and Orders views. */
export function OrderList({
  orders,
  showCancel,
  cancelOrder,
  isCancelling,
  emptyMessage,
  emptySubtitle,
}: OrderListProps) {
  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
        <p className="text-sm text-fg/40">{emptyMessage}</p>
        {emptySubtitle && <p className="text-xs text-fg/30">{emptySubtitle}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-hairline/8">
      {orders.map((o) => (
        <div key={o.commitment} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold uppercase ${
                  o.direction === 'buy' ? 'text-up' : 'text-down'
                }`}
              >
                {o.direction}
              </span>
              <span className="text-xs text-fg/40">XLM/USDC</span>
              {o.isPartial && (
                <span className="rounded bg-accent/10 px-1 py-0.5 text-[10px] uppercase text-accent">
                  partial
                </span>
              )}
            </div>
            <span className="font-mono text-xs text-fg/55">
              {o.qty} XLM @ {o.price}
              {o.refundedXlm && (
                <span className="ml-1.5 text-fg/35">↩ {o.refundedXlm} refunded</span>
              )}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${statusBadgeClass(
                o.status
              )}`}
            >
              {o.status}
            </span>
            {showCancel && o.status === 'active' ? (
              <button
                type="button"
                onClick={() => cancelOrder?.(o.commitment)}
                disabled={isCancelling}
                className="text-[11px] text-down/70 transition-colors hover:text-down disabled:opacity-40"
              >
                Cancel
              </button>
            ) : (
              <span className="text-[11px] text-fg/30">{formatDateTime(o.timeIso)}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
