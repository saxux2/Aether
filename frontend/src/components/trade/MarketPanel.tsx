'use client';

import { useState } from 'react';
import { useOrderBook, type BookLevel, type SettledTrade } from '@/hooks/useOrderBook';

const MAX_ROWS = 11; // levels shown per side

/* -------------------------------- helpers -------------------------------- */

function fmtQty(qty: number): string {
  return qty.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtValue(trade: SettledTrade): string {
  const value = trade.usdc ?? trade.qty * trade.price;
  return value.toLocaleString('en-US', {
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
  up: 'text-up',
  down: 'text-down',
  flat: 'text-fg/55',
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
    <div className="relative grid grid-cols-2 px-3 py-[3px] text-xs leading-4 hover:bg-fg/[0.05] cursor-default">
      {/* cumulative depth bar, anchored right */}
      <div
        className={`absolute inset-y-0 right-0 pointer-events-none ${
          side === 'bid' ? 'bg-up/10' : 'bg-down/10'
        }`}
        style={{ width: `${Math.min(100, Math.max(0, cumPct))}%` }}
      />
      <span
        className={`relative font-mono tabular-nums ${
          side === 'bid' ? 'text-up' : 'text-down'
        }`}
      >
        {level.priceLabel}
      </span>
      <span className="relative font-mono tabular-nums text-right text-fg/55">
        {fmtQty(level.qty)}
      </span>
    </div>
  );
}

function SideFiller({ label }: { label: string }) {
  return (
    <div className="px-3 py-3 text-center text-[11px] text-fg/30">{label}</div>
  );
}

function ErrorFiller({ label, onRetry }: { label: string; onRetry: () => void }) {
  return (
    <div className="flex-1 py-12 text-center">
      <p className="text-sm text-down">{label}</p>
      <p className="mt-1 text-[11px] text-fg/30">The relayer may be unreachable or waking up</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 text-[11px] text-accent hover:underline"
      >
        Retry
      </button>
    </div>
  );
}

/* ----------------------------- order book tab ---------------------------- */

function OrderBookTab() {
  const { depth, trades, isLoadingDepth, depthError, refetchDepth } = useOrderBook();

  if (isLoadingDepth) {
    return (
      <div className="flex-1 py-12 text-center text-xs text-fg/40 animate-pulse">
        Loading order book…
      </div>
    );
  }

  if (depthError) {
    return <ErrorFiller label="Failed to load order book" onRetry={() => refetchDepth()} />;
  }

  const bids = depth?.bids.slice(0, MAX_ROWS) ?? []; // highest first
  const asks = depth?.asks.slice(0, MAX_ROWS) ?? []; // lowest first

  // Cumulative depth from the spread outward.
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
    <div className="flex min-h-0 flex-1 flex-col">
      {/* column header */}
      <div className="grid grid-cols-2 px-3 py-1.5 text-[11px] text-fg/40">
        <span>Price (USDC)</span>
        <span className="text-right">Qty (XLM)</span>
      </div>

      {empty ? (
        <div className="flex-1 py-12 text-center">
          <p className="text-sm text-fg/40">No resting orders</p>
          <p className="mt-1 text-[11px] text-fg/30">
            Sealed orders appear as anonymized depth
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
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
          <div className="flex items-center justify-between border-y border-hairline/10 bg-fg/[0.03] px-3 py-2">
            <span
              className={`font-mono tabular-nums text-base font-semibold ${
                last ? dirColor[last.direction] : 'text-fg/55'
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
            <span className="font-mono tabular-nums text-[11px] text-fg/40">
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
        </div>
      )}

      {/* batch meta */}
      <div className="flex items-center justify-between border-t border-hairline/10 px-3 py-1.5 text-[11px] text-fg/40">
        <span>
          Batch{' '}
          <span className="font-mono tabular-nums text-fg/45">
            #{depth?.batchId ?? '—'}
          </span>
        </span>
        <span>
          <span className="font-mono tabular-nums text-fg/45">
            {depth?.activeOrderCount ?? 0}
          </span>{' '}
          sealed orders
        </span>
      </div>
    </div>
  );
}

/* ---------------------------- recent trades tab --------------------------- */

function TradeRow({ trade }: { trade: SettledTrade }) {
  const cells = (
    <>
      <span className={`font-mono tabular-nums ${dirColor[trade.direction]}`}>
        {trade.priceLabel}
        {trade.direction !== 'flat' && (
          <span className="ml-0.5 text-[10px]">{dirArrow[trade.direction]}</span>
        )}
      </span>
      <span className="font-mono tabular-nums text-right text-fg/55">
        {fmtQty(trade.qty)}
      </span>
      <span className="font-mono tabular-nums text-right text-fg/45">
        {fmtValue(trade)}
      </span>
      <span className="font-mono tabular-nums text-right text-fg/40">
        {fmtClock(trade.settledAt)}
      </span>
    </>
  );

  const rowClass =
    'grid grid-cols-[1fr_1fr_1fr_64px] gap-x-1 px-3 py-[3px] text-xs leading-4 hover:bg-fg/[0.05]';

  if (trade.txHash) {
    return (
      <a
        href={`https://stellar.expert/explorer/testnet/tx/${trade.txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`Batch #${trade.batchId ?? '—'} — view settlement on Stellar.Expert`}
        className={rowClass}
      >
        {cells}
      </a>
    );
  }
  return <div className={rowClass}>{cells}</div>;
}

function RecentTradesTab() {
  const { trades, isLoadingTrades, tradesError, refetchTrades } = useOrderBook();

  if (isLoadingTrades) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-fg/40 animate-pulse">
        Loading trades…
      </div>
    );
  }

  if (tradesError) {
    return <ErrorFiller label="Failed to load recent trades" onRetry={() => refetchTrades()} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-[1fr_1fr_1fr_64px] gap-x-1 px-3 py-1.5 text-[11px] text-fg/40">
        <span>Price(USDC)</span>
        <span className="text-right">Qty(XLM)</span>
        <span className="text-right">Value(USDC)</span>
        <span className="text-right">Time</span>
      </div>

      {trades.length === 0 ? (
        <div className="flex-1 py-12 text-center">
          <p className="text-sm text-fg/40">No settled trades yet</p>
          <p className="mt-1 text-[11px] text-fg/30">
            Trades are revealed after each batch auction settles
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {trades.map((trade, i) => (
            <TradeRow key={`${trade.batchId}-${trade.settledAt}-${i}`} trade={trade} />
          ))}
        </div>
      )}

      <div className="border-t border-hairline/10 px-3 py-1.5 text-[10px] text-fg/30">
        Full size &amp; price revealed at settlement ·{' '}
        <span className="font-mono tabular-nums">{trades.length}</span> trades
      </div>
    </div>
  );
}

/* --------------------------------- panel ---------------------------------- */

type Tab = 'book' | 'trades';

export function MarketPanel() {
  const [tab, setTab] = useState<Tab>('trades');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'book', label: 'Order Book' },
    { id: 'trades', label: 'Recent Trades' },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 items-center border-b border-hairline/10 px-1">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`relative h-full px-3 text-[13px] transition-colors ${
              tab === id ? 'text-fg font-medium' : 'text-fg/40 hover:text-fg/55'
            }`}
          >
            {label}
            {tab === id && (
              <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {tab === 'book' ? <OrderBookTab /> : <RecentTradesTab />}
    </div>
  );
}
