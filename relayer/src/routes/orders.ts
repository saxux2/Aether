import { Router, Request, Response } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { SorobanService } from '../services/soroban';
import { verifyAllProofs } from '../services/proofVerifier';
import {
  getCurrentBatch,
  insertOrder,
  getOrder,
  findOrderByCommitmentOrNullifier,
  updateOrderStatus,
  getOrdersByTrader,
} from '../db/queries';
import { Match } from '../db/models';
import { config } from '../config';
import {
  decodeInvocation,
  scValToAddress,
  scValToBytesHex,
  scValToBigInt,
  scValToU64,
  fieldElementMatchesBytesHex,
} from '../services/txInspect';

export const ordersRouter = Router();

const TRADER_SECRET_MESSAGE_PREFIX = 'zk-dark-pool-secret-v1:';

/**
 * Verify the caller controls `trader`'s key via the same deterministic
 * signature the frontend already produces once at connect time (see
 * frontend/src/utils/stellar.ts deriveTraderSecret) — no extra Freighter
 * prompt needed, but a caller who only knows the public address (and not
 * the private key) cannot forge this.
 */
function verifyTraderProof(trader: string, proof: unknown): boolean {
  if (typeof proof !== 'string' || proof.length === 0) return false;
  try {
    const message = Buffer.from(`${TRADER_SECRET_MESSAGE_PREFIX}${trader}`);
    const signature = Buffer.from(proof, 'base64');
    return Keypair.fromPublicKey(trader).verify(message, signature);
  } catch {
    return false;
  }
}

