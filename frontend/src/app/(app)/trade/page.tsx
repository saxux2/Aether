import { TickerBar } from '@/components/trade/TickerBar';
import { TradingChart } from '@/components/trade/TradingChart';
import { MarketPanel } from '@/components/trade/MarketPanel';
import { TradePanel } from '@/components/trade/TradePanel';
import { OrdersStrip } from '@/components/trade/OrdersStrip';

export default function TradePage() {
  return (
    // -m-6 escapes the Layout padding — the terminal is edge-to-edge.
    <div className="-m-6 flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-page">
      <TickerBar />

      {/* main grid: chart | book & trades | order panel — hairline separated */}
      <div className="flex flex-1 flex-col gap-px border-y border-hairline/10 bg-hairline/10 overflow-hidden xl:flex-row">
        <div className="min-h-[320px] min-w-0 flex-1 overflow-hidden bg-panel xl:min-h-0">
          <TradingChart />
        </div>
        <div className="min-h-[300px] w-full shrink-0 overflow-hidden bg-panel xl:min-h-0 xl:w-[300px]">
          <MarketPanel />
        </div>
        <div className="w-full shrink-0 overflow-y-auto bg-panel xl:w-[320px]">
          <TradePanel />
        </div>
      </div>

      <OrdersStrip />
    </div>
  );
}
