'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  type IPriceLine,
} from 'lightweight-charts';
import { useOrderBook, type SettledTrade } from '@/hooks/useOrderBook';
import { useLivePrice } from '@/hooks/useLivePrice';

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const;
type Interval = (typeof INTERVALS)[number];

const INTERVAL_MS: Record<Interval, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '30m': 1_800_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};
// TradingView-style interval label (minutes as a number, D for daily).
const INTERVAL_LABEL: Record<Interval, string> = {
  '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D',
};

const MAX_CANDLES = 240;
const VOL_SMA_PERIOD = 9;

interface Palette {
  BG: string; GRID: string; AXIS_TEXT: string; LEGEND: string;
  UP: string; DOWN: string; VOL_UP: string; VOL_DOWN: string; VOL_SMA: string;
  CROSSHAIR: string; CROSS_LABEL: string; SPOT: string;
  SEL_BG: string; SEL_TEXT: string;
}

// Light — sits on the white panel
const LIGHT: Palette = {
  BG: '#ffffff', GRID: '#ecedf1', AXIS_TEXT: '#787b86', LEGEND: '#131722',
  UP: '#20b26c', DOWN: '#ef454a',
  VOL_UP: 'rgba(32,178,108,0.45)', VOL_DOWN: 'rgba(239,69,74,0.45)', VOL_SMA: '#2962ff',
  CROSSHAIR: '#9598a1', CROSS_LABEL: '#787b86', SPOT: '#b8860b',
  SEL_BG: '#e8eaed', SEL_TEXT: '#131722',
};
// Dark — Kimia-style navy, sits on the #0d111a panel
const DARK: Palette = {
  BG: '#0d111a', GRID: '#1b2233', AXIS_TEXT: '#8a8f9c', LEGEND: '#e9ecf2',
  UP: '#0ecb81', DOWN: '#f6465d',
  VOL_UP: 'rgba(14,203,129,0.45)', VOL_DOWN: 'rgba(246,70,93,0.45)', VOL_SMA: '#6e82ff',
  CROSSHAIR: '#4a5163', CROSS_LABEL: '#363a45', SPOT: '#f0b90b',
  SEL_BG: '#2a2f3d', SEL_TEXT: '#e9ecf2',
};

interface OhlcCandle {
  t: number; o: number; h: number; l: number; c: number; v: number;
  filler: boolean; trades: number;
}

/**
 * Aggregate settled trades into CONTINUOUS OHLC candles.
 * open[i] = close[i-1] so sparse dark-pool data (often one trade per bucket)
 * renders real colored bodies instead of invisible dojis. Empty buckets are
 * flat fillers at the running close. No external/live price is mixed in.
 */
function buildCandles(trades: SettledTrade[], intervalMs: number): OhlcCandle[] {
  const pts = trades
    .map((t) => ({ time: Date.parse(t.settledAt), price: t.price, qty: t.qty }))
    .filter((p) => Number.isFinite(p.time) && p.price > 0)
    .sort((a, b) => a.time - b.time);
  if (pts.length === 0) return [];

  type Raw = { o: number; h: number; l: number; c: number; v: number; n: number };
  const byBucket = new Map<number, Raw>();
  for (const p of pts) {
    const t = Math.floor(p.time / intervalMs) * intervalMs;
    const r = byBucket.get(t);
    if (!r) byBucket.set(t, { o: p.price, h: p.price, l: p.price, c: p.price, v: p.qty, n: 1 });
    else {
      r.h = Math.max(r.h, p.price);
      r.l = Math.min(r.l, p.price);
      r.c = p.price;
      r.v += p.qty;
      r.n += 1;
    }
  }

  const keys = [...byBucket.keys()].sort((a, b) => a - b);
  const first = keys[0];
  const last = keys[keys.length - 1];
  const start = Math.max(first, last - (MAX_CANDLES - 1) * intervalMs);

  let prevClose = byBucket.get(first)!.o;
  for (const k of keys) {
    if (k <= start) prevClose = byBucket.get(k)!.c;
    else break;
  }

  const out: OhlcCandle[] = [];
  for (let t = start; t <= last; t += intervalMs) {
    const real = byBucket.get(t);
    if (real) {
      const o = prevClose;
      out.push({ t, o, h: Math.max(real.h, o), l: Math.min(real.l, o), c: real.c, v: real.v, filler: false, trades: real.n });
      prevClose = real.c;
    } else {
      out.push({ t, o: prevClose, h: prevClose, l: prevClose, c: prevClose, v: 0, filler: true, trades: 0 });
    }
  }
  return out.slice(-MAX_CANDLES);
}

