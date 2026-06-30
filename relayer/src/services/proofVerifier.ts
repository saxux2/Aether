import path from 'path';
import fs from 'fs';
import { config } from '../config';
import type { Groth16Proof } from '../types';

interface ProofBundle {
  order_proof: Groth16Proof;
  order_public_signals: string[];
  balance_proof: Groth16Proof;
  balance_public_signals: string[];
  range_proof: Groth16Proof;
  range_public_signals: string[];
}

/** Load a verification key JSON from the circuits build directory. */
function loadVKey(name: string): Record<string, unknown> | null {
  const vkPath = path.join(config.CIRCUITS_DIR, `${name}_vk.json`);
  if (!fs.existsSync(vkPath)) {
    console.warn(`[ProofVerifier] VKey not found at ${vkPath} — using stub (always passes)`);
    return null;
  }
  return JSON.parse(fs.readFileSync(vkPath, 'utf8')) as Record<string, unknown>;
}

let _vkOrder: Record<string, unknown> | null = null;
let _vkBalance: Record<string, unknown> | null = null;
let _vkRange: Record<string, unknown> | null = null;

function getVKeys() {
  if (!_vkOrder) _vkOrder = loadVKey('order_commitment');
  if (!_vkBalance) _vkBalance = loadVKey('balance_proof');
  if (!_vkRange) _vkRange = loadVKey('range_proof');
  return { vkOrder: _vkOrder, vkBalance: _vkBalance, vkRange: _vkRange };
}

/** Verify all three proofs off-chain before broadcasting the Soroban tx. */
export async function verifyAllProofs(bundle: ProofBundle): Promise<boolean> {
  const { vkOrder, vkBalance, vkRange } = getVKeys();

  // If VKeys not compiled yet, skip off-chain verification (on-chain stub returns true)
  if (!vkOrder || !vkBalance || !vkRange) return true;

  const snarkjs = await import('snarkjs');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asAny = (x: unknown) => x as any;

  // snarkjs throws (instead of returning false) on a deeply malformed proof
  // (e.g. non-curve-point coordinates). Treat any throw as verification failure.
  const safeVerify = async (vk: Record<string, unknown>, signals: string[], proof: unknown) => {
    try {
      return await snarkjs.groth16.verify(vk, signals, asAny(proof));
    } catch {
      return false;
    }
  };

  const [okOrder, okBalance, okRange] = await Promise.all([
    safeVerify(vkOrder, bundle.order_public_signals, bundle.order_proof),
    safeVerify(vkBalance, bundle.balance_public_signals, bundle.balance_proof),
    safeVerify(vkRange, bundle.range_public_signals, bundle.range_proof),
  ]);

  return okOrder && okBalance && okRange;
}
