import { Batch, Order, Match, nextBatchId, type IBatch, type IOrder, type IMatch } from './models';
import type { OrderStatus, MatchResult, ActiveOrder } from '../types';

// ── Batch queries ─────────────────────────────────────────────────────────────

export async function getCurrentBatch(): Promise<IBatch> {
  let batch = await Batch.findOne({ status: 'open' }).sort({ batchId: -1 });
  if (!batch) {
    const id = await nextBatchId();
    batch = await Batch.create({ batchId: id });
  }
  return batch;
}

export async function closeBatchAndOpenNew(): Promise<{
  closed_batch_id: number;
  new_batch_id: number;
}> {
  const current = await getCurrentBatch();
  await Batch.updateOne(
    { batchId: current.batchId },
    { $set: { status: 'closed', endedAt: new Date() } }
  );

  const newId = await nextBatchId();
  await Batch.create({ batchId: newId });

  return { closed_batch_id: current.batchId, new_batch_id: newId };
}

export async function updateBatchStats(
  batchId: number,
  stats: { match_count: number; total_xlm_volume: bigint; total_usdc_volume: bigint }
): Promise<void> {
  await Batch.updateOne(
    { batchId },
    {
      $set: {
        matchCount: stats.match_count,
        totalXlmVolume: stats.total_xlm_volume.toString(),
        totalUsdcVolume: stats.total_usdc_volume.toString(),
      },
    }
  );
}

// ── Order queries ─────────────────────────────────────────────────────────────

export interface InsertOrderParams {
  commitment: string;
  nullifier: string;
  traderAddress: string;
  assetIn: string;
  assetOut: string;
  amountIn: bigint;
  revealedPrice: bigint;
  revealedSalt?: string;
  xlmQuantity?: bigint | null;
  batchId: number;
  expiresAt: Date;
  stellarTxHash: string;
}

export async function insertOrder(params: InsertOrderParams): Promise<IOrder> {
  const order = await Order.create({
    commitment: params.commitment,
    nullifier: params.nullifier,
    traderAddress: params.traderAddress,
    assetIn: params.assetIn,
    assetOut: params.assetOut,
    amountIn: params.amountIn.toString(),
    revealedPrice: params.revealedPrice.toString(),
    revealedSalt: params.revealedSalt ?? '',
    xlmQuantity: params.xlmQuantity?.toString() ?? '0',
    batchId: params.batchId,
    expiresAt: params.expiresAt,
    stellarTxHash: params.stellarTxHash,
  });
  await Batch.updateOne({ batchId: params.batchId }, { $inc: { orderCount: 1 } });
  return order;
}

export async function getOrder(commitment: string): Promise<IOrder | null> {
  return Order.findOne({ commitment });
}

export async function updateOrderStatus(commitment: string, status: OrderStatus): Promise<void> {
  const update: Record<string, unknown> = { status };
  if (status === 'matched') update.matchedAt = new Date();
  if (status === 'settled') update.settledAt = new Date();
  await Order.updateOne({ commitment }, { $set: update });
}

function toActiveOrder(d: IOrder): ActiveOrder {
  const xlmQuantity = BigInt(d.xlmQuantity ?? '0');
  const filledQuantity = BigInt(d.filledQuantity ?? '0');
  return {
    commitment: d.commitment,
    nullifier: d.nullifier,
    traderAddress: d.traderAddress,
    assetIn: d.assetIn as 'XLM' | 'USDC',
    assetOut: d.assetOut as 'XLM' | 'USDC',
    amountIn: BigInt(d.amountIn),
    revealedPrice: BigInt(d.revealedPrice),
    xlmQuantity,
    filledQuantity,
    remainingQuantity: xlmQuantity - filledQuantity,
    revealedSalt: d.revealedSalt ?? '',
    submittedAt: d.submittedAt,
  };
}

export async function getActiveOrders(batchId: number): Promise<ActiveOrder[]> {
  const docs = await Order.find({ batchId, status: 'active' });
  return docs.map(toActiveOrder).filter(o => o.remainingQuantity > 0n);
}

/**
 * All resting orders that are still active, regardless of which batch they were
 * submitted in. Orders rest across batches until matched, expired, or cancelled —
 * matching and the public order book both operate on this full set.
 * Partially-filled orders stay 'active' with remainingQuantity > 0.
 */
export async function getAllActiveOrders(): Promise<ActiveOrder[]> {
  const docs = await Order.find({ status: 'active' });
  return docs.map(toActiveOrder).filter(o => o.remainingQuantity > 0n);
}

export async function expireStaleOrders(): Promise<number> {
  const result = await Order.updateMany(
    { status: 'active', expiresAt: { $lt: new Date() } },
    { $set: { status: 'expired' } }
  );
  return result.modifiedCount;
}

