import { Router, Request, Response } from 'express';
import { getCurrentBatch, getAllActiveOrders, getRecentTrades } from '../db/queries';
import { config } from '../config';

export const orderbookRouter = Router();

const BUCKET_SIZE = 500n;        // $0.0005 per bucket in micro-USDC
const PRICE_DIVISOR = 1_000_000; // micro-USDC → USDC
const STROOP_DIVISOR = 10_000_000;

// GET /api/orderbook/depth — aggregated anonymised depth
orderbookRouter.get('/depth', async (_req: Request, res: Response) => {
  try {
    const batch = await getCurrentBatch();
    // Show the full resting book — orders persist across batches until filled/expired.
    const orders = await getAllActiveOrders();

    const buyOrders = orders.filter(o => o.assetIn === 'USDC');
    const sellOrders = orders.filter(o => o.assetIn === 'XLM');

    // side: bids sorted DESC (best bid first), asks ASC (best ask first).
    // Sort on the bigint bucket price — the old "$0.xxxx" lexicographic sort
    // ordered "$10.0000" before "$9.0000".
    const aggregate = (list: typeof orders, side: 'bids' | 'asks') => {
      const buckets = new Map<string, { xlm: bigint; count: number }>();
      for (const o of list) {
        const key = ((o.revealedPrice / BUCKET_SIZE) * BUCKET_SIZE).toString();
        const b = buckets.get(key) ?? { xlm: 0n, count: 0 };
        b.xlm += o.remainingQuantity; // unfilled remainder only — not original size
        b.count += 1;
        buckets.set(key, b);
      }
      return [...buckets.entries()]
        .map(([key, b]) => ({ priceMicro: BigInt(key), ...b }))
        .sort((a, b) => {
          const cmp = a.priceMicro < b.priceMicro ? -1 : a.priceMicro > b.priceMicro ? 1 : 0;
          return side === 'bids' ? -cmp : cmp;
        })
        .map(b => ({
          price_range: `$${(Number(b.priceMicro) / PRICE_DIVISOR).toFixed(4)}`,
          total_xlm: (Number(b.xlm) / STROOP_DIVISOR).toFixed(2),
          price: (Number(b.priceMicro) / PRICE_DIVISOR).toFixed(4),
          price_micro: b.priceMicro.toString(),
          order_count: b.count,
        }));
    };

    return res.json({
      pair: 'XLM/USDC',
      batch_id: batch.batchId,
      next_batch_at: new Date(
        batch.startedAt.getTime() + config.BATCH_INTERVAL_SECONDS * 1000
      ).toISOString(),
      buy_depth_buckets: aggregate(buyOrders, 'bids'),
      sell_depth_buckets: aggregate(sellOrders, 'asks'),
      active_order_count: orders.length,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/orderbook/trades?limit=N — recent settled trades, newest first
orderbookRouter.get('/trades', async (req: Request, res: Response) => {
  try {
    const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

    // Fetch one extra so the oldest trade in the window can still compute its
    // direction against its chronological predecessor.
    const docs = await getRecentTrades(limit + 1);

    const trades = docs.slice(0, limit).map((t, i) => {
      const price = BigInt(t.settlementPrice);
      const prev = docs[i + 1]; // newest-first ⇒ next index = chronologically previous
      let direction: 'up' | 'down' | 'flat' = 'flat';
      if (prev) {
        const prevPrice = BigInt(prev.settlementPrice);
        direction = price > prevPrice ? 'up' : price < prevPrice ? 'down' : 'flat';
      }
      const settledAt = t.settledAt ?? t.createdAt;
      return {
        price: (Number(price) / PRICE_DIVISOR).toFixed(6),
        price_micro: price.toString(),
        xlm_amount: (Number(t.xlmAmount) / STROOP_DIVISOR).toFixed(2),
        usdc_amount: (Number(t.usdcAmount) / STROOP_DIVISOR).toFixed(2),
        batch_id: t.batchId,
        settled_at: new Date(settledAt).toISOString(),
        tx_hash: t.stellarTxHash ?? null,
        direction,
      };
    });

    return res.json({ trades });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// GET /api/orderbook/batch — current batch countdown
orderbookRouter.get('/batch', async (_req: Request, res: Response) => {
  try {
    const batch = await getCurrentBatch();
    const endsAt = new Date(
      batch.startedAt.getTime() + config.BATCH_INTERVAL_SECONDS * 1000
    );
    const secondsRemaining = Math.max(
      0,
      Math.floor((endsAt.getTime() - Date.now()) / 1000)
    );

    return res.json({
      batch_id: batch.batchId,
      started_at: batch.startedAt,
      ends_at: endsAt,
      seconds_remaining: secondsRemaining,
      order_count: batch.orderCount,
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
