'use client';

import { useIsMobile } from '@/hooks/useIsMobile';
import { TickerBar } from '@/components/trade/TickerBar';
import { TradingChart } from '@/components/trade/TradingChart';
import { MarketPanel } from '@/components/trade/MarketPanel';
import { TradePanel } from '@/components/trade/TradePanel';
import { OrdersStrip } from '@/components/trade/OrdersStrip';
import { MobileTradeView } from '@/components/trade/MobileTradeView';

export default function TradePage() {
  const isMobile = useIsMobile();

  if (isMobile === null) return null;
  if (isMobile) return <MobileTradeView />;

  return (
    // -m-3/-m-6 escapes the Layout padding — the terminal is edge-to-edge.
    // Below xl the terminal isn't height-locked: panels stack and the page
    // scrolls normally instead of clipping content inside a fixed viewport.
    <div className="-m-3 flex flex-col bg-page sm:-m-6 xl:h-[calc(100vh-3.5rem)] xl:overflow-hidden">
      <TickerBar />

      {/* main grid: chart | book & trades | order panel — hairline separated */}
      <div className="flex flex-col gap-px border-y border-hairline/10 bg-hairline/10 xl:flex-1 xl:flex-row xl:overflow-hidden">
        <div className="min-h-[320px] min-w-0 bg-panel xl:min-h-0 xl:flex-1 xl:overflow-hidden">
          <TradingChart />
        </div>
        <div className="min-h-[300px] w-full bg-panel xl:min-h-0 xl:w-[300px] xl:shrink-0 xl:overflow-hidden">
          <MarketPanel />
        </div>
        <div className="w-full overflow-y-auto bg-panel xl:w-[320px] xl:shrink-0">
          <TradePanel />
        </div>
      </div>

      <OrdersStrip />
    </div>
  );
}
