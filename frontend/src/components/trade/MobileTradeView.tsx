'use client';

import { useState } from 'react';
import { useOrderBook } from '@/hooks/useOrderBook';
import { useLivePrice } from '@/hooks/useLivePrice';
import { useBatch } from '@/hooks/useBatch';
import { useOrders } from '@/hooks/useOrders';
import { useWallet } from '@/hooks/useWallet';
import { useTraderOrders } from '@/hooks/useTraderOrders';
import { computeStats24h, fmtCompact } from '@/utils/marketStats';
import { mergeOrders } from '@/utils/mergeOrders';
import { MobileCard } from '@/components/mobile/MobileCard';
import { OrderList } from '@/components/mobile/OrderList';
import { TradingChart } from './TradingChart';
import { TradePanel } from './TradePanel';
import { MarketPanel } from './MarketPanel';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-fg/40">{label}</p>
      <p className="font-mono text-[15px] font-semibold text-fg">{value}</p>
    </div>
  );
}

export function MobileTradeView() {
  const { trades } = useOrderBook();
  const { livePrice } = useLivePrice();
  const { countdown } = useBatch();
  const { address, connected } = useWallet();
  const { orders: localOrders, cancelOrder, isCancelling } = useOrders();
  const { data: apiOrders } = useTraderOrders(address, connected);

  const [ordersTab, setOrdersTab] = useState<'open' | 'history'>('open');

  const stats = computeStats24h(trades);
  const last = trades[0];
  const merged = mergeOrders(apiOrders, localOrders);

  const mm = String(Math.floor(countdown / 60)).padStart(2, '0');
  const ss = String(countdown % 60).padStart(2, '0');

  const changeClass =
    stats.change == null ? 'text-fg/40' : stats.change > 0 ? 'text-up' : stats.change < 0 ? 'text-down' : 'text-fg/40';

  return (
    <div className="flex flex-col gap-3 pb-6">
      {/* Symbol card */}
      <MobileCard noPadding>
        <div className="flex items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold text-fg">XLM/USDC</span>
            <svg className="h-3.5 w-3.5 text-fg/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          <div className="flex items-center gap-3">
            <span className={`font-mono text-sm tabular-nums ${changeClass}`}>
              {stats.changePct != null
                ? `${stats.changePct >= 0 ? '+' : ''}${stats.changePct.toFixed(2)}%`
                : '—'}
            </span>
            <svg className="h-4 w-4 text-fg/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M8 12h12M11 18h9M4 12v.01M4 18v.01" />
            </svg>
          </div>
        </div>
      </MobileCard>

      {/* Stats card */}
      <MobileCard noPadding>
        <div className="grid grid-cols-2 gap-y-3.5 px-4 py-3.5">
          <Stat label="Last Price" value={last ? last.priceLabel : '—'} />
          <Stat label="Live Price" value={livePrice != null ? livePrice.toFixed(4) : '—'} />
          <Stat label="24H Volume" value={stats.volumeXlm != null ? `${fmtCompact(stats.volumeXlm)} XLM` : '—'} />
          <Stat label="24H Turnover" value={stats.turnoverUsdc != null ? `$${fmtCompact(stats.turnoverUsdc)}` : '—'} />
        </div>
        <div
          className={`border-t border-hairline/10 px-4 py-2 text-xs font-medium ${
            livePrice == null ? 'text-amber-600' : 'text-accent'
          }`}
        >
          {livePrice == null
            ? 'Live price feed reconnecting…'
            : `Next batch settles in ${mm}:${ss}`}
        </div>
      </MobileCard>

      {/* Chart card — the TradingView widget renders its own toolbar/date-range tabs */}
      <MobileCard noPadding className="h-[420px]">
        <TradingChart />
      </MobileCard>

      {/* Trade (buy/sell) card */}
      <MobileCard noPadding className="min-h-[440px]">
        <TradePanel />
      </MobileCard>

      {/* Orders card */}
      <MobileCard noPadding>
        <div className="flex items-center gap-1 border-b border-hairline/10 px-2">
          <button
            type="button"
            onClick={() => setOrdersTab('open')}
            className={`relative px-3 py-3 text-[13px] transition-colors ${
              ordersTab === 'open' ? 'font-semibold text-fg' : 'text-fg/40'
            }`}
          >
            Open Orders ({merged.live.length})
            {ordersTab === 'open' && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setOrdersTab('history')}
            className={`relative px-3 py-3 text-[13px] transition-colors ${
              ordersTab === 'history' ? 'font-semibold text-fg' : 'text-fg/40'
            }`}
          >
            Order History
            {ordersTab === 'history' && (
              <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
            )}
          </button>
        </div>
        {!connected ? (
          <div className="flex flex-col items-center justify-center gap-1 py-10 text-center">
            <p className="text-sm text-fg/40">Connect wallet to view your orders.</p>
          </div>
        ) : (
          <OrderList
            orders={ordersTab === 'open' ? merged.live : merged.settled}
            showCancel={ordersTab === 'open'}
            cancelOrder={cancelOrder}
            isCancelling={isCancelling}
            emptyMessage={ordersTab === 'open' ? 'No open orders' : 'No order history yet'}
            emptySubtitle={ordersTab === 'open' ? 'Sealed orders you place appear here' : undefined}
          />
        )}
      </MobileCard>

      {/* Order book / recent trades card */}
      <MobileCard noPadding className="h-[420px]">
        <MarketPanel />
      </MobileCard>
    </div>
  );
}
