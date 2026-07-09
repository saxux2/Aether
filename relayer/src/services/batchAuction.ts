import { config } from '../config';
import { SorobanService } from './soroban';
import { findMatches } from './matcher';
import {
  closeBatchAndOpenNew,
  getAllActiveOrders,
  expireStaleOrders,
  recordMatch,
  markMatchSettled,
  markMatchFailed,
  updateBatchStats,
} from '../db/queries';
import { recordCycleStart, recordCycleSuccess, recordCycleFailure } from './batchAuctionStatus';

export class BatchAuctionService {
  private soroban = new SorobanService();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(`[BatchAuction] Starting — interval: ${config.BATCH_INTERVAL_SECONDS}s`);
    this.intervalId = setInterval(
      () => this.runBatchCycle().catch(err => {
        console.error('[BatchAuction] Cycle error:', err);
        recordCycleFailure(err);
      }),
      config.BATCH_INTERVAL_SECONDS * 1_000
    );
  }

  stop(): void {
    if (this.intervalId) clearInterval(this.intervalId);
    this.running = false;
  }

  async runBatchCycle(): Promise<void> {
    console.log('[BatchAuction] Starting matching cycle...');
    recordCycleStart();

    const { closed_batch_id } = await closeBatchAndOpenNew();
    const expired = await expireStaleOrders();
    if (expired > 0) console.log(`[Batch ${closed_batch_id}] Expired ${expired} stale orders`);

    // Match across ALL resting orders, not just this batch — unmatched orders
    // carry over to subsequent batches until they fill, expire, or are cancelled.
    const activeOrders = await getAllActiveOrders();
    console.log(`[Batch ${closed_batch_id}] ${activeOrders.length} active orders (all batches)`);

    if (activeOrders.length < 2) {
      console.log(`[Batch ${closed_batch_id}] Not enough orders — skipping`);
      recordCycleSuccess();
      return;
    }

    const buyers = activeOrders.filter(o => o.assetIn === 'USDC');
    const sellers = activeOrders.filter(o => o.assetIn === 'XLM');
    // NOTE (v1 on-chain limitation): the relayer-side book supports partial-fill
    // carryover (remainder stays active via filledQuantity), but the v1 contracts
    // (EscrowVault.lock_for_settlement / release) settle an order's escrow in
    // FULL on its first submit_match — a second on-chain settle for the same
    // order panics ("deposit not active"). Off-chain accounting stays correct;
    // per-fill escrow release lands with the v2 contracts.
    const matches = findMatches(buyers, sellers);
    console.log(`[Batch ${closed_batch_id}] Found ${matches.length} matches`);

    let totalXlm = 0n;
    let totalUsdc = 0n;
    let settledCount = 0;
    let failedCount = 0;

    for (const match of matches) {
      let matchId: string | null = null;
      try {
        // 1. Record pending match + apply fills (only FULLY-filled orders flip
        //    to 'matched'; partial-fill remainders stay 'active' for next batch)
        matchId = await recordMatch(closed_batch_id, match);

        // 2. Submit to Soroban MatchingEngine — settles the FILLED amounts
        //    (match.xlmAmount / match.usdcAmount), not the full order quantities
        const txHash = await this.soroban.submitMatch(match);

        // 3. Durable trade history: Match → 'settled' + settledAt + txHash;
        //    fully-filled orders → 'settled'
        await markMatchSettled(matchId, match, txHash);

        totalXlm += match.xlmAmount;
        totalUsdc += match.usdcAmount;
        settledCount++;

        console.log(
          `[Batch ${closed_batch_id}] Settled: ` +
          `${Number(match.xlmAmount) / 1e7} XLM @ $${Number(match.settlementPrice) / 1e6} ` +
          `tx:${txHash.slice(0, 8)}...`
        );
      } catch (err) {
        failedCount++;
        console.error(`[Batch ${closed_batch_id}] Match submission failed:`, err);
        // Mark the match failed and roll back its fills so both orders can
        // rematch next batch. Continue — one failure must not block others.
        if (matchId) {
          const msg = err instanceof Error ? err.message : String(err);
          await markMatchFailed(matchId, match, msg).catch(e =>
            console.error(`[Batch ${closed_batch_id}] Failed to mark match failed:`, e)
          );
        }
      }
    }

    await updateBatchStats(closed_batch_id, {
      match_count: settledCount,
      total_xlm_volume: totalXlm,
      total_usdc_volume: totalUsdc,
    });

    console.log(
      `[Batch ${closed_batch_id}] Complete: ` +
      `${settledCount}/${matches.length} matches settled` +
      (failedCount > 0 ? ` (${failedCount} failed)` : '') +
      `, ${Number(totalXlm) / 1e7} XLM volume`
    );
    // The cycle itself completed even if some individual matches failed
    // (failures are tracked per-match in the DB and don't abort the batch —
    // "is the loop alive" is a different question from "did every match
    // succeed", and this status is only about the former).
    recordCycleSuccess();
  }
}
