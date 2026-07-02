'use client';

import { useOrderBook } from '@/hooks/useOrderBook';
import { useLivePrice } from '@/hooks/useLivePrice';
import { computeStats24h, fmtCompact } from '@/utils/marketStats';

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
  const stats = computeStats24h(trades);

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
