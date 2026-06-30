import { Router } from 'express';
import { getCurrentBatch } from '../db/queries';
import { config } from '../config';

export const statusRouter = Router();

statusRouter.get('/', async (_req, res) => {
  try {
    const batch = await getCurrentBatch();
    return res.json({
      running: true,
      network: config.STELLAR_NETWORK,
      batch_interval_seconds: config.BATCH_INTERVAL_SECONDS,
      current_batch_id: batch.batchId,
      order_book_address: config.ORDER_BOOK_ADDRESS || 'not set',
      matching_engine_address: config.MATCHING_ENGINE_ADDRESS || 'not set',
      uptime_seconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '0.1.0',
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
