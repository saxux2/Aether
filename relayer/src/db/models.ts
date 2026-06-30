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

OrderSchema.index({ status: 1 });
OrderSchema.index({ batchId: 1 });
OrderSchema.index({ traderAddress: 1 });

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
MatchSchema.index({ status: 1, settledAt: -1 });

export const Match = mongoose.model<IMatch>('Match', MatchSchema);
