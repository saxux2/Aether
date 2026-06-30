'use client';

import { useState } from 'react';
import { useOrderBook, type BookLevel, type SettledTrade } from '@/hooks/useOrderBook';

const MAX_ROWS = 9; // levels shown per side

/* -------------------------------- helpers -------------------------------- */

function fmtQty(qty: number): string {
  return qty.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const dirColor = {
  up: 'text-market-up',
  down: 'text-market-down',
  flat: 'text-gray-300',
} as const;

const dirArrow = { up: '↑', down: '↓', flat: '' } as const;

/* ------------------------------ book row --------------------------------- */

function BookRow({
  level,
  side,
  cumPct,
}: {
  level: BookLevel;
  side: 'bid' | 'ask';
  cumPct: number;
}) {
  return (
    <div className="relative grid grid-cols-2 px-3 py-[3px] text-xs leading-4 hover:bg-white/[0.04] cursor-default">
      {/* depth bar, anchored right — Bybit style */}
      <div
        className={`absolute inset-y-0 right-0 pointer-events-none ${
          side === 'bid' ? 'bg-market-up/10' : 'bg-market-down/10'
        }`}
        style={{ width: `${Math.min(100, Math.max(0, cumPct))}%` }}
      />
      <span
        className={`relative font-mono tabular-nums ${
          side === 'bid' ? 'text-market-up' : 'text-market-down'
        }`}
      >
        {level.priceLabel}
      </span>
      <span className="relative font-mono tabular-nums text-right text-gray-300">
        {fmtQty(level.qty)}
      </span>
    </div>
  );
}

function SideFiller({ label }: { label: string }) {
  return (
    <div className="px-3 py-3 text-center text-[11px] text-gray-600">{label}</div>
  );
}

/* ----------------------------- order book tab ---------------------------- */

function OrderBookTab() {
  const { depth, trades, isLoadingDepth } = useOrderBook();

  if (isLoadingDepth) {
    return (
      <div className="py-12 text-center text-xs text-gray-500 animate-pulse">
        Loading order book…
      </div>
    );
  }

  const bids = depth?.bids.slice(0, MAX_ROWS) ?? []; // highest first
  const asks = depth?.asks.slice(0, MAX_ROWS) ?? []; // lowest first

  // Cumulative depth from the spread outward (Bybit-style bars).
  let acc = 0;
  const bidCum = bids.map((b) => (acc += b.qty));
  acc = 0;
  const askCum = asks.map((a) => (acc += a.qty));
  const maxCum = Math.max(bidCum[bidCum.length - 1] ?? 0, askCum[askCum.length - 1] ?? 0, 1e-9);

  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const spread = bestBid != null && bestAsk != null ? bestAsk - bestBid : null;
  const spreadPct =
    spread != null && bestAsk != null && bestAsk > 0 ? (spread / bestAsk) * 100 : null;

  const last = trades[0];
  const empty = bids.length === 0 && asks.length === 0;

  return (
    <div>
      {/* column header */}
      <div className="grid grid-cols-2 px-3 py-1.5 text-[11px] text-gray-500 border-b border-gray-800">
        <span>Price (USDC)</span>
        <span className="text-right">Qty (XLM)</span>
      </div>

      {empty ? (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-500">No resting orders</p>
          <p className="mt-1 text-[11px] text-gray-600">
            Sealed orders appear here as anonymized depth
          </p>
        </div>
      ) : (
        <>
          {/* asks — lowest ask adjacent to the spread (bottom of this block) */}
          <div className="flex flex-col-reverse">
            {asks.length === 0 ? (
              <SideFiller label="No asks" />
            ) : (
              asks.map((level, i) => (
                <BookRow
                  key={`a-${level.priceLabel}-${i}`}
                  level={level}
                  side="ask"
                  cumPct={(askCum[i] / maxCum) * 100}
                />
              ))
            )}
          </div>

          {/* spread / last price */}
          <div className="flex items-center justify-between px-3 py-2 border-y border-gray-800 bg-gray-950/60">
            <span
              className={`font-mono tabular-nums text-base font-semibold ${
                last ? dirColor[last.direction] : 'text-gray-300'
              }`}
            >
              {last ? (
                <>
                  {last.priceLabel}{' '}
                  <span className="text-xs">{dirArrow[last.direction]}</span>
                </>
              ) : (
                '—'
              )}
            </span>
            <span className="font-mono tabular-nums text-[11px] text-gray-500">
              {spread != null
                ? `Spread ${spread.toFixed(4)}${
                    spreadPct != null ? ` (${spreadPct.toFixed(2)}%)` : ''
                  }`
                : 'Spread —'}
            </span>
          </div>

          {/* bids — highest first */}
          <div className="flex flex-col">
            {bids.length === 0 ? (
              <SideFiller label="No bids" />
            ) : (
              bids.map((level, i) => (
                <BookRow
                  key={`b-${level.priceLabel}-${i}`}
                  level={level}
                  side="bid"
                  cumPct={(bidCum[i] / maxCum) * 100}
                />
              ))
            )}
          </div>
        </>
      )}

      {/* batch meta */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-gray-800 text-[11px] text-gray-500">
        <span>
          Batch <span className="font-mono tabular-nums text-gray-400">#{depth?.batchId ?? '—'}</span>
        </span>
        <span>
          <span className="font-mono tabular-nums text-gray-400">{depth?.activeOrderCount ?? 0}</span>{' '}
          sealed orders
        </span>
      </div>
    </div>
  );
}

/* ---------------------------- recent trades tab --------------------------- */

function TradeRow({ trade }: { trade: SettledTrade }) {
  return (
    <div className="grid grid-cols-3 px-3 py-[3px] text-xs leading-4 hover:bg-white/[0.04]">
      <span className={`font-mono tabular-nums ${dirColor[trade.direction]}`}>
        {trade.priceLabel}
        {trade.direction !== 'flat' && (
          <span className="ml-0.5 text-[10px]">{dirArrow[trade.direction]}</span>
        )}
      </span>
      <span className="font-mono tabular-nums text-right text-gray-300">
        {fmtQty(trade.qty)}
      </span>
      <span className="font-mono tabular-nums text-right text-gray-500">
        {fmtClock(trade.settledAt)}
      </span>
    </div>
  );
}

function RecentTradesTab() {
  const { trades, isLoadingTrades } = useOrderBook();

  if (isLoadingTrades) {
    return (
      <div className="py-12 text-center text-xs text-gray-500 animate-pulse">
        Loading trades…
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-3 px-3 py-1.5 text-[11px] text-gray-500 border-b border-gray-800">
        <span>Price (USDC)</span>
        <span className="text-right">Qty (XLM)</span>
        <span className="text-right">Time</span>
      </div>

      {trades.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-500">No settled trades yet</p>
          <p className="mt-1 text-[11px] text-gray-600">
            Trades are revealed after each batch auction settles
          </p>
        </div>
      ) : (
        <div className="max-h-[420px] overflow-y-auto">
          {trades.map((trade, i) => (
            <TradeRow key={`${trade.batchId}-${trade.settledAt}-${i}`} trade={trade} />
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- panel ---------------------------------- */

type Tab = 'book' | 'trades';

export function OrderBookPanel({
  defaultTab = 'book',
  className = '',
}: {
  defaultTab?: Tab;
  className?: string;
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'book', label: 'Order Book' },
    { id: 'trades', label: 'Recent Trades' },
  ];

  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-lg overflow-hidden ${className}`}>
      <div className="flex border-b border-gray-800">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative px-4 py-2.5 text-sm transition-colors ${
              tab === id
                ? 'text-white font-medium'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
            {tab === id && (
              <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-blue-500 rounded-full" />
            )}
          </button>
        ))}
        <span className="ml-auto self-center pr-3 text-[11px] text-gray-600">XLM/USDC</span>
      </div>

      {tab === 'book' ? <OrderBookTab /> : <RecentTradesTab />}
    </div>
  );
}
