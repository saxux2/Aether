import { Router } from 'express';
import { getConnectionStatus } from '../db/connection';
import { SorobanService } from '../services/soroban';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  const mongo = getConnectionStatus();
  const soroban = new SorobanService();
  const stellarOk = await soroban.checkStellarConnection().catch(() => false);

  const healthy = mongo === 'connected' && stellarOk;
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    mongodb: mongo,
    stellar: stellarOk ? 'connected' : 'unreachable',
    uptime: Math.floor(process.uptime()),
  });
});
