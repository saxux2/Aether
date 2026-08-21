export interface LivePriceData {
  price: number;
  timestamp: number;
}

/**
 * How long to wait on one price source before giving up on it.
 *
 * Neither fetch was bounded. `fetch` has no default timeout, so a source that
 * accepts the connection and then stalls — a hung upstream, a captive portal,
 * a network that black-holes packets rather than refusing them — leaves the
 * await pending indefinitely. That did not merely delay the price: because
 * the Coinbase call is awaited before the CoinGecko fallback is even
 * attempted, a stalled primary meant the fallback never ran at all. The
 * ticker sat on its last value with no error and no recovery, and react-query
 * would not start a new attempt while the old one was still in flight.
 */
export const PRICE_SOURCE_TIMEOUT_MS = 4_000;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Spot XLM/USD from Coinbase, falling back to CoinGecko, then to null.
 * Each source is bounded independently so a stalled one cannot consume the
 * next one's chance to answer.
 */
export async function fetchXlmUsdPrice(
  timeoutMs: number = PRICE_SOURCE_TIMEOUT_MS
): Promise<LivePriceData | null> {
  try {
    const res = await fetchWithTimeout(
      'https://api.coinbase.com/v2/prices/XLM-USD/spot',
      timeoutMs
    );
    if (res.ok) {
      const data = await res.json();
      const amount = data?.data?.amount;
      if (typeof amount === 'string' && amount.trim() !== '' && !isNaN(parseFloat(amount))) {
        return { price: parseFloat(amount), timestamp: Date.now() };
      }
    }
  } catch {
    // fall through to the secondary source (includes the abort above)
  }

  try {
    const res = await fetchWithTimeout(
      'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
      timeoutMs
    );
    if (res.ok) {
      const data = await res.json();
      const price = data?.stellar?.usd;
      if (typeof price === 'number') {
        return { price, timestamp: Date.now() };
      }
    }
  } catch {
    // both sources unavailable
  }

  return null;
}
