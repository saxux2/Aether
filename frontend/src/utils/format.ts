/** Format micro-USDC price as human-readable price string. */
export function formatPrice(microUsdc: bigint | string | number): string {
  const n = typeof microUsdc === 'bigint' ? Number(microUsdc) : Number(microUsdc);
  return (n / 1_000_000).toFixed(6);
}

/** Format stroops as human-readable XLM amount. */
export function formatXlm(stroops: bigint | string | number): string {
  const n = typeof stroops === 'bigint' ? Number(stroops) : Number(stroops);
  return (n / 10_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Format Stellar units as human-readable USDC amount. */
export function formatUsdc(units: bigint | string | number): string {
  const n = typeof units === 'bigint' ? Number(units) : Number(units);
  return (n / 10_000_000).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Abbreviate a Stellar address: GABC...XYZ */
export function shortAddress(addr: string): string {
  if (!addr || addr.length < 8) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

/** Abbreviate a commitment/nullifier hash */
export function shortHash(hash: string): string {
  if (!hash || hash.length < 12) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-4)}`;
}

/** Format a timestamp to a readable relative string. */
export function relativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    active:    'bg-accent/10 text-accent border border-accent/20',
    matched:   'bg-accent/10 text-accent border border-accent/20',
    settled:   'bg-up/10 text-up border border-up/25',
    expired:   'bg-fg/[0.05] text-fg/40 border border-hairline/15',
    cancelled: 'bg-down/10 text-down border border-down/25',
  };
  return map[status] ?? 'bg-fg/[0.05] text-fg/40 border border-hairline/15';
}
