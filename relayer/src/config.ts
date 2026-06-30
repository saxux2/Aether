import dotenv from 'dotenv';
import path from 'path';
// Load relayer/.env explicitly — dotenv.config() without a path reads CWD/.env which
// resolves to the repo root when the relayer is started from there, missing CIRCUITS_DIR.
dotenv.config({ path: path.join(__dirname, '../.env') });

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

  CIRCUITS_DIR:
    process.env.CIRCUITS_DIR ??
    path.join(__dirname, '../../circuits/build'),
};
