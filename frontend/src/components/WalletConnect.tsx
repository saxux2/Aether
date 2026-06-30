'use client';

import { useWallet } from '@/hooks/useWallet';

const BTN_CLASS =
  'text-[11px] px-4 py-2 rounded-xl border border-hairline/15 text-fg/60 hover:text-fg hover:border-hairline/25 hover:bg-fg/[0.05] transition-all duration-200 tracking-wide';

export function WalletConnect() {
  const { address, connected, connecting, error, connect, disconnect } = useWallet();

  if (connected && address) {
    return (
      <button
        onClick={disconnect}
        title="Disconnect wallet"
        className={`${BTN_CLASS}`}
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      >
        <span>DISCONNECT WALLET</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={connect}
        disabled={connecting}
        title={error ?? undefined}
        className={`${BTN_CLASS} disabled:opacity-60`}
        style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
      >
        {connecting ? 'CONNECTING…' : 'CONNECT WALLET'}
      </button>
      {error && <p className="text-[10px] text-down">{error}</p>}
    </div>
  );
}
