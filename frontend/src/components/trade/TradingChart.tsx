'use client';

import { useEffect, useRef } from 'react';

// TradingView Advanced Chart widget — gives the full analyzer suite the
// lightweight-charts view can't: left drawing toolbar (trendlines, fib,
// pitchfork, brush, text, measure…), the Indicators menu, multiple chart
// styles, and the bottom date-range tabs (1D 5D 1W … All).
//
// Aether settles XLM/USDC in a sealed dark pool, which has no public TradingView
// feed, so the widget streams the closest liquid market (Binance XLM/USDT).
// The original sealed-trade candle view is preserved in DarkPoolChart.tsx.
const SYMBOL = 'BINANCE:XLMUSDT';
const WIDGET_SRC =
  'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';

export function TradingChart() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    host.innerHTML = '';
    const widget = document.createElement('div');
    widget.className = 'tradingview-widget-container__widget';
    widget.style.height = '100%';
    widget.style.width = '100%';
    host.appendChild(widget);

    const script = document.createElement('script');
    script.src = WIDGET_SRC;
    script.type = 'text/javascript';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: SYMBOL,
      interval: '15',
      timezone: 'Etc/UTC',
      theme: 'light',
      style: '1',
      locale: 'en',
      withdateranges: true,
      hide_side_toolbar: false,
      hide_top_toolbar: false,
      hide_legend: false,
      allow_symbol_change: true,
      details: false,
      calendar: false,
      hide_volume: false,
      support_host: 'https://www.tradingview.com',
      backgroundColor: '#ffffff',
      gridColor: 'rgba(0,0,0,0.06)',
    });
    host.appendChild(script);

    return () => {
      host.innerHTML = '';
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="tradingview-widget-container h-full w-full bg-panel"
      style={{ height: '100%', width: '100%' }}
    />
  );
}
