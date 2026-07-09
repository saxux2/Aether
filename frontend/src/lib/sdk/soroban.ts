/**
 * Soroban transaction builder — constructs the OrderBook.submit_order() call
 * that the trader signs with Freighter before sending to the relayer.
 */
import {
  Asset,
  Contract,
  Horizon,
  Networks,
  rpc,
  TransactionBuilder,
  xdr,
  Address,
} from '@stellar/stellar-sdk';
import type { GeneratedProofs } from './types';

const NETWORKS: Record<string, string> = {
  testnet: Networks.TESTNET,
  mainnet: Networks.PUBLIC,
};

// Horizon is the authoritative source for account sequence numbers —
// the Soroban RPC can lag 1-2 ledgers and return a stale sequence, causing txBadSeq.
const HORIZON_URLS: Record<string, string> = {
  testnet: 'https://horizon-testnet.stellar.org',
  mainnet: 'https://horizon.stellar.org',
};

export interface SubmitOrderTxParams {
  trader: string;
  commitment: string;
  nullifier: string;
  assetIn: string;    // contract address or 'native'
  assetOut: string;
  amountIn: bigint;
  proofs: GeneratedProofs;
  expiresAt: number;  // Unix timestamp
  orderBookAddress: string;
  rpcUrl: string;
  network?: string;
}

/**
 * Encode a BN254 G1 point (from snarkjs decimal strings) to 64 bytes.
 * Layout: x (32 bytes big-endian) || y (32 bytes big-endian)
 */
function g1ToBytes(point: string[]): Buffer {
  const x = hexPad32(BigInt(point[0]));
  const y = hexPad32(BigInt(point[1]));
  return Buffer.concat([x, y]);
}

/**
 * Encode a BN254 G2 point (from snarkjs) to 128 bytes in Stellar's wire format.
 *
 * snarkjs gives each Fp2 coordinate as [c0, c1] (real, imaginary). Stellar's
 * BN254 host functions expect the Ethereum-compatible imaginary-first layout:
 *   be(x.c1) || be(x.c0) || be(y.c1) || be(y.c0)   (32 bytes each)
 * Getting this order wrong makes every on-chain pairing_check fail.
 */
function g2ToBytes(point: string[][]): Buffer {
  const xc0 = hexPad32(BigInt(point[0][0]));
  const xc1 = hexPad32(BigInt(point[0][1]));
  const yc0 = hexPad32(BigInt(point[1][0]));
  const yc1 = hexPad32(BigInt(point[1][1]));
  return Buffer.concat([xc1, xc0, yc1, yc0]);
}

function hexPad32(n: bigint): Buffer {
  return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
}

/** Convert a snarkjs Groth16 proof to its Soroban XDR struct representation. */
function proofToScVal(proof: GeneratedProofs['orderProof']): xdr.ScVal {
  const piABytes = g1ToBytes(proof.pi_a);
  const piBBytes = g2ToBytes(proof.pi_b);
  const piCBytes = g1ToBytes(proof.pi_c);

  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('pi_a'),
      val: xdr.ScVal.scvBytes(piABytes),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('pi_b'),
      val: xdr.ScVal.scvBytes(piBBytes),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('pi_c'),
      val: xdr.ScVal.scvBytes(piCBytes),
    }),
  ]);
}

/** Convert an array of public signal strings to a Vec<BytesN<32>>. */
function signalsToScVal(signals: string[]): xdr.ScVal {
  const entries = signals.map(s => {
    const bytes = Buffer.from(BigInt(s).toString(16).padStart(64, '0'), 'hex');
    return xdr.ScVal.scvBytes(bytes);
  });
  return xdr.ScVal.scvVec(entries);
}

/**
 * Build the unsigned Soroban transaction for OrderBook.submit_order().
 * Returns the transaction XDR string — pass this to Freighter for signing.
 */
export async function buildSubmitOrderTransaction(
  params: SubmitOrderTxParams
): Promise<string> {
  const { rpcUrl, network = 'testnet', trader, orderBookAddress } = params;
  const passphrase = NETWORKS[network];

  const server = new rpc.Server(rpcUrl);
  const horizon = new Horizon.Server(HORIZON_URLS[network] ?? HORIZON_URLS.testnet);
  // Fetch account from Horizon — always current-ledger accurate, unlike the Soroban RPC
  // which can cache account state 1-2 ledgers behind and return a stale sequence number.
  const account = await horizon.loadAccount(trader);
  const contract = new Contract(orderBookAddress);

  // The native XLM Stellar Asset Contract ID is deterministic per network (derived
  // from the network passphrase) — compute it instead of hardcoding a single
  // network's address, so 'native' resolves correctly on testnet *and* mainnet.
  const nativeAssetContractId = Asset.native().contractId(passphrase);

  const args = [
    new Address(trader).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(BigInt(params.commitment).toString(16).padStart(64, '0'), 'hex')),
    xdr.ScVal.scvBytes(Buffer.from(BigInt(params.nullifier).toString(16).padStart(64, '0'), 'hex')),
    new Address(params.assetIn === 'native' ? nativeAssetContractId : params.assetIn).toScVal(),
    new Address(params.assetOut === 'native' ? nativeAssetContractId : params.assetOut).toScVal(),
    xdr.ScVal.scvI128(new xdr.Int128Parts({
      hi: xdr.Int64.fromString('0'),
      lo: xdr.Uint64.fromString(params.amountIn.toString()),
    })),
    proofToScVal(params.proofs.orderProof),
    signalsToScVal(params.proofs.orderPublicSignals),
    proofToScVal(params.proofs.balanceProof),
    signalsToScVal(params.proofs.balancePublicSignals),
    proofToScVal(params.proofs.rangeProof),
    signalsToScVal(params.proofs.rangePublicSignals),
    xdr.ScVal.scvU64(xdr.Uint64.fromString(params.expiresAt.toString())),
  ];

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call('submit_order', ...args))
    .setTimeout(300)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}

export interface CancelOrderTxParams {
  trader: string;
  commitment: string;
  orderBookAddress: string;
  rpcUrl: string;
  network?: string;
}

/**
 * Build the unsigned Soroban transaction for OrderBook.cancel().
 * Reclaims the trader's escrowed funds for an order that hasn't matched yet.
 * Goes through OrderBook (which internally calls EscrowVault.cancel()) rather
 * than calling EscrowVault directly, so OrderBook's own status/active-orders
 * bookkeeping stays in sync with the vault.
 * Returns the transaction XDR string — pass this to Freighter for signing.
 */
export async function buildCancelOrderTransaction(
  params: CancelOrderTxParams
): Promise<string> {
  const { rpcUrl, network = 'testnet', trader, commitment, orderBookAddress } = params;
  const passphrase = NETWORKS[network];

  const server = new rpc.Server(rpcUrl);
  const horizon = new Horizon.Server(HORIZON_URLS[network] ?? HORIZON_URLS.testnet);
  const account = await horizon.loadAccount(trader);
  const contract = new Contract(orderBookAddress);

  const args = [
    new Address(trader).toScVal(),
    xdr.ScVal.scvBytes(Buffer.from(BigInt(commitment).toString(16).padStart(64, '0'), 'hex')),
  ];

  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: passphrase,
  })
    .addOperation(contract.call('cancel', ...args))
    .setTimeout(300)
    .build();

  const prepared = await server.prepareTransaction(tx);
  return prepared.toXDR();
}