/** SMA over candle volume; emitted once `period` samples exist. */
function volumeSma(candles: OhlcCandle[], period: number): LineData[] {
  const out: LineData[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].v;
    if (i >= period) sum -= candles[i - period].v;
    if (i >= period - 1) out.push({ time: Math.floor(candles[i].t / 1000) as Time, value: sum / period });
  }
  return out;
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}
function fmtVol(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function DarkPoolChart() {
  const { trades, isLoadingTrades } = useOrderBook();
  const { livePrice } = useLivePrice();
  const [interval, setChartInterval] = useState<Interval>('30m');

  const P = LIGHT;

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volRef       = useRef<ISeriesApi<'Histogram'> | null>(null);
  const volSmaRef    = useRef<ISeriesApi<'Line'> | null>(null);
  const lastLineRef  = useRef<IPriceLine | null>(null);
  const fittedFor    = useRef<string | null>(null);
  const candlesRef   = useRef<OhlcCandle[]>([]);
  const paletteRef   = useRef<Palette>(P);
  paletteRef.current = P;

  const intervalMs = INTERVAL_MS[interval];

  const candles = useMemo(() => buildCandles(trades, intervalMs), [trades, intervalMs]);
  candlesRef.current = candles;
  const volSma = useMemo(() => volumeSma(candles, VOL_SMA_PERIOD), [candles]);

  const lastTradePrice = useMemo(() => {
    for (let i = candles.length - 1; i >= 0; i--) if (!candles[i].filler) return candles[i].c;
    return null;
  }, [candles]);

  // hovered candle index drives both legends; falls back to the latest candle.
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const legendIdx = hoverIdx ?? candles.length - 1;
  const legend = candles[legendIdx] ?? null;
  const legendSma =
    legendIdx >= VOL_SMA_PERIOD - 1 && legendIdx < candles.length
      ? volSma[legendIdx - (VOL_SMA_PERIOD - 1)]?.value ?? null
      : null;

  // ---- create chart once ----
  useEffect(() => {
    if (!containerRef.current) return;
    const pal = paletteRef.current;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: pal.BG },
        textColor: pal.AXIS_TEXT,
        fontFamily: '-apple-system, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
        fontSize: 12,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: pal.GRID },
        horzLines: { color: pal.GRID },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: pal.CROSSHAIR, width: 1, style: LineStyle.Solid, labelBackgroundColor: pal.CROSS_LABEL },
        horzLine: { color: pal.CROSSHAIR, width: 1, style: LineStyle.Solid, labelBackgroundColor: pal.CROSS_LABEL },
      },
      rightPriceScale: {
        borderColor: pal.GRID,
        scaleMargins: { top: 0.1, bottom: 0.1 },
        entireTextOnly: true,
      },
      timeScale: {
        borderColor: pal.GRID,
        timeVisible: true,
        secondsVisible: false,
        fixRightEdge: true,
        rightOffset: 6,
        barSpacing: 8,
        minBarSpacing: 2,
      },
    });

    // Pane 0 — candles
    const cSeries = chart.addSeries(CandlestickSeries, {
      upColor: pal.UP, downColor: pal.DOWN,
      borderUpColor: pal.UP, borderDownColor: pal.DOWN,
      wickUpColor: pal.UP, wickDownColor: pal.DOWN,
      borderVisible: true, wickVisible: true,
      priceLineVisible: false, lastValueVisible: false,
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    });

    // Pane 1 — volume histogram (own axis) + Volume SMA line
    const vSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceLineVisible: false, lastValueVisible: false,
      color: pal.VOL_UP,
    }, 1);
    const vSma = chart.addSeries(LineSeries, {
      color: pal.VOL_SMA, lineWidth: 2,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    }, 1);

    // ~76% price / ~24% volume, like TradingView's default volume pane.
    const panes = chart.panes();
    if (panes.length > 1) {
      panes[0].setStretchFactor(76);
      panes[1].setStretchFactor(24);
    }
    vSeries.priceScale().applyOptions({
      borderColor: pal.GRID,
      scaleMargins: { top: 0.2, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (param.time == null) { setHoverIdx(null); return; }
      const tSec = Number(param.time);
      const idx = candlesRef.current.findIndex((c) => Math.floor(c.t / 1000) === tSec);
      setHoverIdx(idx >= 0 ? idx : null);
    });

    chartRef.current  = chart;
    candleRef.current = cSeries;
    volRef.current    = vSeries;
    volSmaRef.current = vSma;

    return () => {
      chart.remove();
      chartRef.current = candleRef.current = volRef.current = volSmaRef.current = null;
      lastLineRef.current = null;
    };
  }, []);

  // ---- re-apply colors when the theme flips ----
  useEffect(() => {
    const chart = chartRef.current;
    const cSeries = candleRef.current;
    const vSeries = volRef.current;
    const vSma = volSmaRef.current;
    if (!chart || !cSeries || !vSeries || !vSma) return;

    chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: P.BG }, textColor: P.AXIS_TEXT },
      grid: { vertLines: { color: P.GRID }, horzLines: { color: P.GRID } },
      crosshair: {
        vertLine: { color: P.CROSSHAIR, labelBackgroundColor: P.CROSS_LABEL },
        horzLine: { color: P.CROSSHAIR, labelBackgroundColor: P.CROSS_LABEL },
      },
      rightPriceScale: { borderColor: P.GRID },
      timeScale: { borderColor: P.GRID },
    });
    cSeries.applyOptions({
      upColor: P.UP, downColor: P.DOWN,
      borderUpColor: P.UP, borderDownColor: P.DOWN,
      wickUpColor: P.UP, wickDownColor: P.DOWN,
    });
    vSeries.applyOptions({ color: P.VOL_UP });
    vSeries.priceScale().applyOptions({ borderColor: P.GRID });
    vSma.applyOptions({ color: P.VOL_SMA });
  }, [P]);

  // ---- push data (re-runs on theme change so volume bar colors update) ----
  useEffect(() => {
    const cSeries = candleRef.current;
    const vSeries = volRef.current;
    if (!cSeries || !vSeries) return;

    const cd: CandlestickData[] = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as Time,
      open: c.o, high: c.h, low: c.l, close: c.c,
    }));
    const vd: HistogramData[] = candles.map((c) => ({
      time: Math.floor(c.t / 1000) as Time,
      value: c.v,
      color: c.c >= c.o ? P.VOL_UP : P.VOL_DOWN,
    }));

    cSeries.setData(cd);
    vSeries.setData(vd);
    volSmaRef.current?.setData(volSma);

    if (cd.length > 0 && fittedFor.current !== interval) {
      chartRef.current?.timeScale().fitContent();
      fittedFor.current = interval;
    }
  }, [candles, volSma, interval, P]);

  // ---- dotted last-price line, colored by the last candle's direction ----
  useEffect(() => {
    const cSeries = candleRef.current;
    if (!cSeries) return;
    if (lastLineRef.current) {
      try { cSeries.removePriceLine(lastLineRef.current); } catch { /* ignore */ }
      lastLineRef.current = null;
    }
    const last = candles[candles.length - 1];
    if (lastTradePrice != null && last) {
      lastLineRef.current = cSeries.createPriceLine({
        price: lastTradePrice,
        color: last.c >= last.o ? P.UP : P.DOWN,
        lineWidth: 1, lineStyle: LineStyle.Dotted,
        axisLabelVisible: true, title: '',
      });
    }
  }, [lastTradePrice, candles, P]);

  const up = legend ? legend.c >= legend.o : true;
  const ohlcColor = up ? P.UP : P.DOWN;
  const change = legend ? legend.c - legend.o : 0;
  const changePct = legend && legend.o > 0 ? (change / legend.o) * 100 : 0;
  const hasData = candles.length > 0;

  return (
    <div className="relative flex h-full flex-col" style={{ background: P.BG }}>
      {/* interval selector — offset left of the right price scale so it never
          overlaps the axis labels */}
      <div className="absolute top-2 z-20 flex items-center gap-0.5" style={{ right: 64 }}>
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            onClick={() => setChartInterval(iv)}
            className="rounded px-1.5 py-0.5 font-sans text-[11px] leading-none transition-colors"
            style={{
              color: iv === interval ? P.SEL_TEXT : P.AXIS_TEXT,
              background: iv === interval ? P.SEL_BG : 'transparent',
            }}
          >
            {INTERVAL_LABEL[iv]}
          </button>
        ))}
      </div>

      {/* main legend (TradingView style) */}
      <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-sans text-[13px]">
        <span className="font-medium" style={{ color: P.LEGEND }}>XLM/USDC</span>
        <span style={{ color: P.AXIS_TEXT }}>· {INTERVAL_LABEL[interval]} · Aether Dark Pool</span>
        {legend && (
          <span className="flex items-center gap-2 tabular-nums" style={{ color: ohlcColor }}>
            <span><span style={{ color: P.AXIS_TEXT }}>O</span> {fmtPrice(legend.o)}</span>
            <span><span style={{ color: P.AXIS_TEXT }}>H</span> {fmtPrice(legend.h)}</span>
            <span><span style={{ color: P.AXIS_TEXT }}>L</span> {fmtPrice(legend.l)}</span>
            <span><span style={{ color: P.AXIS_TEXT }}>C</span> {fmtPrice(legend.c)}</span>
            <span>{change >= 0 ? '+' : ''}{fmtPrice(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)</span>
          </span>
        )}
      </div>

      {/* volume legend — sits at the top of the volume pane (~76% down) */}
      {legend && (
        <div className="pointer-events-none absolute left-3 z-10 flex items-center gap-2 font-sans text-[12px] tabular-nums" style={{ top: '76%' }}>
          <span style={{ color: P.AXIS_TEXT }}>Volume SMA {VOL_SMA_PERIOD}</span>
          <span style={{ color: up ? P.UP : P.DOWN }}>{fmtVol(legend.v)}</span>
          {legendSma != null && <span style={{ color: P.VOL_SMA }}>{fmtVol(legendSma)}</span>}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />
        {!hasData && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
            {isLoadingTrades ? (
              <p className="text-xs" style={{ color: P.AXIS_TEXT }}>Loading chart…</p>
            ) : (
              <>
                <p className="text-xs" style={{ color: P.LEGEND }}>No settled trades yet</p>
                <p className="text-[11px]" style={{ color: P.AXIS_TEXT }}>Candles plot once a batch auction clears</p>
              </>
            )}
          </div>
        )}
      </div>

      {/* external spot reference (small, bottom-right) */}
      {livePrice != null && (
        <div className="pointer-events-none absolute bottom-8 right-3 z-10 font-sans text-[11px] tabular-nums" style={{ color: P.SPOT }}>
          Spot {fmtPrice(livePrice)}
        </div>
      )}
    </div>
  );
}
