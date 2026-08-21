import dotenv from 'dotenv';
import path from 'path';
// Load relayer/.env explicitly — dotenv.config() without a path reads CWD/.env which
// resolves to the repo root when the relayer is started from there, missing CIRCUITS_DIR.
dotenv.config({ path: path.join(__dirname, '../.env') });

/** Stellar's public-network id, spelled out so config.ts pulls in no SDK. */
const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const config = {
  PORT: parseInt(process.env.PORT ?? '3001', 10),
  NODE_ENV: process.env.NODE_ENV ?? 'development',

  MONGODB_URI: process.env.MONGODB_URI ?? 'mongodb://localhost:27017',
  MONGODB_DB_NAME: process.env.MONGODB_DB_NAME ?? 'darkpool',

  STELLAR_NETWORK: process.env.STELLAR_NETWORK ?? 'testnet',
  STELLAR_RPC_URL: process.env.STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  STELLAR_NETWORK_PASSPHRASE:
    process.env.STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',

  ZK_VERIFIER_ADDRESS: process.env.ZK_VERIFIER_ADDRESS ?? '',
  ESCROW_VAULT_ADDRESS: process.env.ESCROW_VAULT_ADDRESS ?? '',
  ORDER_BOOK_ADDRESS: process.env.ORDER_BOOK_ADDRESS ?? '',
  MATCHING_ENGINE_ADDRESS: process.env.MATCHING_ENGINE_ADDRESS ?? '',
  SETTLEMENT_ADDRESS: process.env.SETTLEMENT_ADDRESS ?? '',

  RELAYER_SECRET_KEY: process.env.RELAYER_SECRET_KEY ?? '',

  BATCH_INTERVAL_SECONDS: parseInt(process.env.BATCH_INTERVAL_SECONDS ?? '60', 10),
  ORDER_EXPIRY_SECONDS: parseInt(process.env.ORDER_EXPIRY_SECONDS ?? '3600', 10),
  MAX_ORDER_SIZE_XLM: parseInt(process.env.MAX_ORDER_SIZE_XLM ?? '10000000', 10),
  MIN_ORDER_SIZE_XLM: parseInt(process.env.MIN_ORDER_SIZE_XLM ?? '100', 10),

  ALLOWED_ORIGINS: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000').split(','),

  // Number of reverse proxies in front of this process, as Express's
  // `trust proxy` hop count. The relayer runs on Render, which terminates TLS
  // at its own edge and forwards over X-Forwarded-For — exactly one hop. Left
  // at 0, Express reports every request as coming from that edge address and
  // the per-IP rate limiter degrades into one global bucket (see index.ts).
  // Not defaulted to 1: when nothing is actually in front of the process, any
  // caller can set X-Forwarded-For themselves and mint a fresh bucket per
  // request, which is strictly worse than one shared bucket.
  TRUST_PROXY_HOPS: Math.max(0, parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10) || 0),

  CIRCUITS_DIR:
    process.env.CIRCUITS_DIR ??
    path.join(__dirname, '../../circuits/build'),
};

/**
 * Fail at startup on a deployment that can't actually do its job.
 *
 * These are all soft-defaulted above so `npm run dev` works with an empty
 * .env, but every one of them turns into a confusing runtime failure much
 * later if it's still empty in a real deployment:
 *
 *   - RELAYER_SECRET_KEY unset makes SorobanService fall back to
 *     Keypair.random(), so submitMatch() reaches the network as an account
 *     that has never been funded and fails with "account not found" — once
 *     per match, forever, with nothing in the error naming the real cause.
 *   - ORDER_BOOK_ADDRESS unset makes the submit route's
 *     `invocation.contractId !== config.ORDER_BOOK_ADDRESS` binding check
 *     reject every order. That fails closed, which is right, but it reads
 *     to a trader as the relayer refusing valid orders.
 *   - MATCHING_ENGINE_ADDRESS unset breaks settlement the same way.
 *   - STELLAR_NETWORK_PASSPHRASE left at its testnet default on a mainnet
 *     deployment makes SorobanService sign every settlement against the wrong
 *     network id, so the transaction is rejected for a bad signature — which
 *     mentions neither the network nor the passphrase.
 *
 * Gated on mainnet or NODE_ENV=production so local development is unaffected.
 */
export function assertDeploymentConfig(): void {
  const isLive = config.NODE_ENV === 'production' || config.STELLAR_NETWORK === 'mainnet';
  if (!isLive) return;

  // A mainnet RPC endpoint and a testnet passphrase is never a deployment
  // anyone meant to make; it just fails, transaction by transaction.
  if (
    config.STELLAR_NETWORK === 'mainnet' &&
    config.STELLAR_NETWORK_PASSPHRASE !== PUBLIC_NETWORK_PASSPHRASE
  ) {
    throw new Error(
      `Refusing to start on mainnet with STELLAR_NETWORK_PASSPHRASE=` +
        `"${config.STELLAR_NETWORK_PASSPHRASE}" — expected "${PUBLIC_NETWORK_PASSPHRASE}"`
    );
  }

  const missing = (
    [
      ['RELAYER_SECRET_KEY', config.RELAYER_SECRET_KEY],
      ['ORDER_BOOK_ADDRESS', config.ORDER_BOOK_ADDRESS],
      ['MATCHING_ENGINE_ADDRESS', config.MATCHING_ENGINE_ADDRESS],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start on ${config.STELLAR_NETWORK} (NODE_ENV=${config.NODE_ENV}) ` +
        `without: ${missing.join(', ')}`
    );
  }
}
