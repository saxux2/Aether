import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';

const RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  process.env.NEXT_PUBLIC_STELLAR_RPC_URL ??
  'https://soroban-testnet.stellar.org';

const NETWORK =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet';

export const networkPassphrase: string =
  NETWORK === 'mainnet'
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

export { StellarSdk };