// POST /api/orders/submit
ordersRouter.post('/submit', async (req: Request, res: Response) => {
  try {
    const {
      trader_address,
      asset_in,
      asset_out,
      amount_in,
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

    // Basic shape validation — fail with a clear 400 instead of an opaque
    // 500 deep inside proof verification or XDR decoding.
    const requiredStrings: Record<string, unknown> = {
      trader_address, asset_in, asset_out, amount_in, commitment, nullifier,
      revealed_price, signed_transaction_xdr,
    };
    for (const [key, value] of Object.entries(requiredStrings)) {
      if (typeof value !== 'string' || value.length === 0) {
        return res.status(400).json({ error: `${key} is required` });
      }
    }
    if (
      !Array.isArray(order_public_signals) || !Array.isArray(balance_public_signals) ||
      !Array.isArray(range_public_signals) ||
      !order_proof || !balance_proof || !range_proof
    ) {
      return res.status(400).json({ error: 'proofs and public signals are required' });
    }

    // Validate trading pair
    if (!(
      (asset_in === 'XLM' && asset_out === 'USDC') ||
      (asset_in === 'USDC' && asset_out === 'XLM')
    )) {
      return res.status(400).json({ error: 'Only XLM/USDC pair supported' });
    }

    // Validate order size
    let amountBig: bigint;
    try {
      amountBig = BigInt(amount_in);
    } catch {
      return res.status(400).json({ error: 'amount_in must be an integer string' });
    }
    if (amountBig <= 0n) {
      return res.status(400).json({ error: 'amount_in must be positive' });
    }

    // Parse revealed_price here, not at the bottom of the handler. It was
    // previously only turned into a BigInt *after* the escrow transaction had
    // been broadcast and confirmed, where a non-numeric string throws
    // SyntaxError and "0" throws RangeError on the USDC→XLM division below —
    // either one unwinding to the catch-all 500 with the trader's funds
    // already locked in the vault and no Order row to match, expire, or
    // cancel them. Both are now plain 400s before anything touches the chain.
    let priceBig: bigint;
    try {
      priceBig = BigInt(revealed_price);
    } catch {
      return res.status(400).json({ error: 'revealed_price must be an integer string' });
    }
    if (priceBig <= 0n) {
      return res.status(400).json({ error: 'revealed_price must be positive' });
    }
    if (asset_in === 'XLM') {
      const xlmAmount = Number(amountBig) / 1e7;
      if (xlmAmount < config.MIN_ORDER_SIZE_XLM) {
        return res.status(400).json({ error: `Minimum order size is ${config.MIN_ORDER_SIZE_XLM} XLM` });
      }
      if (xlmAmount > config.MAX_ORDER_SIZE_XLM) {
        return res.status(400).json({ error: `Maximum order size is ${config.MAX_ORDER_SIZE_XLM} XLM` });
      }
    }

    // ── Bind the request body to the proofs' own public signals ─────────────
    // Without this, the body's commitment/nullifier/amount_in are just
    // unverified JSON — a caller could submit proofs that are individually
    // valid (order/range proofs are self-provable knowledge-of-preimage
    // proofs for any price/quantity/salt an attacker chooses) alongside
    // claims that don't match what they actually prove. Signal layout
    // mirrors order_book.rs's on-chain check exactly.
    if (!order_public_signals[1] || BigInt(order_public_signals[1]) !== BigInt(commitment)) {
      return res.status(400).json({ error: 'order proof commitment does not match request' });
    }
    if (!balance_public_signals[0] || BigInt(balance_public_signals[0]) !== BigInt(nullifier)) {
      return res.status(400).json({ error: 'balance proof nullifier does not match request' });
    }
    if (!balance_public_signals[1] || BigInt(balance_public_signals[1]) !== amountBig) {
      return res.status(400).json({ error: 'balance proof minimum_balance does not match amount_in' });
    }
    if (!range_public_signals[2] || BigInt(range_public_signals[2]) !== BigInt(commitment)) {
      return res.status(400).json({ error: 'range proof commitment does not match request' });
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

    // ── Bind the request body to what the signed transaction actually does ──
    // Decoding the tx and checking it invokes OrderBook.submit_order with
    // matching args means the DB record we're about to write can only ever
    // describe a real, on-chain, ZK-gated order that actually moved funds
    // into escrow — never an unrelated "cheap throwaway" transaction signed
    // with the attacker's own key.
    let invocation;
    try {
      invocation = decodeInvocation(signed_transaction_xdr);
    } catch (err) {
      return res.status(400).json({ error: `Could not decode signed_transaction_xdr: ${err instanceof Error ? err.message : String(err)}` });
    }
    if (invocation.contractId !== config.ORDER_BOOK_ADDRESS) {
      return res.status(400).json({ error: 'signed transaction does not target OrderBook' });
    }
    if (invocation.functionName !== 'submit_order') {
      return res.status(400).json({ error: 'signed transaction is not submit_order' });
    }
    // submit_order(trader, commitment, nullifier, asset_in, asset_out, amount_in,
    //              order_proof, order_signals, balance_proof, balance_signals,
    //              range_proof, range_signals, expires_at) — see order_book/src/lib.rs.
    const [argTrader, argCommitment, argNullifier, , , argAmountIn] = invocation.args;
    const argExpiresAt = invocation.args[12];
    if (!argTrader || scValToAddress(argTrader) !== trader_address) {
      return res.status(400).json({ error: 'signed transaction trader does not match request' });
    }
    if (!argCommitment || !fieldElementMatchesBytesHex(commitment, scValToBytesHex(argCommitment))) {
      return res.status(400).json({ error: 'signed transaction commitment does not match request' });
    }
    if (!argNullifier || !fieldElementMatchesBytesHex(nullifier, scValToBytesHex(argNullifier))) {
      return res.status(400).json({ error: 'signed transaction nullifier does not match request' });
    }
    if (!argAmountIn || scValToBigInt(argAmountIn) !== amountBig) {
      return res.status(400).json({ error: 'signed transaction amount_in does not match request' });
    }

    // ── Order expiry comes from the signed transaction, never from the body ──
    // The DB's expiresAt drives expireStaleOrders(); the on-chain expires_at
    // drives EscrowVault.expire(). Deriving the former from the request body's
    // `expires_in_seconds` let the two disagree — and, because that field was
    // never validated, `parseInt(undefined) * 1000` produced an Invalid Date
    // that Mongoose rejects *after* the escrow tx had already been broadcast
    // and confirmed, stranding the trader's funds on-chain with no order row
    // to ever match, expire, or cancel them. expires_at is the one submit_order
    // argument that wasn't bound here; read it from the tx and both layers
    // agree by construction.
    let expiresAtSeconds: bigint;
    try {
      if (!argExpiresAt) throw new Error('missing expires_at argument');
      expiresAtSeconds = scValToU64(argExpiresAt);
    } catch {
      return res.status(400).json({ error: 'signed transaction has no valid expires_at' });
    }
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    if (expiresAtSeconds <= nowSeconds) {
      return res.status(400).json({ error: 'signed transaction expires_at is already in the past' });
    }
    // Cap the lifetime a client can ask for. An unbounded expiry rests an order
    // in the book — and its escrow on-chain — indefinitely. CLOCK_SKEW_GRACE
    // absorbs a client whose clock runs slightly ahead of ours; without it a
    // caller that honestly asked for exactly ORDER_EXPIRY_SECONDS could be
    // rejected for being a few seconds over.
    const CLOCK_SKEW_GRACE_SECONDS = 300n;
    const maxLifetime = BigInt(config.ORDER_EXPIRY_SECONDS) + CLOCK_SKEW_GRACE_SECONDS;
    if (expiresAtSeconds - nowSeconds > maxLifetime) {
      return res.status(400).json({
        error: `Order lifetime exceeds the maximum of ${config.ORDER_EXPIRY_SECONDS}s`,
      });
    }

    // ── Reject a replay before spending a chain round-trip on it ───────────
    // commitment and nullifier both carry a unique index. A resubmitted order
    // used to be discovered only by insertOrder throwing E11000 — after
    // broadcast + waitForConfirmation had already run — which the catch-all
    // reported as an opaque 500 "Order submission failed" rather than the 409
    // it is. OrderBook.submit_order rejects the reused nullifier on-chain
    // anyway; this just gets the right answer to the caller without the
    // round-trip.
    const existing = await findOrderByCommitmentOrNullifier(commitment, nullifier);
    if (existing) {
      return res.status(409).json({
        error: 'Order already submitted',
        order_id: existing.commitment,
        batch_id: existing.batchId,
      });
    }

    // Broadcast pre-signed Soroban transaction
    const soroban = new SorobanService();
    const txHash = await soroban.broadcastTransaction(signed_transaction_xdr);
    await soroban.waitForConfirmation(txHash);

    const batch = await getCurrentBatch();
    const expiresAt = new Date(Number(expiresAtSeconds) * 1000);

    // Compute XLM quantity for matching
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
    // Two identical submissions racing can both pass the pre-check above and
    // reach insertOrder; the unique index is what actually decides, and the
    // loser gets E11000. That's still a duplicate, not a server fault.
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      return res.status(409).json({ error: 'Order already submitted' });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[orders/submit]', msg);
    return res.status(500).json({ error: 'Order submission failed' });
  }
});

ordersRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { trader } = req.query;
    if (!trader || typeof trader !== 'string') {
      return res.status(400).json({ error: 'trader query param is required' });
    }
    // Order history includes not-yet-matched orders' revealed price — only
    // the trader who can prove they hold this address's key may read it.
    // Read from a header, not a query param: it's a non-rotating bearer
    // credential (the same signature for the life of the session), and a
    // GET query string ends up in server/proxy access logs and is readable
    // by any script on the page via the Performance API — a header isn't.
    const proof = req.header('X-Trader-Proof');
    if (!verifyTraderProof(trader, proof)) {
      return res.status(401).json({ error: 'Missing or invalid trader proof' });
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
    console.error('[orders/list]', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'Failed to load orders' });
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
    console.error('[orders/get]', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'Failed to load order' });
  }
});

