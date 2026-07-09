import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { connectDB } from './db/connection';
import { ordersRouter } from './routes/orders';
import { orderbookRouter } from './routes/orderbook';
import { healthRouter } from './routes/health';
import { statusRouter } from './routes/status';
import { BatchAuctionService } from './services/batchAuction';
import { reconcileStalePendingMatches } from './db/queries';

const app = express();

app.use(cors({ origin: config.ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '2mb' })); // proofs are large JSON payloads

// Order submission and cancellation each verify a Groth16 proof bundle and/or
// broadcast + poll a Soroban transaction — expensive enough per-request that
// an unthrottled burst can starve real traders. Read-only routes are exempt.
const writeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down' },
});
app.use('/api/orders/submit', writeLimiter);
app.use('/api/orders/:commitment', (req, res, next) =>
  req.method === 'DELETE' ? writeLimiter(req, res, next) : next()
);

app.use('/api/orders', ordersRouter);
app.use('/api/orderbook', orderbookRouter);
app.use('/api/health', healthRouter);
app.use('/api/status', statusRouter);

// 404 catch-all
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler — never forward err.message to the client (may
// contain internal Soroban/Mongo error detail); log it server-side instead.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function main() {
  await connectDB();

  // Crash-recovery: a process restart (crash, deploy, OOM) between
  // recordMatch() flipping both sides of a pair to 'matched' and the
  // on-chain submission actually settling leaves that Match stuck 'pending'
  // and both orders stuck 'matched' forever — getAllActiveOrders() only
  // pulls status:'active', so they'd never be reconsidered. Reconcile any
  // match that's been pending longer than a few batch cycles by rolling it
  // back to 'active' so it can be re-matched.
  const reconciled = await reconcileStalePendingMatches();
  if (reconciled > 0) {
    console.warn(`[Startup] Reconciled ${reconciled} stale pending match(es) from a previous run`);
  }

  const batchAuction = new BatchAuctionService();
  batchAuction.start();

  const server = app.listen(config.PORT, () => {
    console.log(`[Relayer] Listening on port ${config.PORT}`);
    console.log(`[Relayer] Network: ${config.STELLAR_NETWORK}`);
    console.log(`[Relayer] Batch interval: ${config.BATCH_INTERVAL_SECONDS}s`);
  });

  const shutdown = () => {
    batchAuction.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // Without these, an unhandled rejection anywhere (e.g. a floating promise
  // in the batch-auction loop or a route handler) crashes the process with
  // no clear record of why. Log with full context and exit non-zero so a
  // process manager restarts a clean process instead of leaving one running
  // in a possibly-corrupted state.
  process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] Unhandled promise rejection:', reason);
    process.exit(1);
  });
  process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught exception:', err);
    process.exit(1);
  });
}

main().catch(err => {
  console.error('[Startup]', err);
  process.exit(1);
});
