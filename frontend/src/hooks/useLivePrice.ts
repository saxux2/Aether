'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchXlmUsdPrice, type LivePriceData } from '@/lib/priceFeed';

export function useLivePrice(): { livePrice: number | null; isLoading: boolean; lastUpdated: number | null } {
  const { data, isLoading } = useQuery<LivePriceData | null>({
    queryKey: ['live-price', 'xlm-usd'],
    queryFn: () => fetchXlmUsdPrice(),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  return {
    livePrice: data?.price ?? null,
    isLoading,
    lastUpdated: data?.timestamp ?? null,
  };
}
