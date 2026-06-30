import { Router, Request, Response } from 'express';
import { SorobanService } from '../services/soroban';
import { verifyAllProofs } from '../services/proofVerifier';
import { getCurrentBatch, insertOrder, getOrder, updateOrderStatus, getOrdersByTrader } from '../db/queries';
import { Match } from '../db/models';
import { config } from '../config';

export const ordersRouter = Router();

// POST /api/orders/submit
ordersRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const {
      trader_address,
      asset_in,
      asset_out,
      amount_in,
      expires_in_seconds,
      commitment,
      nullifier,
      revealed_price,
      revealed_salt,
      order_proof,
      order_public_signals,
      balance_proof,
      balance_public_signals,
      range_proof,
      range_public_signals,
      signed_transaction_xdr,
    } = req.body;

    // Validate trading pair
    if (!(
      (asset_in === 'XLM' && asset_out === 'USDC') ||
      (asset_in === 'USDC' && asset_out === 'XLM')
    )) {
      return res.status(400).json({ error: 'Only XLM/USDC pair supported' });
    }

    // Validate order size
    const amountBig = BigInt(amount_in);
    if (asset_in === 'XLM') {
      const xlmAmount = Number(amountBig) / 1e7;
      if (xlmAmount < config.MIN_ORDER_SIZE_XLM) {
        return res.status(400).json({ error: `Minimum order size is ${config.MIN_ORDER_SIZE_XLM} XLM` });
      }
      if (xlmAmount > config.MAX_ORDER_SIZE_XLM) {
        return res.status(400).json({ error: `Maximum order size is ${config.MAX_ORDER_SIZE_XLM} XLM` });
      }
    }

    // Off-chain proof pre-verification (fast reject before on-chain cost)
    const proofValid = await verifyAllProofs({
      order_proof, order_public_signals,
      balance_proof, balance_public_signals,
      range_proof, range_public_signals,
    });

    if (!proofValid) {
      return res.status(400).json({ error: 'Invalid ZK proof' });
    }

    // Broadcast pre-signed Soroban transaction
    const soroban = new SorobanService();
    const txHash = await soroban.broadcastTransaction(signed_transaction_xdr);
    await soroban.waitForConfirmation(txHash);

    const batch = await getCurrentBatch();
    const expiresAt = new Date(Date.now() + parseInt(expires_in_seconds) * 1000);

    // Compute XLM quantity for matching
    const priceBig = BigInt(revealed_price);
    const PRICE_SCALE = 1_000_000n;
    const xlmQuantity =
      asset_in === 'XLM'
        ? amountBig
        : (amountBig * PRICE_SCALE) / priceBig; // USDC -> XLM equivalent

    // Store in DB — revealed_price is sensitive (v1 trust model)
    await insertOrder({
      commitment,
      nullifier,
      traderAddress: trader_address,
      assetIn: asset_in,
      assetOut: asset_out,
      amountIn: amountBig,
      revealedPrice: priceBig,
      revealedSalt: revealed_salt,
      xlmQuantity,
      batchId: batch.batchId,
      expiresAt,
      stellarTxHash: txHash,
    });

    return res.json({
      success: true,
      order_id: commitment,
      batch_id: batch.batchId,
      tx_hash: txHash,
      estimated_match_at: new Date(
        Date.now() + config.BATCH_INTERVAL_SECONDS * 1000
      ).toISOString(),
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[orders/submit]', msg);
    return res.status(500).json({ error: msg });
  }
});

ordersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { trader } = req.query;
    if (!trader || typeof trader !== 'string') {
      return res.status(400).json({ error: 'trader query param is required' });
    }

    const orders = await getOrdersByTrader(trader);
    const commitments = orders.map((o) => o.commitment);

    // All settled matches touching this trader's orders, newest first.
    const matches = await Match.find({
      $or: [
        { buyerCommitment: { $in: commitments } },
        { sellerCommitment: { $in: commitments } },
      ],
      status: 'settled',
    }).sort({ settledAt: -1 });

    // Aggregate per commitment: an order can (in principle) span several settled
    // matches, so SUM the traded XLM/USDC and keep the most-recent match for the
    // settlement price + tx hash.
    type Agg = { xlm: bigint; usdc: bigint; price: bigint; tx: string | null };
    const aggByCommitment = new Map<string, Agg>();
    const fold = (commitment: string, m: typeof matches[0]) => {
      const prev = aggByCommitment.get(commitment);
      if (prev) {
        prev.xlm += BigInt(m.xlmAmount);
        prev.usdc += BigInt(m.usdcAmount);
      } else {
        aggByCommitment.set(commitment, {
          xlm: BigInt(m.xlmAmount),
          usdc: BigInt(m.usdcAmount),
          price: BigInt(m.settlementPrice),
          tx: m.stellarTxHash ?? null,
        });
      }
    };
    for (const match of matches) {
      fold(match.buyerCommitment, match);
      fold(match.sellerCommitment, match);
    }

    const STROOPS = 10_000_000n; // 1e7 — XLM stroops & 7-decimal USDC
    const result = orders.map((order) => {
      const agg = aggByCommitment.get(order.commitment) ?? null;
      const direction = order.assetIn === 'USDC' ? 'buy' : 'sell';

      const orderXlm = BigInt(order.xlmQuantity ?? '0');         // full order size
      // Prefer the order's own filledQuantity; fall back to the summed match XLM.
      const filledXlm = BigInt(order.filledQuantity ?? '0') || (agg ? agg.xlm : 0n);
      const refundedXlm = orderXlm > filledXlm ? orderXlm - filledXlm : 0n;

      const isSettled = order.status === 'settled';
      const isPartial = isSettled && filledXlm > 0n && filledXlm < orderXlm;

      // display_status drives the UI buckets:
      //   active → open order; settling → matched on-chain in flight;
      //   filled → fully settled; partially_filled → settled, remainder refunded.
      const display_status =
        order.status === 'matched'
          ? 'settling'
          : isPartial
            ? 'partially_filled'
            : isSettled
              ? 'filled'
              : order.status; // active | expired | cancelled

      const settlement_price = agg
        ? (Number(agg.price) / 1_000_000).toFixed(6)
        : null;
      const settlement_tx_hash = agg?.tx ?? null;
      const usdc_amount = agg
        ? (Number(agg.usdc) / Number(STROOPS)).toFixed(2)
        : null;

      return {
        commitment: order.commitment,
        direction,
        status: order.status,
        display_status,
        asset_in: order.assetIn,
        asset_out: order.assetOut,
        amount_in: order.amountIn,
        xlm_quantity: order.xlmQuantity ?? '0',
        // Full order size (XLM); kept for backward-compat.
        xlm_amount: (Number(orderXlm) / Number(STROOPS)).toFixed(2),
        // What actually traded vs what was refunded (partial fills).
        filled_quantity: filledXlm.toString(),
        filled_xlm: (Number(filledXlm) / Number(STROOPS)).toFixed(2),
        refunded_xlm: (Number(refundedXlm) / Number(STROOPS)).toFixed(2),
        is_partial: isPartial,
        revealed_price: order.revealedPrice,
        batch_id: order.batchId,
        submitted_at: order.submittedAt,
        expires_at: order.expiresAt,
        matched_at: order.matchedAt ?? null,
        settled_at: order.settledAt ?? null,
        stellar_tx_hash: order.stellarTxHash ?? null,
        settlement_price,
        settlement_tx_hash,
        usdc_amount,
      };
    });

    return res.json({ orders: result });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/orders/:commitment
ordersRouter.get('/:commitment', async (req: Request, res: Response) => {
  try {
    const order = await getOrder(req.params.commitment);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Settled match(es) this order participated in — drives the settlement
    // tx link, fill price, and partial-fill (refund) info in the UI.
    const matches = await Match.find({
      $or: [{ buyerCommitment: order.commitment }, { sellerCommitment: order.commitment }],
      status: 'settled',
    }).sort({ settledAt: -1 });

    const STROOPS = 10_000_000n;
    let settledXlm = 0n;
    let settledUsdc = 0n;
    for (const m of matches) {
      settledXlm += BigInt(m.xlmAmount);
      settledUsdc += BigInt(m.usdcAmount);
    }
    const latest = matches[0] ?? null;

    const orderXlm = BigInt(order.xlmQuantity ?? '0');
    const filledXlm = BigInt(order.filledQuantity ?? '0') || settledXlm;
    const refundedXlm = orderXlm > filledXlm ? orderXlm - filledXlm : 0n;
    const isPartial = order.status === 'settled' && filledXlm > 0n && filledXlm < orderXlm;

    return res.json({
      commitment: order.commitment,
      status: order.status,
      batch_id: order.batchId,
      asset_in: order.assetIn,
      asset_out: order.assetOut,
      amount_in: order.amountIn,
      xlm_quantity: order.xlmQuantity ?? '0',
      filled_quantity: filledXlm.toString(),
      filled_xlm: (Number(filledXlm) / Number(STROOPS)).toFixed(2),
      refunded_xlm: (Number(refundedXlm) / Number(STROOPS)).toFixed(2),
      is_partial: isPartial,
      submitted_at: order.submittedAt,
      expires_at: order.expiresAt,
      matched_at: order.matchedAt,
      settled_at: order.settledAt,
      stellar_tx_hash: order.stellarTxHash,
      settlement_price: latest ? (Number(BigInt(latest.settlementPrice)) / 1_000_000).toFixed(6) : null,
      settlement_tx_hash: latest?.stellarTxHash ?? null,
      settled_usdc: matches.length ? (Number(settledUsdc) / Number(STROOPS)).toFixed(2) : null,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// DELETE /api/orders/:commitment — cancel
ordersRouter.delete('/:commitment', async (req: Request, res: Response) => {
  try {
    const { signed_cancel_xdr } = req.body;
    const soroban = new SorobanService();
    const txHash = await soroban.broadcastTransaction(signed_cancel_xdr);
    await soroban.waitForConfirmation(txHash);
    await updateOrderStatus(req.params.commitment, 'cancelled');
    return res.json({ success: true, tx_hash: txHash });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
