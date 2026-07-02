'use client';

import { useState } from 'react';
import { useOrders } from '@/hooks/useOrders';
import { useOrderBook } from '@/hooks/useOrderBook';
import { useWallet } from '@/hooks/useWallet';
import { useTraderOrders } from '@/hooks/useTraderOrders';
import { mergeOrders, type MergedOrder } from '@/utils/mergeOrders';

type Tab = 'open' | 'history' | 'trades';

function timeHMS(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB', { hour12: false });
}

function shortTx(hash: string): string {
  return `${hash.slice(0, 4)}…${hash.slice(-2)}`;
}

function statusClass(status: string): string {
  switch (status) {
    case 'matched':
      return 'text-accent';
    case 'settled':
      return 'text-up';
    case 'cancelled':
      return 'text-down';
    case 'expired':
      return 'text-fg/40';
    default:
      return 'text-fg/55'; // active
  }
}

function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6">
      <p className="text-xs text-fg/40">{title}</p>
      {subtitle && <p className="text-[11px] text-fg/30">{subtitle}</p>}
    </div>
  );
}

function ErrorState({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-6">
      <p className="text-xs text-down">{title}</p>
      <p className="text-[11px] text-fg/30">The relayer may be unreachable or waking up</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 text-[11px] text-accent hover:underline"
      >
        Retry
      </button>
    </div>
  );
}

const OPEN_GRID =
  'grid grid-cols-[80px_50px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_80px_60px_80px_60px] items-center gap-2 px-3';
const HISTORY_GRID =
  'grid grid-cols-[80px_50px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_80px_60px_80px] items-center gap-2 px-3';
const TRADES_GRID =
  'grid grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_60px_80px_80px] items-center gap-2 px-3';

