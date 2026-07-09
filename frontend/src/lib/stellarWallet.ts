'use client';

/**
 * Freighter wallet primitives — detect / connect / read address / sign.
 * Network (testnet vs. mainnet) is driven entirely by NEXT_PUBLIC_STELLAR_NETWORK —
 * see utils/constants.ts. Never hardcode a passphrase or Horizon URL here.
 *
 * freighter-api is imported dynamically inside each function (not at module
 * scope) because it touches `window` on load, which breaks Next.js SSR if
 * imported statically in a 'use client' file. See utils/stellar.ts for the
 * same convention used by the rest of this app.
 */
import { Networks } from '@stellar/stellar-sdk';
import { STELLAR_HORIZON_URL, STELLAR_NETWORK } from '@/utils/constants';

export const STELLAR_NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
export const HORIZON_URL = STELLAR_HORIZON_URL;

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

/**
 * Confirm Freighter's currently-selected network matches this app's
 * configured network before doing anything that depends on it. Freighter
 * itself rejects a signTransaction call whose networkPassphrase doesn't
 * match its active network, so this isn't a bypassable security check — but
 * without it, a mismatch surfaces as an opaque Freighter-side error deep
 * inside a sign call instead of a clear message at connect time.
 */
export async function assertFreighterNetworkMatches(): Promise<void> {
  const { getNetwork } = await import('@stellar/freighter-api');
  const result = await getNetwork();
  if (result.error) throw new Error(result.error);
  if (result.networkPassphrase !== STELLAR_NETWORK_PASSPHRASE) {
    throw new Error(
      `Freighter is set to "${result.network}", but this app is configured for ` +
      `${STELLAR_NETWORK === 'mainnet' ? 'Stellar mainnet' : 'Stellar testnet'}. ` +
      `Switch networks in Freighter and reconnect.`
    );
  }
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
  let address: string;
  if (!allowed.isAllowed) {
    // requestAccess() triggers the permission popup and returns the address directly.
    const access = await requestAccess();
    if (access.error) throw new Error(access.error);
    if (!access.address) throw new Error('No public key returned — unlock Freighter and try again');
    address = access.address;
  } else {
    // Already-authorized session — getAddress() alone is enough.
    const result = await getAddress();
    if (result.error) throw new Error(result.error);
    if (!result.address) throw new Error('No public key returned — unlock Freighter and try again');
    address = result.address;
  }

  await assertFreighterNetworkMatches();
  return address;
}

/** Signs a transaction XDR with Freighter, scoped to the configured Stellar network. */
export async function signTx(xdr: string): Promise<string> {
  const { signTransaction } = await import('@stellar/freighter-api');
  const result = await signTransaction(xdr, { networkPassphrase: STELLAR_NETWORK_PASSPHRASE });
  // freighter-api v4+ returns { signedTxXdr }; older versions return the XDR string directly.
  if (typeof result === 'object' && result !== null && 'signedTxXdr' in result) {
    return (result as { signedTxXdr: string }).signedTxXdr;
  }
  return result as unknown as string;
}
