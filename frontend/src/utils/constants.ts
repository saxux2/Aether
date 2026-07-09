export const RELAYER_URL =
  process.env.NEXT_PUBLIC_RELAYER_URL ?? 'http://localhost:3001';

export const STELLAR_NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';

export const STELLAR_RPC_URL =
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
  'https://soroban-testnet.stellar.org';

export const STELLAR_HORIZON_URL =
  process.env.NEXT_PUBLIC_STELLAR_HORIZON_URL ??
  'https://horizon-testnet.stellar.org';

export const CONTRACTS = {
  ZK_VERIFIER:     process.env.NEXT_PUBLIC_ZK_VERIFIER_ADDRESS ?? '',
  ORDER_BOOK:      process.env.NEXT_PUBLIC_ORDER_BOOK_ADDRESS ?? '',
  ESCROW_VAULT:    process.env.NEXT_PUBLIC_ESCROW_VAULT_ADDRESS ?? '',
  MATCHING_ENGINE: process.env.NEXT_PUBLIC_MATCHING_ENGINE_ADDRESS ?? '',
  SETTLEMENT:      process.env.NEXT_PUBLIC_SETTLEMENT_ADDRESS ?? '',
};

export const XLM_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_XLM_TOKEN_ADDRESS ?? 'native';

export const USDC_TOKEN_ADDRESS =
  process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS ?? '';

// Classic Stellar issuer account behind the USDC SAC above (Circle testnet USDC).
// Horizon balances are keyed by asset_code + asset_issuer — a wallet can hold
// unrelated trustlines that share the "USDC" code from a different issuer, so
// any balance lookup must filter on both, not asset_code alone.
export const USDC_ISSUER =
  process.env.NEXT_PUBLIC_USDC_ISSUER ?? 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

// Stellar.expert uses "public" (not "mainnet") as the network segment in its URLs.
const EXPLORER_NETWORK = STELLAR_NETWORK === 'mainnet' ? 'public' : 'testnet';

/** Build a stellar.expert link for a tx hash, scoped to the configured network. */
export function explorerTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/${EXPLORER_NETWORK}/tx/${hash}`;
}

// Internal scaling
export const XLM_SCALE = 10_000_000n;    // 1 XLM = 10^7 stroops
export const PRICE_SCALE = 1_000_000n;   // 1 USDC = 10^6 micro-USDC
export const USDC_SCALE = 10_000_000n;   // 1 USDC = 10^7 units on Stellar

// Order constraints
export const MIN_ORDER_XLM = 100;
export const MAX_ORDER_XLM = 10_000_000;
export const PRICE_MIN_USD = 0.001;
export const PRICE_MAX_USD = 10.0;
export const DEFAULT_EXPIRY_SECONDS = 3600;

/**
 * The real amount escrowed for an order: USDC base units for a buy order
 * (quantity XLM * price / PRICE_SCALE), XLM stroops directly for a sell.
 *
 * Single source of truth for this formula — it must produce byte-identical
 * results everywhere it's used (the signed on-chain transaction amount in
 * buildOrderTx, the balance proof's minimum_balance witness in useProver,
 * and the relayer payload's amount_in in useOrders) since order_book now
 * checks the balance proof's minimum_balance against the transaction's real
 * amount_in — any drift between call sites would make every honest order
 * fail that check.
 */
export function computeEscrowAmount(
  direction: 'buy' | 'sell',
  quantity: bigint,
  price: bigint
): bigint {
  return direction === 'buy' ? (quantity * price) / PRICE_SCALE : quantity;
}
