'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/utils/api';

/* ----------------------------------------------------------------------------
 * Raw wire shapes — written defensively. The relayer is being upgraded to the
 * "new" contract (price / price_micro / direction / tx_hash …); an old server
 * only sends the legacy fields (price_range "$0.1235", settlement_price
 * "$0.123456", amounts in stroops). Every new field is optional here and we
 * normalize with fallbacks so the UI never crashes on either version.
 * ------------------------------------------------------------------------- */

interface RawDepthBucket {
  // new contract
  price?: string;        // "0.1235"
  price_micro?: string;  // "123500"
  order_count?: number;
  // legacy + new
  price_range?: string;  // "$0.1235"
  total_xlm?: string;    // new: "1234.56" (XLM) | legacy: stroops integer string
}

interface RawDepthResponse {
  pair?: string;
  batch_id?: number;
  next_batch_at?: string;
  active_order_count?: number;
  buy_depth_buckets?: RawDepthBucket[];
  sell_depth_buckets?: RawDepthBucket[];
}

interface RawTrade {
  // new contract
  price?: string;            // "0.123456"
  price_micro?: string;
  usdc_amount?: string;
  tx_hash?: string | null;
  direction?: 'up' | 'down' | 'flat';
  // legacy
  settlement_price?: string; // "$0.123456"
  // shared
  xlm_amount?: string;       // new: "100.50" (XLM) | legacy: stroops integer string
  batch_id?: number;
  settled_at?: string;
}

/* ------------------------------- normalized ------------------------------ */

export interface BookLevel {
  price: number;        // USDC per XLM
  priceLabel: string;   // display string, e.g. "0.1235"
  qty: number;          // XLM
  orderCount?: number;
}

export interface BookDepth {
  pair: string;
  batchId: number | null;
  nextBatchAt: string | null;
  activeOrderCount: number;
  bids: BookLevel[]; // sorted highest price first
  asks: BookLevel[]; // sorted lowest price first
}

export interface SettledTrade {
  price: number;
  priceLabel: string;
  qty: number;          // XLM
  usdc: number | null;
  batchId: number | null;
  settledAt: string;
  txHash: string | null;
  direction: 'up' | 'down' | 'flat';
}

/** Pull the first decimal number out of a label like "$0.1235" or "0.12 - 0.13". */
function parseNumeric(label: string | undefined | null): number | null {
  if (!label) return null;
  const m = String(label).match(/\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * Amounts on the new API are decimal XLM strings ("1234.56"); legacy servers
 * sent raw stroops integer strings. If the bucket/trade carries the new
 * `price` field — or the amount has a decimal point — treat it as XLM units.
 */
function toXlm(amount: string | undefined, hasNewFields: boolean): number {
  if (amount == null) return 0;
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  if (hasNewFields || String(amount).includes('.')) return n;
  return n / 10_000_000; // legacy stroops
}

function normalizeBucket(raw: RawDepthBucket): BookLevel | null {
  const isNew = raw.price != null;
  const price =
    parseNumeric(raw.price) ??
    (raw.price_micro != null ? Number(raw.price_micro) / 1_000_000 : null) ??
    parseNumeric(raw.price_range);
  if (price == null) return null;
  return {
    price,
    priceLabel: raw.price ?? price.toFixed(4),
    qty: toXlm(raw.total_xlm, isNew),
    orderCount: raw.order_count,
  };
}

function normalizeTrade(raw: RawTrade, older: RawTrade | undefined): SettledTrade | null {
  const isNew = raw.price != null;
  const price =
    parseNumeric(raw.price) ??
    (raw.price_micro != null ? Number(raw.price_micro) / 1_000_000 : null) ??
    parseNumeric(raw.settlement_price);
  if (price == null) return null;

  // Direction fallback for legacy servers: compare against the previous
  // (older) trade in the list — the list is newest-first.
  let direction: 'up' | 'down' | 'flat' | undefined = raw.direction;
  if (direction !== 'up' && direction !== 'down' && direction !== 'flat') {
    const prev = older
      ? parseNumeric(older.price) ?? parseNumeric(older.settlement_price)
      : null;
    direction = prev == null || price === prev ? 'flat' : price > prev ? 'up' : 'down';
  }

  const usdc = raw.usdc_amount != null ? Number(raw.usdc_amount) : null;

  return {
    price,
    priceLabel: raw.price ?? raw.settlement_price?.replace(/[^0-9.]/g, '') ?? price.toFixed(6),
    qty: toXlm(raw.xlm_amount, isNew),
    usdc: usdc != null && Number.isFinite(usdc) ? usdc : null,
    batchId: raw.batch_id ?? null,
    settledAt: raw.settled_at ?? new Date().toISOString(),
    txHash: raw.tx_hash ?? null,
    direction,
  };
}

/* --------------------------------- hook ---------------------------------- */

export function useOrderBook() {
  const depthQuery = useQuery<BookDepth>({
    queryKey: ['orderbook', 'depth'],
    queryFn: async () => {
      const res = await apiClient.get('/api/orderbook/depth');
      const data: RawDepthResponse = res.data ?? {};
      const bids = (data.buy_depth_buckets ?? [])
        .map(normalizeBucket)
        .filter((b): b is BookLevel => b !== null)
        .sort((a, b) => b.price - a.price); // best (highest) bid first
      const asks = (data.sell_depth_buckets ?? [])
        .map(normalizeBucket)
        .filter((b): b is BookLevel => b !== null)
        .sort((a, b) => a.price - b.price); // best (lowest) ask first
      return {
        pair: data.pair ?? 'XLM/USDC',
        batchId: data.batch_id ?? null,
        nextBatchAt: data.next_batch_at ?? null,
        activeOrderCount: data.active_order_count ?? 0,
        bids,
        asks,
      };
    },
    refetchInterval: 3_000,
  });

  const tradesQuery = useQuery<SettledTrade[]>({
    queryKey: ['orderbook', 'trades'],
    queryFn: async () => {
      const res = await apiClient.get('/api/orderbook/trades', {
        params: { limit: 50 },
      });
      const raw: RawTrade[] = Array.isArray(res.data?.trades)
        ? res.data.trades
        : Array.isArray(res.data)
          ? res.data
          : [];
      // newest-first; pass the next (older) trade for direction fallback
      return raw
        .map((t, i) => normalizeTrade(t, raw[i + 1]))
        .filter((t): t is SettledTrade => t !== null);
    },
    refetchInterval: 4_000,
  });

  return {
    depth: depthQuery.data,
    trades: tradesQuery.data ?? [],
    isLoadingDepth: depthQuery.isLoading,
    isLoadingTrades: tradesQuery.isLoading,
    depthError: depthQuery.error,
    tradesError: tradesQuery.error,
  };
}
