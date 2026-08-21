import {
  Contract,
  Keypair,
  rpc,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { config } from '../config';
import type { MatchResult } from '../types';
import { generateMatchProof } from './matchProver';

export class SorobanService {
  private static warnedAboutMissingKey = false;

  private server: rpc.Server;
  private keypair: Keypair;

  constructor() {
    this.server = new rpc.Server(config.STELLAR_RPC_URL);
    if (config.RELAYER_SECRET_KEY) {
      this.keypair = Keypair.fromSecret(config.RELAYER_SECRET_KEY);
    } else {
      // Development only — assertDeploymentConfig() refuses to start a
      // mainnet/production relayer without a key. The random keypair here has
      // no funded account, so anything that signs (invokeContract, submitMatch)
      // fails at getAccount; read-only paths still work. Say so out loud
      // instead of letting that surface as a bare "account not found".
      if (!SorobanService.warnedAboutMissingKey) {
        console.warn(
          '[Soroban] RELAYER_SECRET_KEY is not set — using an ephemeral keypair. ' +
            'Signed contract calls (settlement) will fail.'
        );
        SorobanService.warnedAboutMissingKey = true;
      }
      this.keypair = Keypair.random();
    }
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
    assertAccepted(result.status, result.hash, result.errorResult);
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

    const tx = new TransactionBuilder(account, {
      fee: '1000000',
      // The configured passphrase — not one re-derived from STELLAR_NETWORK.
      // Deriving it here as `STELLAR_NETWORK === 'mainnet' ? PUBLIC : TESTNET`
      // meant STELLAR_NETWORK_PASSPHRASE (set in .env.example, .env.mainnet,
      // and config.ts) was never actually read by anything, so the value an
      // operator configures and the value the relayer signs with could
      // silently disagree. Any spelling of the live network other than the
      // literal 'mainnet' — 'public', 'pubnet', 'PUBLIC' — signed every
      // settlement with the *testnet* network id while STELLAR_RPC_URL pointed
      // at mainnet, and each submit_match came back as a signature failure
      // that names neither the network nor the passphrase.
      networkPassphrase: config.STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(this.keypair);

    const result = await this.server.sendTransaction(prepared);
    assertAccepted(result.status, result.hash, result.errorResult);

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

  /**
   * Liveness probe for the configured Soroban RPC endpoint.
   *
   * Bounded, because the only caller is GET /api/health and an *unbounded*
   * probe turns a degraded dependency into a dead endpoint: a black-holed RPC
   * host (dropped packets rather than a refused connection) leaves the request
   * hanging with no answer at all, so the keepalive workflow's curl gives up
   * on --max-time and reports "Relayer did not respond (connection error)" —
   * pointing the on-call at the relayer instead of at the RPC provider that is
   * actually down, and losing the mongodb/batch_auction fields that would have
   * said which. Timing out into `false` reports the same 503 the endpoint
   * already returns for an unreachable RPC, with the rest of the body intact.
   */
  async checkStellarConnection(timeoutMs = 5_000): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // .catch() on the probe itself, not around the race: once the timeout has
    // won, a later rejection from getLatestLedger() would have nothing awaiting
    // it, and index.ts escalates an unhandled rejection to process.exit(1) —
    // a health check that kills the relayer it is checking.
    const probe = this.server
      .getLatestLedger()
      .then(() => true)
      .catch(() => false);
    const timedOut = new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    try {
      return await Promise.race([probe, timedOut]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/**
 * Throw unless the RPC actually took custody of the transaction.
 *
 * sendTransaction answers with one of four statuses, and only ERROR used to
 * be treated as a failure here. TRY_AGAIN_LATER — the node's queue is full,
 * or it is still processing an earlier transaction from the same source
 * account — is a rejection too: the transaction was NOT queued and never
 * will be, but the response still carries a hash. Returning that hash sent
 * the caller into waitForConfirmation(), which polled a transaction the
 * network had never heard of for its full 30 attempts and then reported
 * "Confirmation timeout" — a message that reads like a slow ledger and
 * invites a retry of the confirmation rather than of the submission. On
 * the submit path that is 30s of a trader's request spent learning nothing;
 * in the batch loop it is 30s per match, on a loop that has to finish
 * inside its own interval.
 *
 * DUPLICATE is the one non-PENDING status that is genuinely fine: the same
 * transaction is already in flight from an earlier send, so the hash is
 * real and polling it is exactly right.
 */
export function assertAccepted(status: string, hash: string, errorResult?: unknown): void {
  if (status === 'PENDING' || status === 'DUPLICATE') return;
  if (status === 'TRY_AGAIN_LATER') {
    throw new Error(
      `Soroban RPC did not accept the transaction (TRY_AGAIN_LATER) — ` +
        `it was never queued; resubmit rather than waiting on ${hash}`
    );
  }
  throw new Error(`Transaction rejected by RPC (${status}): ${JSON.stringify(errorResult)}`);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}
