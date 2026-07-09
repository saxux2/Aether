import {
  getBatchAuctionStatus,
  recordCycleStart,
  recordCycleSuccess,
  recordCycleFailure,
} from './batchAuctionStatus';

// BATCH_INTERVAL_SECONDS defaults to 60 when unset (see config.ts), so the
// stale threshold this module derives is 3 * 60 * 1000 = 180_000ms.
const STALE_THRESHOLD_MS = 180_000;

describe('batchAuctionStatus', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is not stale immediately after module load, even with zero cycles completed', () => {
    // Grace period from service-startup time, not from a null timestamp —
    // otherwise every fresh deploy would report stale before the loop had a
    // chance to run even once.
    const status = getBatchAuctionStatus();
    expect(status.last_cycle_completed_at).toBeNull();
    expect(status.stale).toBe(false);
  });

  it('reports not stale right after a successful cycle', () => {
    recordCycleStart();
    recordCycleSuccess();
    const status = getBatchAuctionStatus();
    expect(status.last_cycle_completed_at).not.toBeNull();
    expect(status.last_cycle_error).toBeNull();
    expect(status.stale).toBe(false);
  });

  it('becomes stale once too much time has passed since the last successful cycle', () => {
    recordCycleStart();
    recordCycleSuccess();
    expect(getBatchAuctionStatus().stale).toBe(false);

    jest.setSystemTime(new Date(Date.now() + STALE_THRESHOLD_MS + 1_000));
    expect(getBatchAuctionStatus().stale).toBe(true);
  });

  it('keeps last_cycle_completed_at from the last SUCCESS, not the last attempt, after a failure', () => {
    recordCycleStart();
    recordCycleSuccess();
    const successTime = getBatchAuctionStatus().last_cycle_completed_at;

    recordCycleStart();
    recordCycleFailure(new Error('soroban rpc timeout'));

    const status = getBatchAuctionStatus();
    expect(status.last_cycle_completed_at).toBe(successTime);
    expect(status.last_cycle_error).toBe('soroban rpc timeout');
  });
});
