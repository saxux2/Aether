'use client';

import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useWallet } from '@/hooks/useWallet';
import { useTraderOrders, type ApiOrder } from '@/hooks/useTraderOrders';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useOrdersStore } from '@/store/ordersSlice';
import { relativeTime, shortAddress, statusColor } from '@/utils/format';
import { STELLAR_HORIZON_URL } from '@/utils/constants';
import { mergeOrders } from '@/utils/mergeOrders';
import { MobileCard } from '@/components/mobile/MobileCard';
import { OrderList } from '@/components/mobile/OrderList';

interface HorizonBalance {
  asset_type: string;
  asset_code?: string;
  balance: string;
}

interface HorizonAccount {
  balances: HorizonBalance[];
}

function fmt2(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt7(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

function apiOrderFillPrice(o: ApiOrder): number {
  if (o.settlement_price) return parseFloat(o.settlement_price);
  return Number(o.revealed_price) / 1e6;
}

function apiOrderQtyNum(o: ApiOrder): number {
  return parseFloat(o.xlm_amount);
}

/** XLM that actually traded — filled amount for settled orders, full size otherwise. */
function apiOrderFilledNum(o: ApiOrder): number {
  const filled = parseFloat(o.filled_xlm ?? '0');
  return filled > 0 ? filled : apiOrderQtyNum(o);
}

function apiOrderRefundedNum(o: ApiOrder): number {
  return parseFloat(o.refunded_xlm ?? '0');
}

function apiOrderValueNum(o: ApiOrder): number {
  if (o.usdc_amount) return parseFloat(o.usdc_amount);
  return apiOrderFilledNum(o) * apiOrderFillPrice(o);
}

function SkeletonText({ w = 'w-20' }: { w?: string }) {
  return <span className={`inline-block ${w} h-4 bg-fg/[0.06] rounded animate-pulse`} />;
}

function StatCard({
  label,
  value,
  sub,
  loading,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  loading?: boolean;
  accent?: 'up' | 'down' | 'blue' | 'neutral';
}) {
  const accentClass =
    accent === 'up'
      ? 'text-up'
      : accent === 'down'
      ? 'text-down'
      : accent === 'blue'
      ? 'text-accent'
      : 'text-fg';

  return (
    <div className="bg-panel border border-hairline/10 rounded-lg p-4 flex flex-col gap-1">
      <p className="text-xs font-medium text-fg/45 uppercase tracking-wider">{label}</p>
      {loading ? (
        <SkeletonText w="w-28" />
      ) : (
        <p className={`text-xl font-semibold font-mono ${accentClass}`}>{value}</p>
      )}
      {sub && !loading && <p className="text-xs text-fg/40">{sub}</p>}
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="text-sm font-semibold text-fg uppercase tracking-widest">{title}</h2>
      {count !== undefined && (
        <span className="text-xs text-fg/40 font-mono bg-panel border border-hairline/10 px-2 py-0.5 rounded">
          {count}
        </span>
      )}
      <div className="flex-1 h-px bg-fg/[0.06]" />
    </div>
  );
}

export default function PortfolioPage() {
  const isMobile = useIsMobile();
  const { connected, address } = useWallet();
  const localOrders = useOrdersStore((s) => s.orders);

  const { data: horizonData, isLoading: horizonLoading } = useQuery<HorizonAccount>({
    queryKey: ['horizon-account', address],
    queryFn: async () => {
      const res = await axios.get(`${STELLAR_HORIZON_URL}/accounts/${address}`);
      return res.data;
    },
    enabled: connected && !!address,
    refetchInterval: 15_000,
    retry: 2,
  });

  const { data: apiOrders, isLoading: ordersLoading } = useTraderOrders(address, connected);

  const xlmBalance =
    horizonData?.balances.find((b) => b.asset_type === 'native')?.balance ?? null;
  const usdcBalance =
    horizonData?.balances.find((b) => b.asset_code === 'USDC')?.balance ?? null;

  const orders = apiOrders ?? [];
  // 'settled' includes partial fills (status stays 'settled'; the unfilled
  // remainder was refunded on-chain). 'matched' = settlement in flight.
  const settled = orders.filter((o) => o.status === 'settled');
  const active = orders.filter((o) => o.status === 'active' || o.status === 'matched');

  const settledBuys = settled.filter((o) => o.direction === 'buy');
  const settledSells = settled.filter((o) => o.direction === 'sell');

  // Use FILLED amounts (what actually traded), not the full order size.
  const totalXlmBought = settledBuys.reduce((s, o) => s + apiOrderFilledNum(o), 0);
  const totalXlmSold = settledSells.reduce((s, o) => s + apiOrderFilledNum(o), 0);
  const totalUsdcSpent = settledBuys.reduce((s, o) => s + apiOrderValueNum(o), 0);
  const totalUsdcReceived = settledSells.reduce((s, o) => s + apiOrderValueNum(o), 0);

  const settledDesc = [...settled].sort(
    (a, b) =>
      new Date(b.settled_at ?? b.submitted_at).getTime() -
      new Date(a.settled_at ?? a.submitted_at).getTime()
  );

  if (isMobile === null) return null;

  if (!connected) {
    return (
      <div className="w-full flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="bg-panel border border-hairline/10 rounded-lg p-10 flex flex-col items-center gap-4 max-w-sm w-full text-center">
          <div className="w-12 h-12 rounded-full bg-fg/[0.06] flex items-center justify-center">
            <svg className="w-6 h-6 text-fg/45" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 005 0" />
            </svg>
          </div>
          <p className="text-fg font-semibold text-sm">Wallet not connected</p>
          <p className="text-fg/45 text-xs leading-relaxed">
            Connect your Freighter wallet to view balances, trading history, and open orders.
          </p>
        </div>
      </div>
    );
  }

  if (isMobile) {
    const { live: mobileLive, settled: mobileSettled } = mergeOrders(apiOrders, localOrders);
    return (
      <div className="w-full flex flex-col gap-3 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-light tracking-tight text-fg" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>Portfolio</h1>
            {address && <p className="text-fg/40 text-xs font-mono mt-0.5">{shortAddress(address)}</p>}
          </div>
          {(horizonLoading || ordersLoading) && (
            <span className="text-xs text-fg/40 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              Syncing
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label="XLM Balance"
            value={xlmBalance ? `${parseFloat(xlmBalance).toLocaleString('en-US', { maximumFractionDigits: 4 })} XLM` : '—'}
            loading={horizonLoading && !xlmBalance}
          />
          <StatCard
            label="USDC Balance"
            value={usdcBalance ? `$${fmt2(parseFloat(usdcBalance))}` : '—'}
            loading={horizonLoading && !usdcBalance}
          />
          <StatCard label="Settled Trades" value={ordersLoading ? '…' : String(settled.length)} loading={ordersLoading} accent="blue" />
          <StatCard
            label="Active Orders"
            value={ordersLoading ? '…' : String(active.length)}
            loading={ordersLoading}
            accent={active.length > 0 ? 'blue' : 'neutral'}
          />
        </div>

        <MobileCard>
          <SectionHeader title="Holdings" />
          <div className="flex flex-col divide-y divide-hairline/10">
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-fg/[0.06] border border-hairline/15 flex items-center justify-center text-xs font-bold text-fg">XLM</div>
                <div>
                  <p className="text-sm font-medium text-fg">Stellar Lumens</p>
                  <p className="text-xs text-fg/40">Native</p>
                </div>
              </div>
              {horizonLoading && !xlmBalance ? (
                <SkeletonText w="w-24" />
              ) : (
                <p className="text-sm font-semibold font-mono text-fg">{xlmBalance ? `${parseFloat(xlmBalance).toLocaleString('en-US', { maximumFractionDigits: 7 })} XLM` : '— XLM'}</p>
              )}
            </div>
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-fg/[0.06] border border-hairline/15 flex items-center justify-center text-xs font-bold text-fg">USDC</div>
                <div>
                  <p className="text-sm font-medium text-fg">USD Coin</p>
                  <p className="text-xs text-fg/40">Stellar / Circle</p>
                </div>
              </div>
              {horizonLoading && !usdcBalance ? (
                <SkeletonText w="w-24" />
              ) : (
                <p className="text-sm font-semibold font-mono text-fg">{usdcBalance ? `$${fmt2(parseFloat(usdcBalance))} USDC` : 'No trustline'}</p>
              )}
            </div>
          </div>
        </MobileCard>

        <MobileCard>
          <SectionHeader title="Trading Summary" />
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs text-fg/45">XLM Bought</p>
              <p className="text-sm font-semibold font-mono text-up">+{fmt7(totalXlmBought)} XLM</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-fg/45">XLM Sold</p>
              <p className="text-sm font-semibold font-mono text-down">-{fmt7(totalXlmSold)} XLM</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-fg/45">USDC Spent</p>
              <p className="text-sm font-semibold font-mono text-down">-${fmt2(totalUsdcSpent)}</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-xs text-fg/45">USDC Received</p>
              <p className="text-sm font-semibold font-mono text-up">+${fmt2(totalUsdcReceived)}</p>
            </div>
          </div>
        </MobileCard>

        <MobileCard noPadding>
          <div className="px-4 pt-4">
            <SectionHeader title="Settled Trades" count={settled.length} />
          </div>
          <OrderList orders={mobileSettled} emptyMessage="No settled trades yet." />
        </MobileCard>

        <MobileCard noPadding>
          <div className="px-4 pt-4">
            <SectionHeader title="Open Orders" count={active.length} />
          </div>
          <OrderList orders={mobileLive} emptyMessage="No active orders." />
        </MobileCard>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 py-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-light tracking-tight text-fg" style={{ fontFamily: '"IBM Plex Sans", sans-serif' }}>Portfolio</h1>
          {address && (
            <p className="text-fg/40 text-xs font-mono mt-0.5">{shortAddress(address)}</p>
          )}
        </div>
        {(horizonLoading || ordersLoading) && (
          <span className="text-xs text-fg/40 flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            Syncing
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="XLM Balance"
          value={xlmBalance ? `${parseFloat(xlmBalance).toLocaleString('en-US', { maximumFractionDigits: 4 })} XLM` : '—'}
          loading={horizonLoading && !xlmBalance}
          accent="neutral"
        />
        <StatCard
          label="USDC Balance"
          value={usdcBalance ? `$${fmt2(parseFloat(usdcBalance))}` : '—'}
          loading={horizonLoading && !usdcBalance}
          accent="neutral"
        />
        <StatCard
          label="Settled Trades"
          value={ordersLoading ? '…' : String(settled.length)}
          loading={ordersLoading}
          accent="blue"
        />
        <StatCard
          label="Active Orders"
          value={ordersLoading ? '…' : String(active.length)}
          loading={ordersLoading}
          accent={active.length > 0 ? 'blue' : 'neutral'}
        />
      </div>

      <div className="bg-panel border border-hairline/10 rounded-lg p-5">
        <SectionHeader title="Holdings" />
        <div className="flex flex-col divide-y divide-hairline/10">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-fg/[0.06] border border-hairline/15 flex items-center justify-center text-xs font-bold text-fg">
                XLM
              </div>
              <div>
                <p className="text-sm font-medium text-fg">Stellar Lumens</p>
                <p className="text-xs text-fg/40">Native</p>
              </div>
            </div>
            <div className="text-right">
              {horizonLoading && !xlmBalance ? (
                <SkeletonText w="w-24" />
              ) : (
                <p className="text-sm font-semibold font-mono text-fg">
                  {xlmBalance
                    ? `${parseFloat(xlmBalance).toLocaleString('en-US', { maximumFractionDigits: 7 })} XLM`
                    : '— XLM'}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-fg/[0.06] border border-hairline/15 flex items-center justify-center text-xs font-bold text-fg">
                USDC
              </div>
              <div>
                <p className="text-sm font-medium text-fg">USD Coin</p>
                <p className="text-xs text-fg/40">Stellar / Circle</p>
              </div>
            </div>
            <div className="text-right">
              {horizonLoading && !usdcBalance ? (
                <SkeletonText w="w-24" />
              ) : (
                <p className="text-sm font-semibold font-mono text-fg">
                  {usdcBalance ? `$${fmt2(parseFloat(usdcBalance))} USDC` : 'No trustline'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-panel border border-hairline/10 rounded-lg p-5">
        <SectionHeader title="Trading Summary" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs text-fg/45">XLM Bought</p>
            <p className="text-sm font-semibold font-mono text-up">
              +{fmt7(totalXlmBought)} XLM
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-fg/45">XLM Sold</p>
            <p className="text-sm font-semibold font-mono text-down">
              -{fmt7(totalXlmSold)} XLM
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-fg/45">USDC Spent</p>
            <p className="text-sm font-semibold font-mono text-down">
              -${fmt2(totalUsdcSpent)}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-fg/45">USDC Received</p>
            <p className="text-sm font-semibold font-mono text-up">
              +${fmt2(totalUsdcReceived)}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-panel border border-hairline/10 rounded-lg p-5">
        <SectionHeader title="Settled Trades" count={settled.length} />
        {ordersLoading ? (
          <div className="animate-pulse h-4 bg-fg/[0.06] rounded w-full" />
        ) : settledDesc.length === 0 ? (
          <p className="text-xs text-fg/40 py-2">No settled trades yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-fg/40 uppercase tracking-wider border-b border-hairline/10">
                  <th className="text-left pb-2 pr-4 font-medium">Time</th>
                  <th className="text-left pb-2 pr-4 font-medium">Side</th>
                  <th className="text-right pb-2 pr-4 font-medium">Qty (XLM)</th>
                  <th className="text-right pb-2 pr-4 font-medium">Fill Price</th>
                  <th className="text-right pb-2 pr-4 font-medium">Value (USDC)</th>
                  <th className="text-right pb-2 pr-4 font-medium">Batch</th>
                  <th className="text-right pb-2 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/10">
                {settledDesc.map((o) => {
                  const fillPrice = apiOrderFillPrice(o);
                  const qty = apiOrderFilledNum(o);
                  const refunded = apiOrderRefundedNum(o);
                  const val = apiOrderValueNum(o);
                  const isBuy = o.direction === 'buy';
                  const ts = o.settled_at ?? o.submitted_at;
                  return (
                    <tr key={o.commitment} className="hover:bg-fg/[0.05] transition-colors">
                      <td className="py-2 pr-4 text-fg/45 whitespace-nowrap">
                        {relativeTime(ts)}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`font-semibold tracking-wide ${
                            isBuy ? 'text-up' : 'text-down'
                          }`}
                        >
                          {o.direction.toUpperCase()}
                        </span>
                        {o.is_partial && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide text-accent bg-accent/10 px-1 py-0.5 rounded">
                            partial
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-fg">
                        {fmt7(qty)}
                        {refunded > 0 && (
                          <span
                            className="block text-[10px] text-fg/40"
                            title={`${fmt2(refunded)} XLM unfilled — refunded to your wallet`}
                          >
                            ↩ {fmt2(refunded)} refunded
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono text-fg">
                        ${fmt2(fillPrice)}
                      </td>
                      <td className={`py-2 pr-4 text-right font-mono ${isBuy ? 'text-down' : 'text-up'}`}>
                        {isBuy ? '-' : '+'}${fmt2(val)}
                      </td>
                      <td className="py-2 pr-4 text-right text-fg/45">
                        {o.batch_id != null ? `#${o.batch_id}` : '—'}
                      </td>
                      <td className="py-2 text-right">
                        {o.settlement_tx_hash ? (
                          <a
                            href={`https://stellar.expert/explorer/testnet/tx/${o.settlement_tx_hash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline font-mono"
                          >
                            {o.settlement_tx_hash.slice(0, 6)}…
                          </a>
                        ) : (
                          <span className="text-fg/30">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-panel border border-hairline/10 rounded-lg p-5">
        <SectionHeader title="Open Orders" count={active.length} />
        {ordersLoading ? (
          <div className="animate-pulse h-4 bg-fg/[0.06] rounded w-full" />
        ) : active.length === 0 ? (
          <p className="text-xs text-fg/40 py-2">No active orders.</p>
        ) : (
          <div className="flex flex-col divide-y divide-hairline/10">
            {active.map((o) => {
              const isBuy = o.direction === 'buy';
              const price = apiOrderFillPrice(o);
              const qty = apiOrderQtyNum(o);
              return (
                <div key={o.commitment} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-fg/[0.05] transition-colors rounded-sm">
                  <span
                    className={`text-xs font-semibold w-8 shrink-0 ${
                      isBuy ? 'text-up' : 'text-down'
                    }`}
                  >
                    {o.direction.toUpperCase()}
                  </span>
                  <span className="text-xs font-mono text-fg w-20 shrink-0">
                    ${fmt2(price)}
                  </span>
                  <span className="text-xs font-mono text-fg/55 w-24 shrink-0">
                    {fmt7(qty)} XLM
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${statusColor(o.status)}`}>
                    {o.status}
                  </span>
                  <span className="text-xs text-fg/40 sm:ml-auto shrink-0">
                    {relativeTime(o.submitted_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
