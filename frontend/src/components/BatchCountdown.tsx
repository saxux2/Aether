'use client';

import { useBatch } from '@/hooks/useBatch';

export function BatchCountdown() {
  const { batch, countdown } = useBatch();

  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  const label = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const totalSeconds = 60; // batch interval
  const pct = batch ? (countdown / totalSeconds) * 100 : 0;

  return (
    <div className="flex flex-col gap-1 min-w-[120px]">
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>Batch #{batch?.batch_id ?? '—'}</span>
        <span className="font-mono text-white">{label}</span>
      </div>
      <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-1000"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{batch?.order_count ?? 0} orders</span>
        <span>{batch?.status ?? 'loading'}</span>
      </div>
    </div>
  );
}
