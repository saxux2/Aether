'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useProver } from '@/hooks/useProver';
import { useOrders } from '@/hooks/useOrders';
import { useWallet } from '@/hooks/useWallet';
import { useBatch } from '@/hooks/useBatch';
import { useOrderBook } from '@/hooks/useOrderBook';
import { ProofStatus } from '@/components/ProofStatus';
import {
  MIN_ORDER_XLM,
  MAX_ORDER_XLM,
  PRICE_MIN_USD,
  PRICE_MAX_USD,
  DEFAULT_EXPIRY_SECONDS,
  XLM_SCALE,
  PRICE_SCALE,
  STELLAR_HORIZON_URL,
} from '@/utils/constants';

interface HorizonBalanceEntry {
  asset_type?: string;
  asset_code?: string;
  balance?: string;
}

interface AccountBalances {
  xlm: number;
  usdc: number;
}

const PCT_STEPS = [0, 25, 50, 75, 100] as const;

function useAccountBalances(address: string | null, connected: boolean) {
  return useQuery<AccountBalances>({
    queryKey: ['horizon-balances', address],
    queryFn: async () => {
      try {
        const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
        if (!res.ok) return { xlm: 0, usdc: 0 }; // 404 = unfunded account
        const data = await res.json();
        const entries: HorizonBalanceEntry[] = Array.isArray(data?.balances)
          ? data.balances
          : [];
        let xlm = 0;
        let usdc = 0;
        for (const b of entries) {
          const amount = Number(b.balance ?? 0);
          if (!Number.isFinite(amount)) continue;
          if (b.asset_type === 'native') xlm = amount;
          else if (b.asset_code === 'USDC') usdc = amount;
        }
        return { xlm, usdc };
      } catch {
        return { xlm: 0, usdc: 0 };
      }
    },
    enabled: connected && !!address,
    refetchInterval: 15_000,
    retry: false,
  });
}

