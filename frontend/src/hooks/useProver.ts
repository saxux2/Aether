'use client';

import { useState, useCallback } from 'react';
import { useWalletStore } from '@/store/walletSlice';
import { XLM_SCALE, PRICE_SCALE, computeEscrowAmount } from '@/utils/constants';
import { getEscrowBalance } from '@/utils/stellar';
import type { GeneratedProofs } from '@/lib/sdk/types';

export type ProofState =
  | { status: 'idle' }
  | { status: 'generating'; step: string }
  | { status: 'done'; proofs: GeneratedProofs }
  | { status: 'error'; message: string };

export function useProver() {
  const { traderSecret, address } = useWalletStore();
  const [proofState, setProofState] = useState<ProofState>({ status: 'idle' });

  const generateProofs = useCallback(
    async (params: {
      direction: 'buy' | 'sell';
      quantity: number;   // XLM
      price: number;      // USD per XLM
    }) => {
      if (!traderSecret) {
        setProofState({ status: 'error', message: 'Wallet not connected' });
        return null;
      }

      setProofState({ status: 'generating', step: 'Loading ZK libraries...' });
      try {
        const [{ generateOrderProofs }, { randomFieldElement }] = await Promise.all([
          import('@/lib/sdk/prover'),
          import('@/lib/sdk/commitment'),
        ]);

        const quantityBig = BigInt(Math.round(params.quantity * Number(XLM_SCALE)));
        const priceBig = BigInt(Math.round(params.price * Number(PRICE_SCALE)));
        const salt = randomFieldElement();
        const nonce = randomFieldElement();

        // The real amount escrowed for this order — must match buildOrderTx's
        // amountIn exactly, since order_book checks the balance proof's
        // minimum_balance against the on-chain amount_in.
        const escrowAmount = computeEscrowAmount(params.direction, quantityBig, priceBig);

        setProofState({ status: 'generating', step: 'Fetching wallet balance...' });
        const balance = await getEscrowBalance(
          address ?? '',
          params.direction === 'buy' ? 'USDC' : 'XLM'
        );

        setProofState({ status: 'generating', step: 'Generating ZK proofs (this takes ~30s)...' });
        const proofs = await generateOrderProofs(
          {
            price: priceBig,
            quantity: quantityBig,
            direction: BigInt(params.direction === 'buy' ? 0 : 1),
            salt,
            secret: traderSecret,
            nonce,
            balance,
            escrowAmount,
          },
          '/circuits'
        );

        setProofState({ status: 'done', proofs });
        return proofs;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Proof generation failed';
        setProofState({ status: 'error', message: msg });
        return null;
      }
    },
    [traderSecret, address]
  );

  const reset = useCallback(() => setProofState({ status: 'idle' }), []);

  return { proofState, generateProofs, reset };
}
