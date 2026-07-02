'use client';

import { useTraderOrders } from '@/hooks/useTraderOrders';
import { useWallet } from '@/hooks/useWallet';
import { useOrders } from '@/hooks/useOrders';
import { useOrdersStore } from '@/store/ordersSlice';
import { useIsMobile } from '@/hooks/useIsMobile';
import { shortAddress, formatDateTime } from '@/utils/format';
import { mergeOrders, type MergedOrder } from '@/utils/mergeOrders';
import { MobileCard } from '@/components/mobile/MobileCard';
import { OrderList } from '@/components/mobile/OrderList';

function shortTx(hash: string): string {
  return hash.slice(0, 6) + '…' + hash.slice(-4);
}

function statusBadge(status: string) {
  if (status === 'active')
    return <span className="text-fg/45 text-xs font-medium uppercase tracking-wide">Active</span>;
  if (status === 'matched')
    return <span className="text-accent text-xs font-medium uppercase tracking-wide">Matched</span>;
  if (status === 'settled')
    return <span className="text-up text-xs font-medium uppercase tracking-wide">Settled</span>;
  if (status === 'expired')
    return <span className="text-fg/40 text-xs font-medium uppercase tracking-wide">Expired</span>;
  if (status === 'cancelled')
    return <span className="text-fg/40 text-xs font-medium uppercase tracking-wide">Cancelled</span>;
  return <span className="text-fg/45 text-xs font-medium uppercase tracking-wide">{status}</span>;
}

function SkeletonRow() {
  return (
    <tr>
      <td colSpan={9} className="px-4 py-4">
        <div className="animate-pulse h-4 bg-fg/[0.06] rounded" />
      </td>
    </tr>
  );
}

interface OrderTableProps {
  orders: MergedOrder[];
  showCancel: boolean;
  cancelOrder: (id: string) => void;
  isCancelling: boolean;
  emptyMessage: string;
  isLoading: boolean;
}

