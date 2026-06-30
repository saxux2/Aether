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
