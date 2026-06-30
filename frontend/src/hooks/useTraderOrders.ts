'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/utils/api';

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
  return useQuery<ApiOrder[]>({
    queryKey: ['trader-orders', address],
    queryFn: async () => {
      const res = await apiClient.get('/api/orders', { params: { trader: address } });
      return (res.data.orders ?? []) as ApiOrder[];
    },
    enabled: connected && !!address,
    refetchInterval: 10_000,
    retry: false,
    staleTime: 5_000,
  });
}
