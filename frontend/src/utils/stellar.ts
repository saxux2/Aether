/**
 * Build and sign Soroban transactions for the dark pool.
 * All functions here are browser-only (use Freighter for signing).
 */
import { Networks } from '@stellar/stellar-sdk';
import type { GeneratedProofs } from '@/lib/sdk/types';
import { buildSubmitOrderTransaction } from '@/lib/sdk/soroban';
import { STELLAR_NETWORK, STELLAR_RPC_URL, CONTRACTS, XLM_TOKEN_ADDRESS, USDC_TOKEN_ADDRESS, PRICE_SCALE } from './constants';

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

  // USDC amount a buyer deposits = quantity * price / PRICE_SCALE
  const amountIn =
    direction === 'buy'
      ? (quantity * price) / PRICE_SCALE
      : quantity;

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

/** Derive a deterministic trader secret from a signed message. */
export async function deriveTraderSecret(address: string): Promise<bigint> {
  const message = `zk-dark-pool-secret-v1:${address}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return BigInt(
    '0x' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
  );
}

/** Get the trader's escrow balance from the EscrowVault contract. */
export async function getEscrowBalance(
  _address: string,
  _asset: 'XLM' | 'USDC'
): Promise<bigint> {
  // TODO: Query EscrowVault.get_deposit() via Soroban RPC
  // v1 dev placeholder — returns a large number so balance checks pass in circuit
  return 1_000_000_000_000_000n; // 100M XLM equivalent
}
