import express from 'express';
import cors from 'cors';
import { config } from './config';
import { connectDB } from './db/connection';
import { ordersRouter } from './routes/orders';
import { orderbookRouter } from './routes/orderbook';
import { healthRouter } from './routes/health';
import { statusRouter } from './routes/status';
import { BatchAuctionService } from './services/batchAuction';

const app = express();

app.use(cors({ origin: config.ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' })); // proofs are large JSON payloads

app.use('/api/orders', ordersRouter);
app.use('/api/orderbook', orderbookRouter);
app.use('/api/health', healthRouter);
app.use('/api/status', statusRouter);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: err.message });
});

async function main() {
  await connectDB();

  const batchAuction = new BatchAuctionService();
  batchAuction.start();

  app.listen(config.PORT, () => {
    console.log(`[Relayer] Listening on port ${config.PORT}`);
    console.log(`[Relayer] Network: ${config.STELLAR_NETWORK}`);
    console.log(`[Relayer] Batch interval: ${config.BATCH_INTERVAL_SECONDS}s`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    batchAuction.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[Startup]', err);
  process.exit(1);
});
