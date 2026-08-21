import { fetchXlmUsdPrice, PRICE_SOURCE_TIMEOUT_MS } from '../lib/priceFeed';

const COINBASE = 'https://api.coinbase.com/v2/prices/XLM-USD/spot';
const COINGECKO = 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd';

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

/** A source that accepts the connection and then never answers. */
function stalled(signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

describe('fetchXlmUsdPrice', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('uses the primary source when it answers', async () => {
    global.fetch = jest.fn(async () =>
      jsonResponse({ data: { amount: '0.1234' } })
    ) as unknown as typeof fetch;

    const result = await fetchXlmUsdPrice(50);
    expect(result?.price).toBeCloseTo(0.1234);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the secondary source when the primary STALLS', async () => {
    // The regression: without a timeout this await never settles, so the
    // fallback below was never reached and the ticker froze silently.
    global.fetch = jest.fn(async (url: unknown, init?: { signal?: AbortSignal }) => {
      if (String(url) === COINBASE) return stalled(init?.signal);
      return jsonResponse({ stellar: { usd: 0.4321 } });
    }) as unknown as typeof fetch;

    const result = await fetchXlmUsdPrice(20);
    expect(result?.price).toBeCloseTo(0.4321);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns null when both sources stall, rather than hanging', async () => {
    global.fetch = jest.fn(async (_url: unknown, init?: { signal?: AbortSignal }) =>
      stalled(init?.signal)
    ) as unknown as typeof fetch;

    await expect(fetchXlmUsdPrice(20)).resolves.toBeNull();
  });

  it('falls back when the primary answers with an unusable body', async () => {
    global.fetch = jest.fn(async (url: unknown) => {
      if (String(url) === COINBASE) return jsonResponse({ data: { amount: 'not-a-number' } });
      if (String(url) === COINGECKO) return jsonResponse({ stellar: { usd: 0.55 } });
      throw new Error(`unexpected url ${String(url)}`);
    }) as unknown as typeof fetch;

    expect((await fetchXlmUsdPrice(50))?.price).toBeCloseTo(0.55);
  });

  it('bounds each source at 4s by default', () => {
    expect(PRICE_SOURCE_TIMEOUT_MS).toBe(4_000);
  });
});
