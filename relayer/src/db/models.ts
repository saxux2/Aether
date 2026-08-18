import mongoose, { Schema, Document } from 'mongoose';
import type { BatchStatus, OrderStatus, MatchStatus } from '../types';

// ── Counter (for sequential batchId) ────────────────────────────────────────
const CounterSchema = new Schema({ name: String, value: { type: Number, default: 0 } });
export const Counter = mongoose.model('Counter', CounterSchema);

export async function nextBatchId(): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { name: 'batchId' },
    { $inc: { value: 1 } },
    { upsert: true, new: true }
  );
  return counter!.value;
}

// ── Batch ────────────────────────────────────────────────────────────────────
export interface IBatch extends Document {
  batchId: number;
  startedAt: Date;
  endedAt?: Date;
  orderCount: number;
  matchCount: number;
  totalXlmVolume: string; // stored as string — BigInt
  totalUsdcVolume: string;
  status: BatchStatus;
}

const BatchSchema = new Schema<IBatch>({
  batchId: { type: Number, required: true, unique: true },
  startedAt: { type: Date, default: () => new Date() },
  endedAt: Date,
  orderCount: { type: Number, default: 0 },
  matchCount: { type: Number, default: 0 },
  totalXlmVolume: { type: String, default: '0' },
  totalUsdcVolume: { type: String, default: '0' },
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
});

// getCurrentBatch() runs on the submit path and on three read routes:
// findOne({ status: 'open' }).sort({ batchId: -1 }). Batches accrue one per
// BATCH_INTERVAL_SECONDS (~525k/year at the default 60s), so this stops
// being a small collection fairly quickly.
BatchSchema.index({ status: 1, batchId: -1 });

export const Batch = mongoose.model<IBatch>('Batch', BatchSchema);

// ── Order ────────────────────────────────────────────────────────────────────
export interface IOrder extends Document {
  commitment: string;
  nullifier: string;
  traderAddress: string;
  assetIn: string;
  assetOut: string;
  amountIn: string;        // BigInt as string
  revealedPrice: string;   // BigInt as string — v1 trust model
  revealedSalt: string;
  xlmQuantity: string;     // BigInt as string — FULL original quantity (commitment preimage)
  filledQuantity: string;  // BigInt as string — cumulative XLM filled so far (partial fills)
  status: OrderStatus;
  batchId: number;
  submittedAt: Date;
  expiresAt: Date;
  matchedAt?: Date;
  settledAt?: Date;
  stellarTxHash?: string;
}

const OrderSchema = new Schema<IOrder>({
  commitment:     { type: String, required: true, unique: true },
  nullifier:      { type: String, required: true, unique: true },
  traderAddress:  { type: String, required: true },
  assetIn:        { type: String, required: true },
  assetOut:       { type: String, required: true },
  amountIn:       { type: String, required: true },
  revealedPrice:  { type: String },
  revealedSalt:   { type: String },
  xlmQuantity:    { type: String },
  filledQuantity: { type: String, default: '0' },
  status:         { type: String, enum: ['active','matched','settled','expired','cancelled'], default: 'active' },
  batchId:        { type: Number, required: true },
  submittedAt:    { type: Date, default: () => new Date() },
  expiresAt:      { type: Date, required: true },
  matchedAt:      Date,
  settledAt:      Date,
  stellarTxHash:  String,
});

// Index shapes follow the queries in db/queries.ts. Each of these was a
// collection scan (or an index scan followed by an in-memory sort) before.
// getAllActiveOrders() filters on status alone and still uses the compound
// index below as a prefix, so nothing lost the index it had.
OrderSchema.index({ status: 1, expiresAt: 1 });      // expireStaleOrders sweep + getAllActiveOrders
OrderSchema.index({ batchId: 1, status: 1 });        // getActiveOrders(batchId)
OrderSchema.index({ traderAddress: 1, submittedAt: -1 }); // getOrdersByTrader: filter + sort

export const Order = mongoose.model<IOrder>('Order', OrderSchema);

// ── Match ────────────────────────────────────────────────────────────────────
export interface IMatch extends Document {
  batchId: number;
  buyerCommitment: string;
  sellerCommitment: string;
  settlementPrice: string;
  xlmAmount: string;
  usdcAmount: string;
  status: MatchStatus;
  createdAt: Date;
  settledAt?: Date;
  stellarTxHash?: string;
  error?: string;          // failure reason when status === 'failed'
}

const MatchSchema = new Schema<IMatch>({
  batchId:          { type: Number, required: true },
  buyerCommitment:  { type: String, required: true },
  sellerCommitment: { type: String, required: true },
  settlementPrice:  { type: String, required: true },
  xlmAmount:        { type: String, required: true },
  usdcAmount:       { type: String, required: true },
  status:           { type: String, enum: ['pending','settled','failed'], default: 'pending' },
  createdAt:        { type: Date, default: () => new Date() },
  settledAt:        Date,
  stellarTxHash:    String,
  error:            String,
});

MatchSchema.index({ batchId: 1 });
MatchSchema.index({ status: 1, settledAt: -1 });     // getRecentTrades
MatchSchema.index({ status: 1, createdAt: 1 });      // reconcileStalePendingMatches
// The trade-history lookups in routes/orders.ts query
//   { $or: [{ buyerCommitment: ... }, { sellerCommitment: ... }], status }
// and MongoDB can only serve an $or by index union when EVERY branch is
// indexed — one unindexed branch downgrades the whole query to a collection
// scan, which is what both of those routes were doing on every request.
MatchSchema.index({ buyerCommitment: 1 });
MatchSchema.index({ sellerCommitment: 1 });

export const Match = mongoose.model<IMatch>('Match', MatchSchema);
