import { Networks } from '@stellar/stellar-sdk';

/**
 * Canonical Stellar network resolution.
 *
 * NEXT_PUBLIC_STELLAR_NETWORK was compared against the literal 'mainnet' in
 * five independent places — the wallet passphrase, the SDK's passphrase and
 * Horizon maps, the standalone stellar-sdk client, and the explorer URL — each
 * with its own fallback behaviour and no shared definition of what the value
 * may say. Stellar's live network is conventionally called "public" (this
 * codebase spells it that way itself for stellar.expert URLs), so `public` is
 * the obvious thing for an operator to configure. It matched none of them.
 *
 * The result was not a clean failure. RPC and Horizon URLs are set by separate
 * env vars, so a deployment configured as `public` pointed at mainnet
 * endpoints while signing with the TESTNET passphrase and loading accounts
 * from testnet Horizon — every transaction rejected for a bad signature, with
 * nothing naming the network. In the SDK builder the miss was worse still:
 * NETWORKS[network] returns undefined for an unrecognized name, and that
 * undefined went straight into TransactionBuilder as the passphrase.
 *
 * One resolver, accepting the spellings people actually use, so the answer is
 * the same everywhere.
 */
const MAINNET_ALIASES = new Set(['mainnet', 'main', 'public', 'pubnet', 'publicnet']);

export type StellarNetwork = 'mainnet' | 'testnet';

/** Normalize any configured network name. Unrecognized values mean testnet. */
export function resolveNetwork(value: string | undefined): StellarNetwork {
  return MAINNET_ALIASES.has((value ?? '').trim().toLowerCase()) ? 'mainnet' : 'testnet';
}

export function isMainnet(value: string | undefined): boolean {
  return resolveNetwork(value) === 'mainnet';
}

/** The network passphrase transactions must be signed against. */
export function networkPassphraseFor(value: string | undefined): string {
  return isMainnet(value) ? Networks.PUBLIC : Networks.TESTNET;
}
