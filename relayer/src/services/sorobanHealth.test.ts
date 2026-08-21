import { SorobanService } from './soroban';

describe('checkStellarConnection', () => {
  const service = new SorobanService();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpc = () => (service as any).server;

  it('reports connected when the RPC answers', async () => {
    jest.spyOn(rpc(), 'getLatestLedger').mockResolvedValue({ sequence: 1 });
    await expect(service.checkStellarConnection(50)).resolves.toBe(true);
  });

  it('reports unreachable when the RPC rejects', async () => {
    jest.spyOn(rpc(), 'getLatestLedger').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(service.checkStellarConnection(50)).resolves.toBe(false);
  });

  it('gives up on a black-holed RPC instead of hanging the health route', async () => {
    jest.spyOn(rpc(), 'getLatestLedger').mockReturnValue(new Promise(() => {}));
    await expect(service.checkStellarConnection(20)).resolves.toBe(false);
  });

  it('does not leave an unhandled rejection when the timeout wins the race', async () => {
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    jest
      .spyOn(rpc(), 'getLatestLedger')
      .mockReturnValue(
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error('too late')), 30))
      );

    await expect(service.checkStellarConnection(10)).resolves.toBe(false);
    await new Promise(resolve => setTimeout(resolve, 80));

    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });
});
