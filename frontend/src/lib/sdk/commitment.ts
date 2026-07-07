/** Poseidon hash utilities — wraps circomlibjs for use in both Node and browser. */

export type PoseidonFn = (inputs: bigint[]) => Uint8Array;
export type PoseidonField = { toString: (x: Uint8Array) => string };

let _poseidon: PoseidonFn | null = null;
let _F: PoseidonField | null = null;

export async function getPoseidon(): Promise<{ poseidon: PoseidonFn; F: PoseidonField }> {
  if (_poseidon && _F) return { poseidon: _poseidon, F: _F };
  const { buildPoseidon } = await import('circomlibjs');
  const instance = await buildPoseidon();
  _poseidon = instance as unknown as PoseidonFn;
  _F = (instance as unknown as { F: PoseidonField }).F;
  return { poseidon: _poseidon, F: _F };
}

export async function poseidonHash(inputs: bigint[]): Promise<string> {
  const { poseidon, F } = await getPoseidon();
  return F.toString(poseidon(inputs));
}

/**
 * Compute the order commitment: Poseidon(price, quantity, direction, salt)
 */
export async function computeCommitment(
  price: bigint,
  quantity: bigint,
  direction: bigint,
  salt: bigint
): Promise<string> {
  return poseidonHash([price, quantity, direction, salt]);
}

/**
 * Compute the nullifier: Poseidon(secret, nonce)
 */
export async function computeNullifier(secret: bigint, nonce: bigint): Promise<string> {
  return poseidonHash([secret, nonce]);
}

/**
 * Generate a cryptographically random salt as a field element.
 * Works in both browser (crypto.getRandomValues) and Node.js (crypto.randomBytes).
 */
export function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    // Node.js < 19 fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require('crypto') as typeof import('crypto');
    nodeCrypto.randomFillSync(bytes);
  }
  return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
}
