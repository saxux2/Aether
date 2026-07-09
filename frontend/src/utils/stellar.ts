/**
 * Build and sign Soroban transactions for the dark pool.
 * All functions here are browser-only (use Freighter for signing).
 */
import { Networks } from '@stellar/stellar-sdk';
import type { GeneratedProofs } from '@/lib/sdk/types';
import { buildSubmitOrderTransaction, buildCancelOrderTransaction } from '@/lib/sdk/soroban';
import { fetchXlmBalance } from '@/lib/stellarHorizon';
import {
  STELLAR_NETWORK,
  STELLAR_RPC_URL,
  STELLAR_HORIZON_URL,
  CONTRACTS,
  XLM_TOKEN_ADDRESS,
  USDC_TOKEN_ADDRESS,
  USDC_ISSUER,
  computeEscrowAmount,
} from './constants';

const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

/** Sign a transaction XDR using the Freighter browser extension. */
export async function signWithFreighter(txXdr: string): Promise<string> {
  // Dynamic import — Freighter API is browser-only
  const { signTransaction } = await import('@stellar/freighter-api');
  const result = await signTransaction(txXdr, {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  // freighter-api v4+ returns { signedTxXdr }
  if (typeof result === 'object' && 'signedTxXdr' in result) {
    return (result as { signedTxXdr: string }).signedTxXdr;
  }
  return result as unknown as string;
}

export interface BuildOrderTxParams {
  trader: string;
  direction: 'buy' | 'sell';
  quantity: bigint;   // XLM in stroops
  price: bigint;      // micro-USDC per XLM
  proofs: GeneratedProofs;
  expiresAt: number;  // unix timestamp
}

/**
 * Build the Soroban transaction that submits a sealed order.
 * Returns the prepared (but unsigned) transaction XDR.
 */
export async function buildOrderTx(params: BuildOrderTxParams): Promise<string> {
  const { trader, direction, quantity, price, proofs, expiresAt } = params;

  const assetIn  = direction === 'buy' ? USDC_TOKEN_ADDRESS || 'USDC' : XLM_TOKEN_ADDRESS;
  const assetOut = direction === 'buy' ? XLM_TOKEN_ADDRESS : USDC_TOKEN_ADDRESS || 'USDC';

  const amountIn = computeEscrowAmount(direction, quantity, price);

  return buildSubmitOrderTransaction({
    trader,
    commitment: proofs.commitment,
    nullifier: proofs.nullifier,
    assetIn,
    assetOut,
    amountIn,
    proofs,
    expiresAt,
    orderBookAddress: CONTRACTS.ORDER_BOOK,
    rpcUrl: STELLAR_RPC_URL,
    network: STELLAR_NETWORK,
  });
}

/** The exact message Freighter is asked to sign — shared with the relayer's verifier. */
export const TRADER_SECRET_MESSAGE_PREFIX = 'zk-dark-pool-secret-v1:';

export interface TraderSecretResult {
  /** Private `secret` witness for balance_proof.circom. */
  secret: bigint;
  /** Base64 raw Ed25519 signature — reusable as a bearer credential (see below). */
  proof: string;
}

/**
 * Derive a deterministic trader secret from a real Freighter signature.
 *
 * This value becomes the private `secret` witness in balance_proof.circom,
 * which the circuit hashes into the order's nullifier — it must be knowable
 * only to the trader. An earlier version hashed the trader's *public*
 * Stellar address instead of asking Freighter to sign anything: since a
 * Stellar address is, by definition, public, anyone who had ever seen a
 * trader's address could compute the identical "secret" with zero wallet
 * access, which defeated the whole point.
 *
 * Ed25519 signatures (what Freighter/Stellar use) are deterministic — the
 * same key signing the same message always produces the same signature — so
 * hashing the signature still gives a stable, reproducible secret across
 * sessions, but now one that provably requires the wallet's private key to
 * produce. Freighter will prompt the user to approve this signature.
 *
 * The raw signature is also returned as `proof`: since it's deterministic,
 * it doubles as a reusable bearer credential the relayer can verify to prove
 * the caller controls this address's key (used for GET /api/orders, which
 * would otherwise let anyone who knows a trader's public address read their
 * full order history) — without a second Freighter prompt.
 */
export async function deriveTraderSecret(address: string): Promise<TraderSecretResult> {
  const { signMessage } = await import('@stellar/freighter-api');
  const message = `${TRADER_SECRET_MESSAGE_PREFIX}${address}`;
  const result = await signMessage(message, {
    networkPassphrase: NETWORK_PASSPHRASE,
    address,
  });

  if ('error' in result && result.error) {
    throw new Error(`Freighter declined to sign the secret-derivation message: ${result.error}`);
  }
  if (!result.signedMessage) {
    throw new Error('Freighter did not return a signed message');
  }

  // signedMessage is a Buffer on Freighter v3 or a base64 string on v4+.
  let sigBytes: Uint8Array;
  if (typeof result.signedMessage === 'string') {
    const binary = atob(result.signedMessage);
    sigBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } else {
    sigBytes = new Uint8Array(result.signedMessage);
  }

  // Cast: TS's lib.dom BufferSource type doesn't currently accept
  // Uint8Array<ArrayBufferLike> even though it's a valid BufferView at
  // runtime — a type-level mismatch between @types/node and lib.dom, not a
  // real type error.
  const hashBuffer = await crypto.subtle.digest('SHA-256', sigBytes as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const secret = BigInt(
    '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  );
  const proof = btoa(String.fromCharCode(...sigBytes));
  return { secret, proof };
}

/**
 * Build the Soroban transaction that cancels a not-yet-matched order and
 * reclaims the trader's escrowed funds.
 *
 * Calls OrderBook.cancel() (which internally calls EscrowVault.cancel()),
 * not EscrowVault.cancel() directly — routing cancellation through OrderBook
 * keeps its own order-status bookkeeping and active-orders index in sync
 * with the vault's. Calling EscrowVault directly would leave the matching
 * order_book record permanently stuck as "Active" after a cancel.
 * Returns the prepared (but unsigned) transaction XDR.
 */
export async function buildCancelTx(trader: string, commitment: string): Promise<string> {
  return buildCancelOrderTransaction({
    trader,
    commitment,
    orderBookAddress: CONTRACTS.ORDER_BOOK,
    rpcUrl: STELLAR_RPC_URL,
    network: STELLAR_NETWORK,
  });
}

/**
 * Check the trader's real Stellar wallet balance for the asset they're about
 * to escrow, in the asset's base unit (stroops for XLM, USDC's 7-decimal
 * base unit for USDC).
 *
 * This is a pre-escrow sufficiency check, not a EscrowVault query — the
 * deposit hasn't happened yet at proof-generation time, and EscrowVault has
 * no per-trader aggregate balance anyway (deposits are keyed per-order by
 * nullifier, not per-trader). What actually enforces sufficiency is
 * EscrowVault.deposit()'s real token transfer, which reverts if the trader
 * doesn't have the funds — this value only needs to be an honest read of
 * their spendable balance so the proof isn't trivially self-contradicting.
 */
export async function getEscrowBalance(
  address: string,
  asset: 'XLM' | 'USDC'
): Promise<bigint> {
  if (asset === 'XLM') {
    const { balance, funded } = await fetchXlmBalance(address);
    if (!funded) return 0n;
    return decimalToBaseUnits(balance);
  }

  const res = await fetch(`${STELLAR_HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return 0n;
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  const data = await res.json();
  const entries: Array<{ asset_code?: string; asset_issuer?: string; balance?: string }> =
    Array.isArray(data?.balances) ? data.balances : [];
  const usdcLine = entries.find(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
  );
  if (!usdcLine?.balance) return 0n;
  return decimalToBaseUnits(usdcLine.balance);
}

/** Horizon always reports balances with exactly 7 decimal places. */
export function decimalToBaseUnits(decimal: string): bigint {
  const negative = decimal.startsWith('-');
  const unsigned = negative ? decimal.slice(1) : decimal;
  const [whole, frac = ''] = unsigned.split('.');
  const fracPadded = frac.padEnd(7, '0').slice(0, 7);
  const units = BigInt(whole || '0') * 10_000_000n + BigInt(fracPadded || '0');
  return negative ? -units : units;
}