function OrderTable({ orders, showCancel, cancelOrder, isCancelling, emptyMessage, isLoading }: OrderTableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-fg/45 text-xs border-b border-hairline/10">
            <th className="text-left px-4 py-3 font-medium">Pair</th>
            <th className="text-left px-4 py-3 font-medium">Side</th>
            <th className="text-right px-4 py-3 font-medium">Price (USDC)</th>
            <th className="text-right px-4 py-3 font-medium">Qty (XLM)</th>
            <th className="text-right px-4 py-3 font-medium">Value (USDC)</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
            <th className="text-right px-4 py-3 font-medium">Batch #</th>
            <th className="text-left px-4 py-3 font-medium">Time</th>
            {showCancel ? (
              <th className="text-center px-4 py-3 font-medium">Action</th>
            ) : (
              <th className="text-left px-4 py-3 font-medium">Settlement Tx</th>
            )}
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            <SkeletonRow />
          ) : orders.length === 0 ? (
            <tr>
              <td colSpan={9} className="px-4 py-10 text-center text-fg/40 text-sm">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            orders.map((order) => (
              <tr
                key={order.commitment}
                className="border-b border-hairline/10 hover:bg-fg/[0.05] transition-colors"
              >
                <td className="px-4 py-3 text-fg font-mono text-xs">XLM/USDC</td>
                <td className="px-4 py-3">
                  {order.direction === 'buy' ? (
                    <span className="text-up font-semibold uppercase text-xs">Buy</span>
                  ) : (
                    <span className="text-down font-semibold uppercase text-xs">Sell</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-fg font-mono text-xs tabular-nums">
                  {order.price}
                </td>
                <td className="px-4 py-3 text-right text-fg font-mono text-xs tabular-nums">
                  {order.qty}
                  {order.refundedXlm && (
                    <span
                      className="block text-[10px] text-fg/40"
                      title={`${order.refundedXlm} XLM unfilled — refunded to your wallet`}
                    >
                      ↩ {order.refundedXlm} refunded
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-fg font-mono text-xs tabular-nums">
                  {order.value}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {statusBadge(order.status)}
                    {order.isPartial && (
                      <span className="text-[10px] uppercase tracking-wide text-accent bg-accent/10 px-1 py-0.5 rounded">
                        partial
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-fg/45 font-mono text-xs">
                  {order.batchId != null ? `#${order.batchId}` : '—'}
                </td>
                <td className="px-4 py-3 text-fg/45 text-xs whitespace-nowrap">
                  {formatDateTime(order.timeIso)}
                </td>
                {showCancel ? (
                  <td className="px-4 py-3 text-center">
                    {order.status === 'active' ? (
                      <button
                        onClick={() => cancelOrder(order.commitment)}
                        disabled={isCancelling}
                        className="text-xs px-3 py-1 rounded border border-down text-down hover:bg-down/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                    ) : (
                      <span className="text-fg/30 text-xs">—</span>
                    )}
                  </td>
                ) : (
                  <td className="px-4 py-3 text-xs">
                    {order.settlementTxHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${order.settlementTxHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline font-mono"
                      >
                        {shortTx(order.settlementTxHash)}
                      </a>
                    ) : (
                      <span className="text-fg/30">—</span>
                    )}
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function OrdersPage() {
  const isMobile = useIsMobile();
  const { connected, address } = useWallet();
  const { cancelOrder, isCancelling } = useOrders();
  const localOrders = useOrdersStore((s) => s.orders);

  const { data: apiOrders, isLoading } = useTraderOrders(address, connected);

  if (isMobile === null) return null;

  if (!connected) {
    return (
      <div className="w-full flex flex-col gap-6">
        <h1 className="text-2xl sm:text-3xl font-light tracking-tight text-fg" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>My Orders</h1>
        <div className="bg-panel border border-hairline/10 rounded-lg p-12 text-center">
          <p className="text-fg/45 text-sm mb-1">No wallet connected</p>
          <p className="text-fg/30 text-xs">Connect your Stellar wallet to view and manage your orders.</p>
        </div>
      </div>
    );
  }

  const { live: mergedLive, settled: mergedSettled } = mergeOrders(apiOrders, localOrders);

  if (isMobile) {
    return (
      <div className="w-full flex flex-col gap-3 pb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-light tracking-tight text-fg" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>My Orders</h1>
          {address && (
            <span className="text-fg/45 text-xs font-mono bg-panel border border-hairline/10 rounded px-2.5 py-1">
              {shortAddress(address)}
            </span>
          )}
        </div>

        <MobileCard noPadding>
          <div className="flex items-center gap-2 border-b border-hairline/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">Live Orders</h2>
            {!isLoading && mergedLive.length > 0 && (
              <span className="text-xs bg-accent/10 text-accent border border-accent/20 rounded-full px-2 py-0.5 font-medium">
                {mergedLive.length}
              </span>
            )}
          </div>
          <OrderList
            orders={mergedLive}
            showCancel
            cancelOrder={cancelOrder}
            isCancelling={isCancelling}
            emptyMessage="No live orders."
            emptySubtitle="Head to Trade to place an order."
          />
        </MobileCard>

        <MobileCard noPadding>
          <div className="flex items-center gap-2 border-b border-hairline/10 px-4 py-3">
            <h2 className="text-sm font-semibold text-fg">Settled Orders</h2>
            {!isLoading && mergedSettled.length > 0 && (
              <span className="text-xs bg-fg/[0.06] text-fg/45 border border-hairline/15 rounded-full px-2 py-0.5 font-medium">
                {mergedSettled.length}
              </span>
            )}
          </div>
          <OrderList orders={mergedSettled} emptyMessage="No settled orders yet." />
        </MobileCard>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-light tracking-tight text-fg" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>My Orders</h1>
        {address && (
          <span className="text-fg/45 text-sm font-mono bg-panel border border-hairline/10 rounded px-3 py-1">
            {shortAddress(address)}
          </span>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-fg">Live Orders</h2>
          {!isLoading && mergedLive.length > 0 && (
            <span className="text-xs bg-accent/10 text-accent border border-accent/20 rounded-full px-2 py-0.5 font-medium">
              {mergedLive.length}
            </span>
          )}
        </div>
        <div className="bg-panel border border-hairline/10 rounded-lg overflow-hidden">
          <OrderTable
            orders={mergedLive}
            showCancel={true}
            cancelOrder={cancelOrder}
            isCancelling={isCancelling}
            emptyMessage="No live orders. Head to Trade to place an order."
            isLoading={isLoading}
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-fg">Settled Orders</h2>
          {!isLoading && mergedSettled.length > 0 && (
            <span className="text-xs bg-fg/[0.06] text-fg/45 border border-hairline/15 rounded-full px-2 py-0.5 font-medium">
              {mergedSettled.length}
            </span>
          )}
        </div>
        <div className="bg-panel border border-hairline/10 rounded-lg overflow-hidden">
          <OrderTable
            orders={mergedSettled}
            showCancel={false}
            cancelOrder={cancelOrder}
            isCancelling={isCancelling}
            emptyMessage="No settled orders yet."
            isLoading={isLoading}
          />
        </div>
      </section>
    </div>
  );
}
