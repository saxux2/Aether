import { BatchAuctionService } from './batchAuction';

/**
 * A cycle is not bounded by BATCH_INTERVAL_SECONDS — a batch with several
 * matches spends a Groth16 prove plus up to 30s of confirmation polling per
 * match. setInterval fires regardless, so without a guard two cycles run
 * concurrently over the same 'active' orders and match them twice.
 */
describe('BatchAuctionService interval guard', () => {
  it('skips a firing while the previous cycle is still running', async () => {
    const service = new BatchAuctionService();

    let release!: () => void;
    const inFlight = new Promise<void>(resolve => {
      release = resolve;
    });
    const runCycle = jest
      .spyOn(service, 'runBatchCycle')
      .mockImplementation(() => inFlight);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tick = () => (service as any).tick();

    tick();
    tick();
    tick();
    expect(runCycle).toHaveBeenCalledTimes(1);

    release();
    await inFlight;
    await new Promise(resolve => setImmediate(resolve)); // let .finally() settle

    tick();
    expect(runCycle).toHaveBeenCalledTimes(2);
  });

  it('clears the guard when a cycle rejects, so the loop keeps running', async () => {
    const service = new BatchAuctionService();
    const runCycle = jest
      .spyOn(service, 'runBatchCycle')
      .mockRejectedValue(new Error('mongo unreachable'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tick = () => (service as any).tick();

    tick();
    await new Promise(resolve => setImmediate(resolve));
    tick();
    await new Promise(resolve => setImmediate(resolve));

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
