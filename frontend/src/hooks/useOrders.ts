'use client';

import { useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/utils/api';
import { useOrdersStore } from '@/store/ordersSlice';
import { useWalletStore } from '@/store/walletSlice';
import type { GeneratedProofs } from '@/lib/sdk/types';
import { buildOrderTx, buildCancelTx, signWithFreighter } from '@/utils/stellar';
import { computeEscrowAmount } from '@/utils/constants';

const FINAL_STATUSES = new Set(['settled', 'expired', 'cancelled']);

/**
 * Build a LocalOrder patch from a relayer order-status response.
 * Written defensively: field names vary between relayer versions
 * (stellar_tx_hash vs tx_hash, settlement_price may be absent).
 */
function patchFromServer(data: Record<string, unknown> | undefined) {
  if (!data) return null;
  const patch: {
    status?: string;
    settledAt?: string;
    settlementTxHash?: string;
    settlementPrice?: string;
    filledXlm?: string;
    refundedXlm?: string;
    isPartial?: boolean;
  } = {};
  if (typeof data.status === 'string') patch.status = data.status;
  if (typeof data.settled_at === 'string') patch.settledAt = data.settled_at;
  // Prefer the on-chain SETTLEMENT tx for the history link; fall back to the
  // order's submit tx only if no settlement tx is reported yet.
  const txHash = data.settlement_tx_hash ?? data.stellar_tx_hash ?? data.tx_hash;
  if (typeof txHash === 'string' && txHash.length > 0) patch.settlementTxHash = txHash;
  const price = data.settlement_price ?? data.fill_price;
  if (typeof price === 'string' && price.length > 0) {
    patch.settlementPrice = price.replace(/[^0-9.]/g, '');
  }
  if (typeof data.filled_xlm === 'string') patch.filledXlm = data.filled_xlm;
  if (typeof data.refunded_xlm === 'string') patch.refundedXlm = data.refunded_xlm;
  if (typeof data.is_partial === 'boolean') patch.isPartial = data.is_partial;
  return Object.keys(patch).length > 0 ? patch : null;
}

interface SubmitOrderParams {
  direction: 'buy' | 'sell';
  quantity: bigint;    // XLM in stroops
  price: bigint;       // micro-USDC per XLM
  proofs: GeneratedProofs;
  expiresAt: number;   // unix timestamp (seconds)
}

export function useOrders() {
  const queryClient = useQueryClient();
  const { address } = useWalletStore();
  const { addOrder, updateOrderStatus, updateOrder } = useOrdersStore();
  const localOrders = useOrdersStore((s) => s.orders);

  // Poll the relayer every 8 s for any order that hasn't reached a terminal state.
  // This keeps the UI in sync when the batch auction settles or expires an order.
  useEffect(() => {
    const poll = async () => {
      const pending = localOrders.filter((o) => !FINAL_STATUSES.has(o.status));
      if (pending.length === 0) return;
      await Promise.allSettled(
        pending.map(async (o) => {
          try {
            const res = await apiClient.get(`/api/orders/${o.commitment}`);
            const patch = patchFromServer(res.data);
            if (patch && (patch.status !== o.status || patch.settlementTxHash || patch.settledAt)) {
              updateOrder(o.id, patch);
            }
          } catch {
            // ignore transient fetch errors
          }
        })
      );
    };

    poll(); // immediate first check
    const id = setInterval(poll, 8_000);
    return () => clearInterval(id);
  }, [localOrders, updateOrder]);

  const submitMutation = useMutation({
    mutationFn: async (params: SubmitOrderParams) => {
      if (!address) throw new Error('Wallet not connected');

      const txXdr = await buildOrderTx({
        trader: address,
        direction: params.direction,
        quantity: params.quantity,
        price: params.price,
        proofs: params.proofs,
        expiresAt: params.expiresAt,
      });

      const signedXdr = await signWithFreighter(txXdr);

      // Seconds from now for expiry
      const expiresInSeconds = Math.max(0, params.expiresAt - Math.floor(Date.now() / 1000));

      // Build relayer-compatible payload (field names match relayer/src/routes/orders.ts)
      const payload = {
        trader_address: address,
        asset_in: params.direction === 'buy' ? 'USDC' : 'XLM',
        asset_out: params.direction === 'buy' ? 'XLM' : 'USDC',
        amount_in: computeEscrowAmount(params.direction, params.quantity, params.price).toString(),
        expires_in_seconds: expiresInSeconds,
        commitment: params.proofs.commitment,
        nullifier: params.proofs.nullifier,
        revealed_price: params.price.toString(),
        revealed_salt: params.proofs.salt,
        order_proof: params.proofs.orderProof,
        order_public_signals: params.proofs.orderPublicSignals,
        balance_proof: params.proofs.balanceProof,
        balance_public_signals: params.proofs.balancePublicSignals,
        range_proof: params.proofs.rangeProof,
        range_public_signals: params.proofs.rangePublicSignals,
        signed_transaction_xdr: signedXdr,
      };

      const res = await apiClient.post('/api/orders/submit', payload);
      return res.data as {
        success: boolean;
        order_id: string;
        batch_id: number;
        tx_hash: string;
        estimated_match_at: string;
      };
    },
    onSuccess: (data, params) => {
      addOrder({
        id: data.order_id,           // commitment hash — relayer returns as order_id
        commitment: params.proofs.commitment,
        nullifier: params.proofs.nullifier,
        direction: params.direction,
        quantity: params.quantity,
        price: params.price,
        status: 'active',
        createdAt: new Date().toISOString(),
        batchId: data.batch_id,
        salt: BigInt(params.proofs.salt),
      });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => {
      if (!address) throw new Error('Wallet not connected');

      // Cancelling reclaims escrowed funds on-chain (OrderBook.cancel), so it
      // needs the order's commitment and a fresh Freighter signature — not
      // just a relayer DB update. The commitment is only known locally (the
      // relayer's GET /api/orders response never returns it in a form we can
      // sign against), so this only works for orders this session placed or
      // has already seen; after a hard refresh with no local copy, there's
      // nothing to sign and we fail loudly instead of sending a bogus empty
      // XDR that would silently 500 on the relayer.
      const local = localOrders.find((o) => o.id === orderId || o.commitment === orderId);
      if (!local) {
        throw new Error('Cannot cancel: this order was not placed in the current session.');
      }

      const unsignedXdr = await buildCancelTx(address, local.commitment);
      const signedXdr = await signWithFreighter(unsignedXdr);

      await apiClient.delete(`/api/orders/${orderId}`, {
        data: { signed_cancel_xdr: signedXdr },
      });
      return orderId;
    },
    onSuccess: (orderId) => {
      updateOrderStatus(orderId, 'cancelled');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const refreshOrder = useCallback(
    async (orderId: string) => {
      const res = await apiClient.get(`/api/orders/${orderId}`);
      const patch = patchFromServer(res.data);
      if (patch) updateOrder(orderId, patch);
    },
    [updateOrder]
  );

  return {
    orders: localOrders,
    submitOrder: submitMutation.mutateAsync,
    cancelOrder: cancelMutation.mutateAsync,
    refreshOrder,
    isSubmitting: submitMutation.isPending,
    isCancelling: cancelMutation.isPending,
    submitError: submitMutation.error,
    cancelError: cancelMutation.error,
  };
}
