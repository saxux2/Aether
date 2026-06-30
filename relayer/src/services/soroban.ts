import {
  Contract,
  Keypair,
  Networks,
  rpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../config';
import type { MatchResult } from '../types';
import { generateMatchProof } from './matchProver';

export class SorobanService {
  private server: rpc.Server;
  private keypair: Keypair;

  constructor() {
    this.server = new rpc.Server(config.STELLAR_RPC_URL);
    this.keypair = config.RELAYER_SECRET_KEY
      ? Keypair.fromSecret(config.RELAYER_SECRET_KEY)
      : Keypair.random();
  }

  get publicKey(): string {
    return this.keypair.publicKey();
  }

  /** Broadcast a pre-signed XDR transaction and return the tx hash. */
  async broadcastTransaction(signedXdr: string): Promise<string> {
    // Pass the XDR string directly; sendTransaction only calls .toXDR() internally,
    // so we skip fromXDR() which fails on Soroban footprint union types.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await this.server.sendTransaction({ toXDR: () => signedXdr } as any);
    if (result.status === 'ERROR') {
      throw new Error(`Transaction failed: ${JSON.stringify(result.errorResult)}`);
    }
    return result.hash;
  }

  /** Poll until a transaction is confirmed or fails. */
  async waitForConfirmation(txHash: string, maxAttempts = 30): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      // Use the raw _getTransaction to avoid XDR parse errors on Soroban footprint;
      // parseTransactionInfo calls TransactionEnvelope.fromXDR which fails for our txns.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = await (this.server as any)._getTransaction(txHash);
      const status: string = raw?.status ?? '';
      if (status === 'SUCCESS') return;
      if (status === 'FAILED') {
        throw new Error(`Transaction failed: ${txHash}`);
      }
      await sleep(1000);
    }
    throw new Error(`Confirmation timeout: ${txHash}`);
  }

  /** Invoke a Soroban contract method as the relayer keypair. */
  async invokeContract(
    contractAddress: string,
    method: string,
    args: xdr.ScVal[]
  ): Promise<string> {
    const account = await this.server.getAccount(this.keypair.publicKey());
    const contract = new Contract(contractAddress);
    const networkPassphrase =
      config.STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    const tx = new TransactionBuilder(account, {
      fee: '1000000',
      networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(this.keypair);

    const result = await this.server.sendTransaction(prepared);
    if (result.status === 'ERROR') {
      throw new Error(`Contract call failed: ${JSON.stringify(result.errorResult)}`);
    }

    await this.waitForConfirmation(result.hash);
    return result.hash;
  }

  /** Submit a matched pair to the MatchingEngine contract WITH a real match proof. */
  async submitMatch(match: MatchResult): Promise<string> {
    // 32-byte big-endian ScVal from a hex or decimal field-element string.
    const fe32 = (s: string): Buffer => {
      const n = BigInt(s.startsWith('0x') ? s : `0x${BigInt(s).toString(16)}`);
      return Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
    };
    const bytesN32 = (s: string): xdr.ScVal => xdr.ScVal.scvBytes(fe32(s));

    const i128 = (n: bigint): xdr.ScVal =>
      xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString('0'),
          lo: xdr.Uint64.fromString(n.toString()),
        })
      );

    // Encode a snarkjs proof into the contract's Groth16Proof struct, using
    // Stellar's BN254 wire encoding: G1 = be(x)||be(y); G2 imaginary-first
    // be(x.c1)||be(x.c0)||be(y.c1)||be(y.c0). (Same encoding the verifier reads.)
    const g1 = (p: string[]): Buffer => Buffer.concat([fe32(p[0]), fe32(p[1])]);
    const g2 = (p: string[][]): Buffer =>
      Buffer.concat([fe32(p[0][1]), fe32(p[0][0]), fe32(p[1][1]), fe32(p[1][0])]);
    const proofToScVal = (proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }): xdr.ScVal =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pi_a'), val: xdr.ScVal.scvBytes(g1(proof.pi_a)) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pi_b'), val: xdr.ScVal.scvBytes(g2(proof.pi_b)) }),
        new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('pi_c'), val: xdr.ScVal.scvBytes(g1(proof.pi_c)) }),
      ]);
    const signalsToScVal = (signals: string[]): xdr.ScVal =>
      xdr.ScVal.scvVec(signals.map(bytesN32));

    const { proof, publicSignals } = await generateMatchProof(match);

    // Arg order must match submit_match(buyer_commitment, seller_commitment,
    // xlm_amount, usdc_amount, match_proof, match_public_signals).
    const args: xdr.ScVal[] = [
      bytesN32(match.buyerCommitment),
      bytesN32(match.sellerCommitment),
      i128(match.xlmAmount),
      i128(match.usdcAmount),
      proofToScVal(proof),
      signalsToScVal(publicSignals),
    ];

    return this.invokeContract(config.MATCHING_ENGINE_ADDRESS, 'submit_match', args);
  }

  async checkStellarConnection(): Promise<boolean> {
    try {
      await this.server.getLatestLedger();
      return true;
    } catch {
      return false;
    }
  }
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