// DELETE /api/orders/:commitment — cancel
ordersRouter.delete('/:commitment', async (req: Request, res: Response) => {
  try {
    const { signed_cancel_xdr } = req.body;
    if (typeof signed_cancel_xdr !== 'string' || signed_cancel_xdr.length === 0) {
      return res.status(400).json({ error: 'signed_cancel_xdr is required' });
    }

    const order = await getOrder(req.params.commitment);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // ── Bind the signed transaction to THIS commitment ──────────────────────
    // Without this, any successfully-broadcastable transaction (signed with
    // an attacker's own, unrelated key) could be submitted here while the
    // URL names a victim's commitment, and the relayer would mark the
    // victim's still-escrowed order cancelled in its own bookkeeping even
    // though EscrowVault's real funds never moved.
    let invocation;
    try {
      invocation = decodeInvocation(signed_cancel_xdr);
    } catch (err) {
      return res.status(400).json({ error: `Could not decode signed_cancel_xdr: ${err instanceof Error ? err.message : String(err)}` });
    }
    if (invocation.contractId !== config.ORDER_BOOK_ADDRESS) {
      return res.status(400).json({ error: 'signed transaction does not target OrderBook' });
    }
    if (invocation.functionName !== 'cancel') {
      return res.status(400).json({ error: 'signed transaction is not cancel' });
    }
    const [argTrader, argCommitment] = invocation.args;
    if (!argTrader || scValToAddress(argTrader) !== order.traderAddress) {
      return res.status(400).json({ error: 'signed transaction trader does not match order' });
    }
    if (!argCommitment || !fieldElementMatchesBytesHex(req.params.commitment, scValToBytesHex(argCommitment))) {
      return res.status(400).json({ error: 'signed transaction commitment does not match URL' });
    }

    const soroban = new SorobanService();
    const txHash = await soroban.broadcastTransaction(signed_cancel_xdr);
    await soroban.waitForConfirmation(txHash);
    await updateOrderStatus(req.params.commitment, 'cancelled');
    return res.json({ success: true, tx_hash: txHash });
  } catch (err: unknown) {
    console.error('[orders/cancel]', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ error: 'Cancel failed' });
  }
});
