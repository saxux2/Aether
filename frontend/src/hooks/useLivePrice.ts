'use client';

import { useQuery } from '@tanstack/react-query';

interface LivePriceData {
  price: number;
  timestamp: number;
}

async function fetchXlmUsdPrice(): Promise<LivePriceData | null> {
  try {
    const res = await fetch('https://api.coinbase.com/v2/prices/XLM-USD/spot');
    if (res.ok) {
      const data = await res.json();
      const amount = data?.data?.amount;
      if (typeof amount === 'string' && amount.trim() !== '' && !isNaN(parseFloat(amount))) {
        return { price: parseFloat(amount), timestamp: Date.now() };
      }
    }
  } catch {
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.stellar?.usd;
      if (typeof price === 'number') {
        return { price, timestamp: Date.now() };
      }
    }
  } catch {
  }

  return null;
}

export function useLivePrice(): { livePrice: number | null; isLoading: boolean; lastUpdated: number | null } {
  const { data, isLoading } = useQuery<LivePriceData | null>({
    queryKey: ['live-price', 'xlm-usd'],
    queryFn: fetchXlmUsdPrice,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  return {
    livePrice: data?.price ?? null,
    isLoading,
    lastUpdated: data?.timestamp ?? null,
  };
}