export function TradePanel() {
  const { address, connected, connecting, connect } = useWallet();
  const { proofState, generateProofs, reset } = useProver();
  const { submitOrder, isSubmitting } = useOrders();
  const { countdown } = useBatch();
  const { trades } = useOrderBook();
  const balanceQuery = useAccountBalances(address, connected);

  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [pct, setPct] = useState(0);
  const [txError, setTxError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const xlmBalance = balanceQuery.data?.xlm ?? 0;
  const usdcBalance = balanceQuery.data?.usdc ?? 0;
  const balancesLoaded = balanceQuery.data != null;

  // Prefill price once from the last trade, then leave it to the user.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (!prefilledRef.current && trades.length > 0) {
      prefilledRef.current = true;
      setPrice(trades[0].price.toFixed(4));
    }
  }, [trades]);

  const qtyNum = parseFloat(quantity) || 0;
  const priceNum = parseFloat(price) || 0;
  const orderValue = qtyNum > 0 && priceNum > 0 ? qtyNum * priceNum : null;

  const qtyForPct = useCallback(
    (p: number): number => {
      if (!balancesLoaded) return 0;
      if (side === 'buy') {
        if (priceNum <= 0) return 0;
        return Math.max(0, Math.round(((usdcBalance * p) / 100 / priceNum) * 100) / 100);
      }
      return Math.max(0, Math.round(((xlmBalance * p) / 100) * 100) / 100);
    },
    [balancesLoaded, side, priceNum, usdcBalance, xlmBalance]
  );

  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    const p = Number(e.target.value);
    setPct(p);
    if (!connected || !balancesLoaded) return;
    if (side === 'buy' && priceNum <= 0) return;
    setQuantity(qtyForPct(p).toFixed(2));
  };

  const handleQuantityChange = (value: string) => {
    setQuantity(value);
    const typed = parseFloat(value) || 0;
    const match = PCT_STEPS.find((p) => Math.abs(qtyForPct(p) - typed) < 0.005);
    setPct(match ?? 0);
  };

  const switchSide = (s: 'buy' | 'sell') => {
    setSide(s);
    setPct(0);
  };

  const sliderDisabled =
    !connected ||
    !balancesLoaded ||
    (side === 'buy' ? usdcBalance <= 0 : xlmBalance <= 0);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTxError(null);
      setSuccess(false);

      const qty = parseFloat(quantity);
      const px = parseFloat(price);

      if (!qty || qty < MIN_ORDER_XLM || qty > MAX_ORDER_XLM) {
        setTxError(`Quantity must be between ${MIN_ORDER_XLM} and ${MAX_ORDER_XLM} XLM`);
        return;
      }
      if (!px || px < PRICE_MIN_USD || px > PRICE_MAX_USD) {
        setTxError(`Price must be between ${PRICE_MIN_USD} and ${PRICE_MAX_USD} USDC`);
        return;
      }

      const proofs = await generateProofs({ direction: side, quantity: qty, price: px });
      if (!proofs) return;

      try {
        const qtyBig = BigInt(Math.round(qty * Number(XLM_SCALE)));
        const pxBig = BigInt(Math.round(px * Number(PRICE_SCALE)));
        const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS;

        await submitOrder({ direction: side, quantity: qtyBig, price: pxBig, proofs, expiresAt });
        setSuccess(true);
        setQuantity('');
        setPct(0);
        reset();
      } catch (err) {
        setTxError(err instanceof Error ? err.message : 'Submission failed');
      }
    },
    [side, quantity, price, generateProofs, submitOrder, reset]
  );

  const isWorking = proofState.status === 'generating' || isSubmitting;

  const balanceLabel = !connected
    ? '—'
    : side === 'buy'
      ? `${usdcBalance.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })} USDC`
      : `${xlmBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} XLM`;

  const mm = String(Math.floor(countdown / 60)).padStart(2, '0');
  const ss = String(countdown % 60).padStart(2, '0');

  const inputClass =
    'w-full bg-fg/[0.04] border border-hairline/20 rounded-md px-3 py-2 pr-14 text-sm font-mono text-fg placeholder:text-fg/30 focus:border-accent focus:outline-none disabled:opacity-50';

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-9 items-center justify-between border-b border-hairline/10 px-3">
        <span className="text-[13px] font-medium text-fg">Trade</span>
        <span className="text-[11px] text-fg/30">Spot · Sealed</span>
      </div>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Buy / Sell segmented control */}
        <div className="p-3">
          <div className="flex rounded-md bg-fg/[0.04] p-0.5">
            <button
              type="button"
              onClick={() => switchSide('buy')}
              className={`flex-1 rounded py-1.5 text-sm transition-colors ${
                side === 'buy'
                  ? 'bg-up font-semibold text-white'
                  : 'text-fg/45 hover:text-fg/70'
              }`}
            >
              Buy
            </button>
            <button
              type="button"
              onClick={() => switchSide('sell')}
              className={`flex-1 rounded py-1.5 text-sm transition-colors ${
                side === 'sell'
                  ? 'bg-down font-semibold text-white'
                  : 'text-fg/45 hover:text-fg/70'
              }`}
            >
              Sell
            </button>
          </div>
        </div>

        {/* Order type */}
        <div className="flex items-center gap-3 px-3 text-[12px]">
          <span className="relative pb-1 font-medium text-fg">
            Limit
            <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-accent" />
          </span>
          <button
            type="button"
            disabled
            title="Dark pool runs sealed limit orders only — matched in batch auctions"
            className="cursor-not-allowed pb-1 text-fg/25"
          >
            Market
          </button>
        </div>

        {/* Available balance */}
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-[11px] text-fg/40">Available Balance</span>
          <span className="font-mono text-xs tabular-nums text-fg/70">{balanceLabel}</span>
        </div>

        {/* Inputs */}
        <div className="flex flex-col gap-2.5 px-3">
          <div className="relative">
            <input
              type="number"
              min={PRICE_MIN_USD}
              max={PRICE_MAX_USD}
              step="0.000001"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="Price"
              disabled={!connected}
              className={inputClass}
              aria-label="Price (USDC)"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg/40">
              USDC
            </span>
          </div>

          <div className="relative">
            <input
              type="number"
              min={MIN_ORDER_XLM}
              max={MAX_ORDER_XLM}
              step="1"
              value={quantity}
              onChange={(e) => handleQuantityChange(e.target.value)}
              placeholder="Quantity"
              disabled={!connected}
              className={inputClass}
              aria-label="Quantity (XLM)"
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg/40">
              XLM
            </span>
          </div>

          {/* Percentage slider */}
          <div className={sliderDisabled ? 'opacity-40' : ''}>
            <input
              type="range"
              min={0}
              max={100}
              step={25}
              value={pct}
              onChange={handleSlider}
              disabled={sliderDisabled}
              className="terminal-range w-full"
              aria-label="Percentage of balance"
            />
            <div className="flex justify-between text-[10px] text-fg/30">
              <span>0%</span>
              <span>25%</span>
              <span>50%</span>
              <span>75%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Order value */}
          <div className="flex items-center justify-between border-t border-hairline/10 pt-2">
            <span className="text-[11px] text-fg/40">Order Value</span>
            <span className="font-mono text-xs tabular-nums text-fg/70">
              {orderValue != null ? `${orderValue.toFixed(2)} USDC` : '—'}
            </span>
          </div>

          {/* Settlement countdown */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-fg/40">Settles in next auction</span>
            <span className="font-mono text-xs tabular-nums text-accent">
              {mm}:{ss}
            </span>
          </div>

          <ProofStatus state={proofState} />

          {txError && <p className="text-xs text-down">{txError}</p>}
          {success && <p className="text-xs text-up">Order sealed &amp; submitted</p>}
        </div>

        {/* Submit */}
        <div className="mt-auto px-3 pb-3 pt-3">
          {connected ? (
            <button
              type="submit"
              disabled={isWorking}
              className={`w-full rounded-md py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50 ${
                side === 'buy' ? 'bg-up' : 'bg-down'
              }`}
            >
              {isWorking
                ? proofState.status === 'generating'
                  ? 'Generating ZK proofs…'
                  : 'Submitting…'
                : side === 'buy'
                  ? 'Buy XLM'
                  : 'Sell XLM'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => connect()}
              disabled={connecting}
              className="w-full rounded-md bg-up py-2.5 text-sm font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50"
            >
              {connecting ? 'Connecting…' : 'Connect Freighter Wallet'}
            </button>
          )}
        </div>

        {/* Privacy note */}
        <p className="px-3 pb-3 text-[10px] leading-4 text-fg/30">
          Orders are sealed with a Poseidon commitment — size &amp; price are hidden from the
          market until the batch auction settles.
        </p>
      </form>
    </div>
  );
}
