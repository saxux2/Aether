import { Router } from 'express';
import { getConnectionStatus } from '../db/connection';
import { SorobanService } from '../services/soroban';
import { getBatchAuctionStatus } from '../services/batchAuctionStatus';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const mongo = getConnectionStatus();
  const soroban = new SorobanService();
  const stellarOk = await soroban.checkStellarConnection().catch(() => false);
  const batchAuction = getBatchAuctionStatus();

  // A relayer whose Express server, DB connection, and Soroban RPC are all
  // fine but whose batch cycle has silently stopped advancing (e.g. an
  // uncaught state left the interval callback wedged) would previously have
  // reported "healthy" the entire time — batch_auction.stale closes that gap.
  const healthy = mongo === 'connected' && stellarOk && !batchAuction.stale;
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    mongodb: mongo,
    stellar: stellarOk ? 'connected' : 'unreachable',
    batch_auction: batchAuction,
    uptime: Math.floor(process.uptime()),
  });
});
