import type { SettledTrade } from '@/hooks/useOrderBook';

export interface Stats24h {
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  volumeXlm: number | null;
  turnoverUsdc: number | null;
}

/** Rolling 24h change/high/low/volume computed from the settled-trade tape (newest first). */
export function computeStats24h(trades: SettledTrade[]): Stats24h {
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

export function fmtCompact(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
