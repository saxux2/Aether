'use client';

import { useState, useCallback } from 'react';
import { useProver } from '@/hooks/useProver';
import { useOrders } from '@/hooks/useOrders';
import { useWallet } from '@/hooks/useWallet';
import { ProofStatus } from './ProofStatus';
import {
  MIN_ORDER_XLM,
  MAX_ORDER_XLM,
  PRICE_MIN_USD,
  PRICE_MAX_USD,
  DEFAULT_EXPIRY_SECONDS,
  XLM_SCALE,
  PRICE_SCALE,
} from '@/utils/constants';

export function OrderForm() {
  const { connected } = useWallet();
  const { proofState, generateProofs, reset } = useProver();
  const { submitOrder, isSubmitting } = useOrders();

  const [direction, setDirection] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [txError, setTxError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setTxError(null);
      setSuccess(false);

      const qty = parseFloat(quantity);
      const px = parseFloat(price);

      if (!qty || qty < MIN_ORDER_XLM || qty > MAX_ORDER_XLM) {
        setTxError(`Quantity must be between ${MIN_ORDER_XLM} and ${MAX_ORDER_XLM} XLM`);
        return;
      }
      if (!px || px < PRICE_MIN_USD || px > PRICE_MAX_USD) {
        setTxError(`Price must be between ${PRICE_MIN_USD} and ${PRICE_MAX_USD} USDC`);
        return;
      }

      const proofs = await generateProofs({ direction, quantity: qty, price: px });
      if (!proofs) return;

      try {
        const qtyBig = BigInt(Math.round(qty * Number(XLM_SCALE)));
        const pxBig = BigInt(Math.round(px * Number(PRICE_SCALE)));
        const expiresAt = Math.floor(Date.now() / 1000) + DEFAULT_EXPIRY_SECONDS;

        await submitOrder({ direction, quantity: qtyBig, price: pxBig, proofs, expiresAt });
        setSuccess(true);
        setQuantity('');
        setPrice('');
        reset();
      } catch (err) {
        setTxError(err instanceof Error ? err.message : 'Submission failed');
      }
    },
    [direction, quantity, price, generateProofs, submitOrder, reset]
  );

  if (!connected) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-6 text-center text-gray-400">
        Connect your Freighter wallet to place orders.
      </div>
    );
  }

  const isWorking = proofState.status === 'generating' || isSubmitting;

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 border border-gray-700 rounded-lg p-6 flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-white">Place Order</h2>

      {/* Direction toggle */}
      <div className="flex rounded overflow-hidden border border-gray-600">
        {(['buy', 'sell'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${
              direction === d
                ? d === 'buy'
                  ? 'bg-green-700 text-white'
                  : 'bg-red-700 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {d.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Quantity (XLM)</label>
        <input
          type="number"
          min={MIN_ORDER_XLM}
          max={MAX_ORDER_XLM}
          step="1"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="e.g. 1000"
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          required
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400">Limit Price (USDC/XLM)</label>
        <input
          type="number"
          min={PRICE_MIN_USD}
          max={PRICE_MAX_USD}
          step="0.000001"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="e.g. 0.12"
          className="bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          required
        />
      </div>

      <ProofStatus state={proofState} />

      {txError && (
        <p className="text-sm text-red-400">{txError}</p>
      )}
      {success && (
        <p className="text-sm text-green-400">Order submitted successfully.</p>
      )}

      <button
        type="submit"
        disabled={isWorking}
        className={`w-full py-2.5 rounded font-medium text-sm transition-colors disabled:opacity-50 ${
          direction === 'buy'
            ? 'bg-green-700 hover:bg-green-600 text-white'
            : 'bg-red-700 hover:bg-red-600 text-white'
        }`}
      >
        {isWorking
          ? proofState.status === 'generating'
            ? 'Generating proofs...'
            : 'Submitting...'
          : `${direction === 'buy' ? 'Buy' : 'Sell'} XLM`}
      </button>
    </form>
  );
}