export async function getOrdersByTrader(traderAddress: string): Promise<IOrder[]> {
  return Order.find({ traderAddress }).sort({ submittedAt: -1 }).limit(50);
}

// ── Match queries ─────────────────────────────────────────────────────────────

/**
 * Apply a fill to an order: record filledQuantity and promote the order to
 * 'matched'.
 *
 * SINGLE-SETTLEMENT (v1 escrow): an order's deposit settles exactly once. At
 * settle time the EscrowVault pays the matched amount to the counterparty and
 * REFUNDS the unfilled remainder to the depositor (see matcher.ts). So ANY fill
 * fully resolves the order on-chain — there is no resting remainder to carry to
 * a later batch. We therefore flip to 'matched' on the first fill regardless of
 * whether it was a full or partial fill; filledQuantity records how much
 * actually traded (the rest was refunded). markMatchSettled later flips
 * 'matched' → 'settled'. (True resting remainders return with v2 per-fill escrow.)
 */
async function applyFill(commitment: string, fillAmount: bigint): Promise<void> {
  const order = await Order.findOne({ commitment });
  if (!order) throw new Error(`applyFill: order ${commitment} not found`);

  const total = BigInt(order.xlmQuantity ?? '0');
  const filled = BigInt(order.filledQuantity ?? '0') + fillAmount;
  if (filled > total) {
    throw new Error(`applyFill: overfill on ${commitment} (${filled} > ${total})`);
  }

  await Order.updateOne(
    { commitment },
    { $set: { filledQuantity: filled.toString(), status: 'matched', matchedAt: new Date() } }
  );
}

/**
 * Reverse a fill after a failed on-chain settlement: roll back filledQuantity
 * and return a fully-filled-but-unsettled order to 'active' so it can rematch.
 */
async function revertFill(commitment: string, fillAmount: bigint): Promise<void> {
  const order = await Order.findOne({ commitment });
  if (!order) return;

  let filled = BigInt(order.filledQuantity ?? '0') - fillAmount;
  if (filled < 0n) filled = 0n;

  const update: Record<string, unknown> = { filledQuantity: filled.toString() };
  // Only un-match orders that were not yet settled. ('settled' here would mean
  // a different match for this order already settled — leave that state alone.)
  if (order.status === 'matched') {
    update.status = 'active';
    update.matchedAt = null;
  }
  await Order.updateOne({ commitment }, { $set: update });
}

/**
 * Record a pending match and apply the fill to both orders.
 * Returns the Match document id, used to settle/fail THIS match later
 * (commitment alone is ambiguous — one order may span several matches).
 */
export async function recordMatch(batchId: number, match: MatchResult): Promise<string> {
  const doc = await Match.create({
    batchId,
    buyerCommitment: match.buyerCommitment,
    sellerCommitment: match.sellerCommitment,
    settlementPrice: match.settlementPrice.toString(),
    xlmAmount: match.xlmAmount.toString(),
    usdcAmount: match.usdcAmount.toString(),
    status: 'pending',
  });

  // Apply the FILLED amount to both sides; only fully-filled orders flip to 'matched'.
  await applyFill(match.buyerCommitment, match.xlmAmount);
  await applyFill(match.sellerCommitment, match.xlmAmount);

  return String(doc._id);
}

/** On-chain settlement succeeded: durably record tx hash + settle timestamps. */
export async function markMatchSettled(
  matchId: string,
  match: MatchResult,
  stellarTxHash: string
): Promise<void> {
  await Match.updateOne(
    { _id: matchId },
    { $set: { status: 'settled', settledAt: new Date(), stellarTxHash } }
  );
  // Single-settlement: any matched order (full or partial fill) is fully
  // resolved on-chain, so promote 'matched' → 'settled'. The filled portion
  // traded; any remainder was refunded by the EscrowVault at settle time.
  const settleMatched = (commitment: string) =>
    Order.updateOne(
      { commitment, status: 'matched' },
      { $set: { status: 'settled', settledAt: new Date() } }
    );
  await Promise.all([
    settleMatched(match.buyerCommitment),
    settleMatched(match.sellerCommitment),
  ]);
}

/** On-chain settlement failed: mark the match failed and roll back the fills. */
export async function markMatchFailed(
  matchId: string,
  match: MatchResult,
  error: string
): Promise<void> {
  await Match.updateOne(
    { _id: matchId },
    { $set: { status: 'failed', error: error.slice(0, 500) } }
  );
  await revertFill(match.buyerCommitment, match.xlmAmount);
  await revertFill(match.sellerCommitment, match.xlmAmount);
}

export async function getRecentTrades(limit = 50): Promise<IMatch[]> {
  return Match.find({ status: 'settled' })
    .sort({ settledAt: -1 })
    .limit(limit);
}
