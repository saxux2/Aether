#!/usr/bin/env node
/**
 * Smoke tests for all three ZK circuits.
 * Run after compile_circuits.sh + setup_ceremony.sh.
 */
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}: ${err.message}`);
      failed++;
    }
  }

  // ──────────────────────────────────────────────
  // OrderCommitment circuit tests
  // ──────────────────────────────────────────────
  console.log('\nOrderCommitment:');

  await test('valid inputs produce valid proof', async () => {
    const price = 140000n;
    const quantity = 5_000_000_000_000n;
    const direction = 0n;
    const salt = 12345678901234567890n;

    const commitment = F.toString(poseidon([price, quantity, direction, salt]));

    const { proof } = await snarkjs.groth16.fullProve(
      { price: price.toString(), quantity: quantity.toString(),
        direction: direction.toString(), salt: salt.toString(), commitment },
      `${BUILD}/order_commitment_js/order_commitment.wasm`,
      `${BUILD}/order_commitment_final.zkey`
    );
    if (!proof) throw new Error('no proof generated');
  });

  await test('direction=2 fails constraint', async () => {
    const price = 140000n;
    const quantity = 5_000_000_000_000n;
    const direction = 2n;
    const salt = 12345678901234567890n;

    // Fake commitment — circuit should fail before we even get there
    const commitment = F.toString(poseidon([price, quantity, direction, salt]));

    try {
      await snarkjs.groth16.fullProve(
        { price: price.toString(), quantity: quantity.toString(),
          direction: direction.toString(), salt: salt.toString(), commitment },
        `${BUILD}/order_commitment_js/order_commitment.wasm`,
        `${BUILD}/order_commitment_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
      // Expected: circuit constraint violation
    }
  });

  // ──────────────────────────────────────────────
  // BalanceProof circuit tests
  // ──────────────────────────────────────────────
  console.log('\nBalanceProof:');

  await test('sufficient balance produces valid proof', async () => {
    const secret = 999888777666555444333n;
    const balance = 10_000_000_000_000n;
    const quantity = 5_000_000_000_000n;
    const nonce = BigInt(Date.now());

    const nullifier = F.toString(poseidon([secret, nonce]));

    const { proof } = await snarkjs.groth16.fullProve(
      { secret: secret.toString(), balance: balance.toString(),
        quantity: quantity.toString(), nonce: nonce.toString(),
        nullifier, minimum_balance: quantity.toString() },
      `${BUILD}/balance_proof_js/balance_proof.wasm`,
      `${BUILD}/balance_proof_final.zkey`
    );
    if (!proof) throw new Error('no proof generated');
  });

  await test('balance < quantity fails constraint', async () => {
    const secret = 999888777666555444333n;
    const balance = 1_000_000n;       // tiny balance
    const quantity = 5_000_000_000_000n; // large order
    const nonce = BigInt(Date.now());

    const nullifier = F.toString(poseidon([secret, nonce]));

    try {
      await snarkjs.groth16.fullProve(
        { secret: secret.toString(), balance: balance.toString(),
          quantity: quantity.toString(), nonce: nonce.toString(),
          nullifier, minimum_balance: quantity.toString() },
        `${BUILD}/balance_proof_js/balance_proof.wasm`,
        `${BUILD}/balance_proof_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  // ──────────────────────────────────────────────
  // RangeProof circuit tests
  // ──────────────────────────────────────────────
  console.log('\nRangeProof:');

  const PRICE_MIN = 1000n;
  const PRICE_MAX = 10_000_000n;

  await test('price within range produces valid proof', async () => {
    const price = 140_000n;
    const price_salt = 42n ^ price;
    const price_commitment = F.toString(poseidon([price, price_salt]));

    const { proof } = await snarkjs.groth16.fullProve(
      { price: price.toString(), price_salt: price_salt.toString(),
        price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
        price_commitment },
      `${BUILD}/range_proof_js/range_proof.wasm`,
      `${BUILD}/range_proof_final.zkey`
    );
    if (!proof) throw new Error('no proof generated');
  });

  await test('price below minimum fails constraint', async () => {
    const price = 500n; // below PRICE_MIN=1000
    const price_salt = 42n ^ price;
    const price_commitment = F.toString(poseidon([price, price_salt]));

    try {
      await snarkjs.groth16.fullProve(
        { price: price.toString(), price_salt: price_salt.toString(),
          price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
          price_commitment },
        `${BUILD}/range_proof_js/range_proof.wasm`,
        `${BUILD}/range_proof_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('price above maximum fails constraint', async () => {
    const price = 20_000_000n; // above PRICE_MAX
    const price_salt = 42n ^ price;
    const price_commitment = F.toString(poseidon([price, price_salt]));

    try {
      await snarkjs.groth16.fullProve(
        { price: price.toString(), price_salt: price_salt.toString(),
          price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
          price_commitment },
        `${BUILD}/range_proof_js/range_proof.wasm`,
        `${BUILD}/range_proof_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  // ──────────────────────────────────────────────
  // Summary
  // ──────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
