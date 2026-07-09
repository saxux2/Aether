import { config } from '../config';

/**
 * Shared liveness state for the batch auction loop, decoupled from
 * BatchAuctionService itself so the health route (wired up before
 * BatchAuctionService is constructed in index.ts's main()) can read it
 * without needing a dependency-injection pass. A single Node process, so
 * module-level state is sufficient — no need for anything fancier.
 *
 * This exists because the health endpoint previously only checked
 * MongoDB/Stellar RPC connectivity — a relayer whose Express server and DB
 * connection are both fine but whose batch cycle has silently stopped
 * advancing (e.g. an uncaught state left the interval callback wedged)
 * would have reported "healthy" the entire time.
 */
const serviceStartedAt = new Date();
let lastCycleStartedAt: Date | null = null;
let lastCycleCompletedAt: Date | null = null;
let lastCycleError: string | null = null;

export function recordCycleStart(): void {
  lastCycleStartedAt = new Date();
}

export function recordCycleSuccess(): void {
  lastCycleCompletedAt = new Date();
  lastCycleError = null;
}

export function recordCycleFailure(err: unknown): void {
  lastCycleError = err instanceof Error ? err.message : String(err);
}

export interface BatchAuctionStatus {
  last_cycle_started_at: string | null;
  last_cycle_completed_at: string | null;
  last_cycle_error: string | null;
  /** No successful cycle within 3x the configured interval — the loop is
   * either wedged, crashed, or has never completed a cycle since startup. */
  stale: boolean;
}

export function getBatchAuctionStatus(): BatchAuctionStatus {
  const staleThresholdMs = config.BATCH_INTERVAL_SECONDS * 1_000 * 3;
  // Before the loop's first cycle has had a chance to run, measure staleness
  // from process/service startup instead of from a null cycle timestamp —
  // otherwise every fresh deploy would report "stale" for up to one interval
  // before it's actually had a chance to prove itself wedged.
  const reference = lastCycleCompletedAt ?? serviceStartedAt;
  const stale = Date.now() - reference.getTime() > staleThresholdMs;

  return {
    last_cycle_started_at: lastCycleStartedAt?.toISOString() ?? null,
    last_cycle_completed_at: lastCycleCompletedAt?.toISOString() ?? null,
    last_cycle_error: lastCycleError,
    stale,
  };
}
