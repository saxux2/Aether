'use client';

import { useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { formatXlm, formatPrice, statusColor, shortHash, relativeTime } from '@/utils/format';
import { explorerTxUrl } from '@/utils/constants';
import type { LocalOrder } from '@/store/ordersSlice';

interface Props {
  order: LocalOrder;
}

export function OrderCard({ order }: Props) {
  const { cancelOrder, isCancelling } = useOrders();
  const [cancelError, setCancelError] = useState<string | null>(null);
  const isSettled = order.status === 'settled';

  const handleCancel = async () => {
    setCancelError(null);
    try {
      await cancelOrder(order.id);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Failed to cancel order');
    }
  };

  return (
    <div
      className={`bg-gray-900 border rounded-lg p-4 flex flex-col gap-2 ${
        isSettled ? 'border-market-up/40' : 'border-gray-800'
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            order.direction === 'buy'
              ? 'bg-market-up/15 text-market-up border border-market-up/30'
              : 'bg-market-down/15 text-market-down border border-market-down/30'
          }`}
        >
          {order.direction.toUpperCase()}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${statusColor(order.status)}`}>
          {isSettled ? '✓ Settled' : order.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <span className="text-gray-400">Qty</span>
        <span className="text-white font-mono tabular-nums">{formatXlm(order.quantity)} XLM</span>
        <span className="text-gray-400">Limit price</span>
        <span className="text-white font-mono tabular-nums">{formatPrice(order.price)} USDC</span>
        <span className="text-gray-400">Commitment</span>
        <span className="text-gray-300 font-mono text-xs">{shortHash(order.commitment)}</span>
        <span className="text-gray-400">Batch</span>
        <span className="text-gray-300 font-mono tabular-nums">{order.batchId ?? '—'}</span>
        <span className="text-gray-400">Created</span>
        <span className="text-gray-300">{relativeTime(order.createdAt)}</span>
      </div>

      {isSettled && (
        <div className="mt-1 rounded-md bg-market-up/5 border border-market-up/20 px-3 py-2 flex flex-col gap-1 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-market-up font-medium">Settlement</span>
            <span className="text-gray-400">
              {order.settledAt ? relativeTime(order.settledAt) : 'confirmed'}
            </span>
          </div>
          {order.settlementPrice && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Settled price</span>
              <span className="text-white font-mono tabular-nums">
                {order.settlementPrice} USDC
              </span>
            </div>
          )}
          {order.batchId != null && (
            <div className="flex items-center justify-between">
              <span className="text-gray-400">Batch auction</span>
              <span className="text-gray-300 font-mono tabular-nums">#{order.batchId}</span>
            </div>
          )}
          {order.settlementTxHash ? (
            <a
              href={explorerTxUrl(order.settlementTxHash)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300 hover:underline font-mono"
            >
              {shortHash(order.settlementTxHash)} · view on stellar.expert ↗
            </a>
          ) : (
            <span className="text-gray-500">On-chain settlement tx pending…</span>
          )}
        </div>
      )}

      {order.status === 'active' && (
        <>
          <button
            onClick={handleCancel}
            disabled={isCancelling}
            className="mt-1 w-full py-1.5 text-xs bg-market-down/10 hover:bg-market-down/20 text-market-down border border-market-down/30 rounded transition-colors disabled:opacity-50"
          >
            {isCancelling ? 'Cancelling...' : 'Cancel Order'}
          </button>
          {cancelError && <p className="text-xs text-market-down">{cancelError}</p>}
        </>
      )}
    </div>
  );
}
