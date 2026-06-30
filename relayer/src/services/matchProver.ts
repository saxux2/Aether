import path from 'path';
import { config } from '../config';
import type { MatchResult, Groth16Proof } from '../types';

const PRICE_SCALE = 1_000_000n;

export interface MatchProofBundle {
  proof: Groth16Proof;
  /** [buyer_commitment, seller_commitment, clearing_price, xlm_amount, usdc_amount] */
  publicSignals: string[];
}

async function poseidon4(values: bigint[]): Promise<string> {
  const { buildPoseidon } = await import('circomlibjs');
  const poseidon = await buildPoseidon();
  return poseidon.F.toString(poseidon(values));
}

async function commitmentSalt(
  commitment: string,
  price: bigint,
  quantity: bigint,
  direction: bigint,
  storedSalt: string,
): Promise<bigint> {
  const salt = BigInt(storedSalt);
  const normalizedCommitment = BigInt(commitment).toString();

  const direct = await poseidon4([price, quantity, direction, salt]);
  if (direct === normalizedCommitment) return salt;

  // Older frontend submissions accidentally stored range-proof priceSalt
  // (salt XOR price) as revealed_salt. Recover the original salt so already
  // submitted orders can still produce a valid MatchProof.
  const recoveredSalt = salt ^ price;
  const recovered = await poseidon4([price, quantity, direction, recoveredSalt]);
  if (recovered === normalizedCommitment) return recoveredSalt;

  throw new Error(
    `order commitment preimage mismatch for ${commitment.slice(0, 16)}... ` +
    `(direction=${direction}, price=${price}, quantity=${quantity})`
  );
}

/**
 * Generate a real Groth16 MatchProof for a matched pair. The circuit proves the
 * pair is legitimate (commitments open, clearing price within both limits, fill
 * within committed quantities, exact USDC arithmetic) so the MatchingEngine
 * contract no longer has to trust the relayer's revealed prices.
 *
 * The witness inputs are the commitment preimages the relayer already holds; only
 * the commitments + settlement figures become public.
 */
export async function generateMatchProof(match: MatchResult): Promise<MatchProofBundle> {
  const snarkjs = await import('snarkjs');

  // Defensive: the circuit enforces this exactly; assert here for a clearer error.
  const expectedUsdc = (match.xlmAmount * match.settlementPrice) / PRICE_SCALE;
  if (expectedUsdc !== match.usdcAmount) {
    throw new Error(
      `match usdc mismatch: got ${match.usdcAmount}, expected floor(${match.xlmAmount}*${match.settlementPrice}/1e6)=${expectedUsdc}`
    );
  }

  const [buyerSalt, sellerSalt] = await Promise.all([
    commitmentSalt(
      match.buyerCommitment,
      match.buyerPrice,
      match.buyerQuantity,
      0n,
      match.buyerSalt
    ),
    commitmentSalt(
      match.sellerCommitment,
      match.sellerPrice,
      match.sellerQuantity,
      1n,
      match.sellerSalt
    ),
  ]);

  const input = {
    buyer_price: match.buyerPrice.toString(),
    buyer_quantity: match.buyerQuantity.toString(),
    buyer_salt: buyerSalt.toString(),
    seller_price: match.sellerPrice.toString(),
    seller_quantity: match.sellerQuantity.toString(),
    seller_salt: sellerSalt.toString(),
    buyer_commitment: BigInt(match.buyerCommitment).toString(),
    seller_commitment: BigInt(match.sellerCommitment).toString(),
    clearing_price: match.settlementPrice.toString(),
    xlm_amount: match.xlmAmount.toString(),
    usdc_amount: match.usdcAmount.toString(),
  };

  const wasm = path.join(config.CIRCUITS_DIR, 'match_proof.wasm');
  const zkey = path.join(config.CIRCUITS_DIR, 'match_proof_final.zkey');

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  return { proof: proof as Groth16Proof, publicSignals: publicSignals as string[] };
}
