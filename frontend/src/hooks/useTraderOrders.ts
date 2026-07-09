'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/utils/api';
import { useWalletStore } from '@/store/walletSlice';

export interface ApiOrder {
  commitment: string;
  direction: 'buy' | 'sell';
  status: string;
  /** UI bucket: active | settling | filled | partially_filled | expired | cancelled */
  display_status: string;
  asset_in: string;
  asset_out: string;
  amount_in: string;
  xlm_quantity: string;
  xlm_amount: string;        // full order size (XLM)
  filled_quantity: string;   // stroops actually traded
  filled_xlm: string;        // XLM actually traded
  refunded_xlm: string;      // unfilled remainder refunded on-chain
  is_partial: boolean;       // settled for less than the full quantity
  revealed_price: string;
  batch_id: number;
  submitted_at: string;
  expires_at: string;
  matched_at: string | null;
  settled_at: string | null;
  stellar_tx_hash: string | null;
  settlement_price: string | null;
  settlement_tx_hash: string | null;
  usdc_amount: string | null;
}

export function useTraderOrders(address: string | null, connected: boolean) {
  const traderSecretProof = useWalletStore((s) => s.traderSecretProof);

  return useQuery<ApiOrder[]>({
    queryKey: ['trader-orders', address],
    queryFn: async () => {
      // X-Trader-Proof lets the relayer verify we actually control
      // `address`'s key before returning order history (which includes
      // not-yet-matched orders' revealed price) — see deriveTraderSecret's
      // doc comment. Sent as a header, not a query param: it's a
      // non-rotating bearer credential (the same signature for the life of
      // the session), and a GET query string ends up in server/proxy access
      // logs and is readable by ANY script on the page via
      // performance.getEntriesByType('resource') — which exposes full
      // request URLs regardless of origin, unlike timing details, which are
      // gated by Timing-Allow-Origin. This page loads a third-party
      // TradingView embed script, so that's not a hypothetical co-tenant.
      const res = await apiClient.get('/api/orders', {
        params: { trader: address },
        headers: { 'X-Trader-Proof': traderSecretProof },
      });
      return (res.data.orders ?? []) as ApiOrder[];
    },
    enabled: connected && !!address && !!traderSecretProof,
    refetchInterval: 10_000,
    retry: false,
    staleTime: 5_000,
  });
}