export function OrdersStrip() {
  const { orders: localOrders, cancelOrder, isCancelling } = useOrders();
  const { trades, tradesError, refetchTrades } = useOrderBook();
  const { address, connected } = useWallet();
  const { data: apiOrders, isLoading: ordersLoading } = useTraderOrders(address, connected);
  const [tab, setTab] = useState<Tab>('open');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Durable order data: relayer-confirmed orders (by wallet) merged with any
  // locally-submitted orders the relayer hasn't indexed yet. This is the same
  // source the Portfolio and mobile views use, so Open Orders / Order History
  // survive a page refresh instead of resetting with the in-memory store.
  const { live: openOrders, settled: historyOrders } = mergeOrders(apiOrders, localOrders);

  const handleCancel = async (commitment: string) => {
    setCancellingId(commitment);
    try {
      await cancelOrder(commitment);
    } catch {
      // surfaced via relayer poll; keep strip resilient
    } finally {
      setCancellingId(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'open', label: `Open Orders (${openOrders.length})` },
    { key: 'history', label: 'Order History' },
    { key: 'trades', label: 'Trade History' },
  ];

  // Shared not-connected / loading guard for the two wallet-scoped tabs.
  const ownOrdersGuard =
    !connected ? (
      <EmptyState
        title="Connect your wallet to view your orders"
        subtitle="Open orders and history are scoped to your wallet address"
      />
    ) : ordersLoading && !apiOrders ? (
      <EmptyState title="Loading your orders…" />
    ) : null;

  return (
    <div className="flex h-56 flex-col bg-panel">
      {/* Tabs */}
      <div className="flex h-9 items-stretch border-b border-hairline/10 px-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`relative px-3 text-[13px] transition-colors ${
              tab === t.key ? 'font-medium text-fg' : 'text-fg/40 hover:text-fg/55'
            }`}
          >
            {t.label}
            {tab === t.key && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
        <span className="ml-auto self-center pr-3 text-[11px] text-fg/30">
          XLM/USDC · Dark Pool
        </span>
      </div>

      {/* Open Orders */}
      {tab === 'open' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="flex min-h-full min-w-[760px] flex-col">
            <div
              className={`${OPEN_GRID} sticky top-0 z-10 border-b border-hairline/10 bg-panel py-1.5 text-[11px] text-fg/40`}
            >
              <span>Pair</span>
              <span>Side</span>
              <span className="text-right">Price</span>
              <span className="text-right">Qty (XLM)</span>
              <span className="text-right">Order Value (USDC)</span>
              <span>Status</span>
              <span className="text-right">Batch</span>
              <span className="text-right">Time</span>
              <span className="text-right" />
            </div>
            {ownOrdersGuard ??
              (openOrders.length === 0 ? (
                <EmptyState title="No open orders" subtitle="Sealed orders you place appear here" />
              ) : (
                openOrders.map((o: MergedOrder) => {
                  const rowCancelling = cancellingId === o.commitment && isCancelling;
                  return (
                    <div
                      key={o.commitment}
                      className={`${OPEN_GRID} py-1.5 text-xs hover:bg-fg/[0.05]`}
                    >
                      <span className="text-fg/55">XLM/USDC</span>
                      <span className={o.direction === 'buy' ? 'text-up' : 'text-down'}>
                        {o.direction === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/70">
                        {Number(o.price).toFixed(4)}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/70">
                        {Number(o.qty).toLocaleString('en-US', { maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/70">
                        {Number(o.value).toFixed(2)}
                      </span>
                      <span className={`capitalize ${statusClass(o.status)}`}>{o.status}</span>
                      <span className="text-right font-mono tabular-nums text-fg/45">
                        {o.batchId ?? '—'}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/45">
                        {timeHMS(o.timeIso)}
                      </span>
                      {o.status === 'active' ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(o.commitment)}
                          disabled={rowCancelling}
                          className="text-right text-[11px] text-fg/40 transition-colors hover:text-down disabled:opacity-50"
                        >
                          {rowCancelling ? 'Cancelling…' : 'Cancel'}
                        </button>
                      ) : (
                        <span className="text-right text-[11px] text-fg/30">—</span>
                      )}
                    </div>
                  );
                })
              ))}
          </div>
        </div>
      )}

      {/* Order History */}
      {tab === 'history' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="flex min-h-full min-w-[700px] flex-col">
            <div
              className={`${HISTORY_GRID} sticky top-0 z-10 border-b border-hairline/10 bg-panel py-1.5 text-[11px] text-fg/40`}
            >
              <span>Pair</span>
              <span>Side</span>
              <span className="text-right">Price</span>
              <span className="text-right">Qty (XLM)</span>
              <span className="text-right">Order Value (USDC)</span>
              <span>Status</span>
              <span className="text-right">Batch</span>
              <span className="text-right">Time</span>
            </div>
            {ownOrdersGuard ??
              (historyOrders.length === 0 ? (
                <EmptyState
                  title="No order history yet"
                  subtitle="Settled, expired, and cancelled orders appear here"
                />
              ) : (
                historyOrders.map((o: MergedOrder) => {
                  const filled = Number(o.qty);
                  const refunded = o.refundedXlm ? Number(o.refundedXlm) : 0;
                  const original = filled + refunded;
                  const cells = (
                    <>
                      <span className="text-fg/55">XLM/USDC</span>
                      <span className={o.direction === 'buy' ? 'text-up' : 'text-down'}>
                        {o.direction === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/70">
                        {Number(o.price).toFixed(4)}
                      </span>
                      <span
                        className="text-right font-mono tabular-nums text-fg/70"
                        title={
                          refunded > 0
                            ? `Filled ${filled.toLocaleString('en-US', { maximumFractionDigits: 2 })} of ${original.toLocaleString('en-US', { maximumFractionDigits: 2 })} XLM — ${refunded.toLocaleString('en-US', { maximumFractionDigits: 2 })} refunded`
                            : undefined
                        }
                      >
                        {filled.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        {refunded > 0 && (
                          <span className="ml-1 text-[10px] text-fg/40">
                            /{original.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/70">
                        {Number(o.value).toFixed(2)}
                      </span>
                      <span className={`capitalize ${statusClass(o.status)}`}>
                        {o.isPartial ? 'partial' : o.status}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/45">
                        {o.batchId ?? '—'}
                      </span>
                      <span className="text-right font-mono tabular-nums text-fg/45">
                        {timeHMS(o.timeIso)}
                      </span>
                    </>
                  );
                  return o.settlementTxHash ? (
                    <a
                      key={o.commitment}
                      href={`https://stellar.expert/explorer/testnet/tx/${o.settlementTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${HISTORY_GRID} py-1.5 text-xs hover:bg-fg/[0.05]`}
                    >
                      {cells}
                    </a>
                  ) : (
                    <div
                      key={o.commitment}
                      className={`${HISTORY_GRID} py-1.5 text-xs hover:bg-fg/[0.05]`}
                    >
                      {cells}
                    </div>
                  );
                })
              ))}
          </div>
        </div>
      )}

      {/* Trade History (market-wide settled tape) */}
      {tab === 'trades' && (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <div className="flex min-h-full min-w-[620px] flex-col">
            <div
              className={`${TRADES_GRID} sticky top-0 z-10 border-b border-hairline/10 bg-panel py-1.5 text-[11px] text-fg/40`}
            >
              <span>Pair</span>
              <span className="text-right">Price</span>
              <span className="text-right">Qty (XLM)</span>
              <span className="text-right">Value (USDC)</span>
              <span className="text-right">Batch</span>
              <span className="text-right">Settled</span>
              <span className="text-right">Tx</span>
            </div>
            {tradesError ? (
              <ErrorState title="Failed to load trades" onRetry={() => refetchTrades()} />
            ) : trades.length === 0 ? (
              <EmptyState title="No settled trades yet" />
            ) : (
              trades.map((t, i) => {
                const value = t.usdc ?? t.price * t.qty;
                const priceColor =
                  t.direction === 'up'
                    ? 'text-up'
                    : t.direction === 'down'
                      ? 'text-down'
                      : 'text-fg/55';
                return (
                  <div
                    key={`${t.batchId ?? 'b'}-${t.settledAt}-${i}`}
                    className={`${TRADES_GRID} py-1.5 text-xs hover:bg-fg/[0.05]`}
                  >
                    <span className="text-fg/55">XLM/USDC</span>
                    <span className={`text-right font-mono tabular-nums ${priceColor}`}>
                      {t.priceLabel}
                    </span>
                    <span className="text-right font-mono tabular-nums text-fg/70">
                      {t.qty.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-right font-mono tabular-nums text-fg/70">
                      {value.toFixed(2)}
                    </span>
                    <span className="text-right font-mono tabular-nums text-fg/45">
                      {t.batchId ?? '—'}
                    </span>
                    <span className="text-right font-mono tabular-nums text-fg/45">
                      {timeHMS(t.settledAt)}
                    </span>
                    {t.txHash ? (
                      <a
                        href={`https://stellar.expert/explorer/testnet/tx/${t.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-right font-mono tabular-nums text-accent hover:underline"
                      >
                        {shortTx(t.txHash)}
                      </a>
                    ) : (
                      <span className="text-right font-mono text-fg/30">—</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
