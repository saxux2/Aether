import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { networkPassphraseFor } from '@/utils/network';

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
  'https://soroban-testnet.stellar.org';

const NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';

export const networkPassphrase: string = networkPassphraseFor(NETWORK);

export const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

export { StellarSdk };
