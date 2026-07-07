'use client';

/**
 * Freighter wallet primitives — detect / connect / read address / sign.
 * All network activity here targets Stellar TESTNET.
 *
 * freighter-api is imported dynamically inside each function (not at module
 * scope) because it touches `window` on load, which breaks Next.js SSR if
 * imported statically in a 'use client' file. See utils/stellar.ts for the
 * same convention used by the rest of this app.
 */
import { Networks } from '@stellar/stellar-sdk';
import { STELLAR_HORIZON_URL } from '@/utils/constants';

export const STELLAR_TESTNET_PASSPHRASE = Networks.TESTNET;
export const HORIZON_TESTNET_URL = STELLAR_HORIZON_URL;

/** Whether the Freighter browser extension is installed and reachable. */
export async function detectFreighter(): Promise<boolean> {
  try {
    const { isConnected } = await import('@stellar/freighter-api');
    const result = await isConnected();
    return Boolean(result?.isConnected);
  } catch {
    return false;
  }
}

/** Address of an already-authorized session, or null if never granted. */
export async function getWalletAddress(): Promise<string | null> {
  const { isAllowed, getAddress } = await import('@stellar/freighter-api');
  const allowed = await isAllowed();
  if (allowed.error || !allowed.isAllowed) return null;

  const result = await getAddress();
  if (result.error) throw new Error(result.error);
  return result.address ?? null;
}

/** Prompts the Freighter permission popup (if needed) and returns the G-address. */
export async function connectWallet(): Promise<string> {
  const { isConnected, isAllowed, requestAccess, getAddress } = await import(
    '@stellar/freighter-api'
  );

  const connStatus = await isConnected();
  if (!connStatus?.isConnected) {
    throw new Error('Freighter is not installed');
  }

  const allowed = await isAllowed();
  if (!allowed.isAllowed) {
    // requestAccess() triggers the permission popup and returns the address directly.
    const access = await requestAccess();
    if (access.error) throw new Error(access.error);
    if (access.address) return access.address;
  }

  // Already-authorized session — getAddress() alone is enough.
  const result = await getAddress();
  if (result.error) throw new Error(result.error);
  if (!result.address) throw new Error('No public key returned — unlock Freighter and try again');
  return result.address;
}

/** Signs a transaction XDR with Freighter, scoped to Stellar testnet. */
export async function signTx(xdr: string): Promise<string> {
  const { signTransaction } = await import('@stellar/freighter-api');
  const result = await signTransaction(xdr, { networkPassphrase: STELLAR_TESTNET_PASSPHRASE });
  // freighter-api v4+ returns { signedTxXdr }; older versions return the XDR string directly.
  if (typeof result === 'object' && result !== null && 'signedTxXdr' in result) {
    return (result as { signedTxXdr: string }).signedTxXdr;
  }
  return result as unknown as string;
}
