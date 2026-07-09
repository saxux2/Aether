'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { explorerTxUrl } from '@/utils/constants';

const INPUT =
  'w-full rounded-lg border border-hairline/15 bg-transparent px-3 py-2 text-sm text-fg placeholder:text-fg/30 focus:outline-none focus:border-hairline/40';
const BTN =
  'text-xs px-4 py-2 rounded-lg border border-hairline/15 text-fg/80 hover:text-fg hover:border-hairline/25 hover:bg-fg/[0.05] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-medium whitespace-nowrap';

/** Send-XLM form + tx feedback. Assumes the caller already gates on wallet connection. */
export function SendXlmForm() {
  const { sending, txResult, txError, sendXlm } = useWallet();
  const [destination, setDestination] = useState('');
  const [amount, setAmount] = useState('');

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!destination || !amount) return;
    try {
      await sendXlm(destination, amount);
      setDestination('');
      setAmount('');
    } catch {
      // txError is already surfaced below — nothing further to do here.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={handleSend} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          placeholder="Destination G-address"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          className={`${INPUT} sm:flex-1`}
          disabled={sending}
          required
        />
        <input
          type="number"
          step="0.0000001"
          min="0"
          placeholder="Amount (XLM)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${INPUT} sm:w-36`}
          disabled={sending}
          required
        />
        <button type="submit" disabled={sending} className={BTN}>
          {sending ? 'Sending…' : 'Send XLM'}
        </button>
      </form>

      {txResult && (
        <div className="rounded-lg border border-up/30 bg-up/10 p-3">
          <p className="text-xs text-up">
            Transaction sent! Hash: <span className="font-mono break-all">{txResult.hash}</span>
          </p>
          <a
            href={explorerTxUrl(txResult.hash)}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-up/80 underline"
          >
            View on stellar.expert →
          </a>
        </div>
      )}
      {txError && (
        <div className="rounded-lg border border-down/30 bg-down/10 p-3">
          <p className="text-xs text-down">{txError}</p>
        </div>
      )}
    </div>
  );
}
