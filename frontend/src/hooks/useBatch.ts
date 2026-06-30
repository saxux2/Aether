'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/utils/api';

interface BatchInfo {
  batch_id: number;
  status: string;
  started_at: string;    // actual field names from relayer/src/routes/orderbook.ts
  ends_at: string;
  order_count: number;
  seconds_remaining: number;
}

export function useBatch() {
  const { data, isLoading, error } = useQuery<BatchInfo>({
    queryKey: ['batch'],
    queryFn: async () => {
      const res = await apiClient.get('/api/orderbook/batch');
      return res.data;
    },
    refetchInterval: 5_000,
  });

  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (data?.seconds_remaining == null) return;
    setCountdown(data.seconds_remaining);

    const timer = setInterval(() => {
      setCountdown((c) => Math.max(0, c - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [data?.seconds_remaining]);

  return {
    batch: data,
    countdown,
    isLoading,
    error,
  };
}
