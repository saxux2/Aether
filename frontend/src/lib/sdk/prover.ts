import type { OrderInputs, GeneratedProofs } from './types';
import { poseidonHash } from './commitment';

const PRICE_MIN = 1000n;
const PRICE_MAX = 10_000_000n;

/**
 * Generate all three Groth16 ZK proofs for a dark pool order.
 *
 * Uses dynamic imports so snarkjs and circomlibjs are never bundled at
 * module-load time (critical for Next.js SSR — call only from client code).
 *
 * Circuit WASM + zkey files are loaded from the paths provided in `circuitBase`
 * (default: '/circuits' for the browser public dir).
 */
export async function generateOrderProofs(
  inputs: OrderInputs,
  circuitBase = '/circuits'
): Promise<GeneratedProofs> {
  // Dynamic import — deferred until call time so SSR never touches snarkjs
  const snarkjs = await import('snarkjs');

  // Commitment = Poseidon(price, quantity, direction, salt)
  const commitment = await poseidonHash([
    inputs.price,
    inputs.quantity,
    inputs.direction,
    inputs.salt,
  ]);

  // Nullifier = Poseidon(secret, nonce)
  const nullifier = await poseidonHash([inputs.secret, inputs.nonce]);

  // ── 1. OrderCommitment proof ───────────────────────────────────────────
  const { proof: orderProof, publicSignals: orderPublicSignals } =
    await snarkjs.groth16.fullProve(
      {
        price: inputs.price.toString(),
        quantity: inputs.quantity.toString(),
        direction: inputs.direction.toString(),
        salt: inputs.salt.toString(),
        commitment,
      },
      `${circuitBase}/order_commitment.wasm`,
      `${circuitBase}/order_commitment_final.zkey`
    );

  // ── 2. BalanceProof ────────────────────────────────────────────────────
  // quantity/minimum_balance here are the real escrow amount (asset_in units
  // for this order), NOT the order's XLM-denominated `quantity` — see
  // OrderInputs.escrowAmount for why those two differ for buy orders.
  const { proof: balanceProof, publicSignals: balancePublicSignals } =
    await snarkjs.groth16.fullProve(
      {
        secret: inputs.secret.toString(),
        balance: inputs.balance.toString(),
        quantity: inputs.escrowAmount.toString(),
        nonce: inputs.nonce.toString(),
        nullifier,
        minimum_balance: inputs.escrowAmount.toString(),
      },
      `${circuitBase}/balance_proof.wasm`,
      `${circuitBase}/balance_proof_final.zkey`
    );

  // ── 3. RangeProof ──────────────────────────────────────────────────────
  // Re-derives the SAME order commitment from the same (price, quantity,
  // direction, salt) preimage rather than a separate, unbound price
  // commitment — see circuits/range_proof.circom for why.
  const { proof: rangeProof, publicSignals: rangePublicSignals } =
    await snarkjs.groth16.fullProve(
      {
        price: inputs.price.toString(),
        quantity: inputs.quantity.toString(),
        direction: inputs.direction.toString(),
        salt: inputs.salt.toString(),
        price_min: PRICE_MIN.toString(),
        price_max: PRICE_MAX.toString(),
        commitment,
      },
      `${circuitBase}/range_proof.wasm`,
      `${circuitBase}/range_proof_final.zkey`
    );

  return {
    commitment,
    nullifier,
    salt: inputs.salt.toString(),
    orderProof,
    orderPublicSignals,
    balanceProof,
    balancePublicSignals,
    rangeProof,
    rangePublicSignals,
  };
}

/**
 * Verify a single Groth16 proof using a loaded verification key.
 * Used by the relayer for off-chain pre-verification before submitting on-chain.
 */
export async function verifyProof(
  vkeyJson: Record<string, unknown>,
  proof: Record<string, unknown>,
  publicSignals: string[]
): Promise<boolean> {
  const snarkjs = await import('snarkjs');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return snarkjs.groth16.verify(vkeyJson, publicSignals, proof as any);
}
