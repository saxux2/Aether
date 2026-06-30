'use client';

import { useOrderBook, type SettledTrade } from '@/hooks/useOrderBook';
import { useLivePrice } from '@/hooks/useLivePrice';

function fmtCompact(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface Stats24h {
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volumeXlm: number | null;
  turnoverUsdc: number | null;
}

function computeStats(trades: SettledTrade[]): Stats24h {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  const window = trades.filter((t) => {
    const ts = new Date(t.settledAt).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  if (window.length === 0) {
    return { change: null, changePct: null, high: null, low: null, volumeXlm: null, turnoverUsdc: null };
  }
  const lastPrice = window[0].price;
  const firstPrice = window[window.length - 1].price;
  const change = lastPrice - firstPrice;
  const changePct = firstPrice > 0 ? (change / firstPrice) * 100 : null;
  let high = -Infinity;
  let low = Infinity;
  let volumeXlm = 0;
  let turnoverUsdc = 0;
  for (const t of window) {
    if (t.price > high) high = t.price;
    if (t.price < low) low = t.price;
    volumeXlm += t.qty;
    turnoverUsdc += t.usdc ?? t.qty * t.price;
  }
  return { change, changePct, high, low, volumeXlm, turnoverUsdc };
}

function Stat({ label, value, valueClass = 'text-fg' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex shrink-0 flex-col justify-center">
      <span className="text-[10px] uppercase tracking-wider text-fg/40">{label}</span>
      <span className={`text-xs font-mono tabular-nums ${valueClass}`}>{value}</span>
    </div>
  );
}

export function TickerBar() {
  const { trades } = useOrderBook();
  const { livePrice } = useLivePrice();

  const last = trades[0];
  const stats = computeStats(trades);

  const changeValue =
    stats.change != null
      ? `${stats.change >= 0 ? '+' : ''}${stats.change.toFixed(4)} (${
          stats.changePct != null
            ? `${stats.changePct >= 0 ? '+' : ''}${stats.changePct.toFixed(2)}%`
            : '—'
        })`
      : '—';
  const changeClass =
    stats.change == null
      ? 'text-fg'
      : stats.change > 0
        ? 'text-up'
        : stats.change < 0
          ? 'text-down'
          : 'text-fg';

  return (
    <div className="flex h-14 items-center gap-6 overflow-x-auto px-4 bg-panel border-b border-hairline/10">
      <div className="flex shrink-0 items-center gap-2">
        <div className="flex flex-col">
          <span className="text-[15px] font-semibold leading-tight text-fg">XLM/USDC</span>
          <span className="text-[11px] text-fg/40">Dark Pool · Spot</span>
        </div>
      </div>

      <Stat label="24H Change" value={changeValue} valueClass={changeClass} />
      <Stat label="24H High" value={stats.high != null ? stats.high.toFixed(4) : '—'} />
      <Stat label="24H Low" value={stats.low != null ? stats.low.toFixed(4) : '—'} />
      <Stat
        label="24H Volume (XLM)"
        value={stats.volumeXlm != null ? fmtCompact(stats.volumeXlm) : '—'}
      />
      <Stat
        label="24H Turnover (USDC)"
        value={stats.turnoverUsdc != null ? fmtCompact(stats.turnoverUsdc, 2) : '—'}
      />

      <div className="ml-auto flex shrink-0 items-center gap-4">
        <div className="px-2.5 py-1">
          <div className="flex items-center gap-2">
            <span className="font-mono tabular-nums text-[15px] font-semibold text-fg leading-tight">
              {livePrice !== null ? livePrice.toFixed(4) : '—'}
            </span>
            {livePrice !== null && (
              <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-up/10 text-up border border-up/25 leading-none">
                LIVE
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-fg/30 leading-tight mt-0.5">
            Live · CoinGecko
          </div>
        </div>
      </div>
    </div>
  );
}
