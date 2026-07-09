#!/usr/bin/env node
/**
 * Smoke + adversarial tests for all four ZK circuits.
 * Run after compile_circuits.sh + setup_ceremony.sh (+ export_vkeys.sh for
 * the verify() calls below, which load each circuit's _vk.json).
 */
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
const path = require('path');
const fs = require('fs');

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

  function loadVk(name) {
    return JSON.parse(fs.readFileSync(`${BUILD}/${name}_vk.json`, 'utf8'));
  }

  // ──────────────────────────────────────────────
  // OrderCommitment circuit tests
  // ──────────────────────────────────────────────
  console.log('\nOrderCommitment:');

  await test('valid inputs produce a valid, verifiable proof', async () => {
    const price = 140000n;
    const quantity = 5_000_000_000_000n;
    const direction = 0n;
    const salt = 12345678901234567890n;

    const commitment = F.toString(poseidon([price, quantity, direction, salt]));

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { price: price.toString(), quantity: quantity.toString(),
        direction: direction.toString(), salt: salt.toString(), commitment },
      `${BUILD}/order_commitment_js/order_commitment.wasm`,
      `${BUILD}/order_commitment_final.zkey`
    );
    if (!proof) throw new Error('no proof generated');
    const ok = await snarkjs.groth16.verify(loadVk('order_commitment'), publicSignals, proof);
    if (!ok) throw new Error('proof did not verify');
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

  await test('a commitment for different order fields is rejected (forged preimage)', async () => {
    // Prover claims commitment for (price=140000, ...) but actually supplies
    // different private inputs — the circuit must reject a mismatched hash,
    // not just check the fields are individually well-formed.
    const realCommitment = F.toString(poseidon([140000n, 5_000_000_000_000n, 0n, 111n]));
    try {
      await snarkjs.groth16.fullProve(
        { price: '999999', quantity: '1', direction: '0', salt: '111', commitment: realCommitment },
        `${BUILD}/order_commitment_js/order_commitment.wasm`,
        `${BUILD}/order_commitment_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  // ──────────────────────────────────────────────
  // BalanceProof circuit tests
  // ──────────────────────────────────────────────
  console.log('\nBalanceProof:');

  await test('sufficient balance produces a valid, verifiable proof', async () => {
    const secret = 999888777666555444333n;
    const balance = 10_000_000_000_000n;
    const quantity = 5_000_000_000_000n;
    const nonce = BigInt(Date.now());

    const nullifier = F.toString(poseidon([secret, nonce]));

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { secret: secret.toString(), balance: balance.toString(),
        quantity: quantity.toString(), nonce: nonce.toString(),
        nullifier, minimum_balance: quantity.toString() },
      `${BUILD}/balance_proof_js/balance_proof.wasm`,
      `${BUILD}/balance_proof_final.zkey`
    );
    if (!proof) throw new Error('no proof generated');
    const ok = await snarkjs.groth16.verify(loadVk('balance_proof'), publicSignals, proof);
    if (!ok) throw new Error('proof did not verify');
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

  await test('minimum_balance != quantity fails constraint (cannot decouple the two)', async () => {
    // Regression guard: a prover claiming a small public minimum_balance
    // while internally using a different quantity must be rejected — this
    // is exactly the field order_book.rs binds against amount_in.
    const secret = 999888777666555444333n;
    const balance = 10_000_000_000_000n;
    const quantity = 5_000_000_000_000n;
    const nonce = BigInt(Date.now());
    const nullifier = F.toString(poseidon([secret, nonce]));

    try {
      await snarkjs.groth16.fullProve(
        { secret: secret.toString(), balance: balance.toString(),
          quantity: quantity.toString(), nonce: nonce.toString(),
          nullifier, minimum_balance: '1' }, // claims a trivial floor instead
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

  await test('price within range produces a valid, verifiable proof', async () => {
    const price = 140_000n, quantity = 5_000_000_000_000n, direction = 0n, salt = 42n;
    const commitment = F.toString(poseidon([price, quantity, direction, salt]));

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { price: price.toString(), quantity: quantity.toString(), direction: direction.toString(),
        salt: salt.toString(), price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
        commitment },
      `${BUILD}/range_proof_js/range_proof.wasm`,
      `${BUILD}/range_proof_final.zkey`
    );
    if (!proof) throw new Error('no proof generated');
    const ok = await snarkjs.groth16.verify(loadVk('range_proof'), publicSignals, proof);
    if (!ok) throw new Error('proof did not verify');
  });

  await test('price below minimum fails constraint', async () => {
    const price = 500n, quantity = 5_000_000_000_000n, direction = 0n, salt = 42n; // price below PRICE_MIN=1000
    const commitment = F.toString(poseidon([price, quantity, direction, salt]));

    try {
      await snarkjs.groth16.fullProve(
        { price: price.toString(), quantity: quantity.toString(), direction: direction.toString(),
          salt: salt.toString(), price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
          commitment },
        `${BUILD}/range_proof_js/range_proof.wasm`,
        `${BUILD}/range_proof_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('price above maximum fails constraint', async () => {
    const price = 20_000_000n, quantity = 5_000_000_000_000n, direction = 0n, salt = 42n; // above PRICE_MAX
    const commitment = F.toString(poseidon([price, quantity, direction, salt]));

    try {
      await snarkjs.groth16.fullProve(
        { price: price.toString(), quantity: quantity.toString(), direction: direction.toString(),
          salt: salt.toString(), price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
          commitment },
        `${BUILD}/range_proof_js/range_proof.wasm`,
        `${BUILD}/range_proof_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('range proof for a DIFFERENT order commitment is rejected (the fixed vulnerability)', async () => {
    // This is the exact bug this redesign closes: an earlier version let a
    // trader submit a real, out-of-band-priced order_commitment alongside a
    // valid range proof for an unrelated, in-band dummy price/order, because
    // the range proof committed to price via a separate, unbound hash. Now
    // the range proof must open the SAME commitment order_commitment does —
    // proving an in-range price for order A while presenting order B's
    // commitment must fail.
    const realOrder = { price: 20_000_000n, quantity: 5_000_000_000_000n, direction: 0n, salt: 7n }; // out of band
    const dummyOrder = { price: 140_000n, quantity: 1_000_000n, direction: 0n, salt: 8n };            // in band
    const realCommitment = F.toString(poseidon([realOrder.price, realOrder.quantity, realOrder.direction, realOrder.salt]));

    try {
      // Attempt: prove the DUMMY (in-range) order's fields, but publicly claim
      // the REAL (out-of-range) order's commitment.
      await snarkjs.groth16.fullProve(
        { price: dummyOrder.price.toString(), quantity: dummyOrder.quantity.toString(),
          direction: dummyOrder.direction.toString(), salt: dummyOrder.salt.toString(),
          price_min: PRICE_MIN.toString(), price_max: PRICE_MAX.toString(),
          commitment: realCommitment },
        `${BUILD}/range_proof_js/range_proof.wasm`,
        `${BUILD}/range_proof_final.zkey`
      );
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  // ──────────────────────────────────────────────
  // MatchProof circuit tests
  // ──────────────────────────────────────────────
  console.log('\nMatchProof:');

  const PRICE_SCALE = 1_000_000n;

  function matchInputs(overrides = {}) {
    const base = {
      buyer_price: 140_000n, buyer_quantity: 5_000_000_000_000n, buyer_salt: 111n,
      seller_price: 130_000n, seller_quantity: 5_000_000_000_000n, seller_salt: 222n,
      clearing_price: 135_000n, xlm_amount: 5_000_000_000_000n,
    };
    const merged = { ...base, ...overrides };
    merged.usdc_amount = overrides.usdc_amount ??
      (merged.xlm_amount * merged.clearing_price) / PRICE_SCALE;
    return merged;
  }

  async function proveMatch(inputs) {
    const buyer_commitment = F.toString(poseidon([inputs.buyer_price, inputs.buyer_quantity, 0n, inputs.buyer_salt]));
    const seller_commitment = F.toString(poseidon([inputs.seller_price, inputs.seller_quantity, 1n, inputs.seller_salt]));
    const input = {};
    for (const k of ['buyer_price', 'buyer_quantity', 'buyer_salt', 'seller_price', 'seller_quantity',
                      'seller_salt', 'clearing_price', 'xlm_amount', 'usdc_amount']) {
      input[k] = inputs[k].toString();
    }
    input.buyer_commitment = buyer_commitment;
    input.seller_commitment = seller_commitment;
    return snarkjs.groth16.fullProve(
      input,
      `${BUILD}/match_proof_js/match_proof.wasm`,
      `${BUILD}/match_proof_final.zkey`
    );
  }

  await test('valid crossing match produces a valid, verifiable proof', async () => {
    const { proof, publicSignals } = await proveMatch(matchInputs());
    if (!proof) throw new Error('no proof generated');
    const ok = await snarkjs.groth16.verify(loadVk('match_proof'), publicSignals, proof);
    if (!ok) throw new Error('proof did not verify');
  });

  await test('clearing_price above buyer_price fails constraint', async () => {
    try {
      await proveMatch(matchInputs({ clearing_price: 150_000n })); // > buyer_price 140000
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('clearing_price below seller_price fails constraint', async () => {
    try {
      await proveMatch(matchInputs({ clearing_price: 120_000n })); // < seller_price 130000
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('xlm_amount exceeding buyer_quantity fails constraint', async () => {
    try {
      await proveMatch(matchInputs({ xlm_amount: 6_000_000_000_000n })); // > both quantities
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('xlm_amount of zero fails constraint (must be strictly positive)', async () => {
    try {
      await proveMatch(matchInputs({ xlm_amount: 0n, usdc_amount: 0n }));
      throw new Error('should have failed');
    } catch (e) {
      if (e.message === 'should have failed') throw e;
    }
  });

  await test('usdc_amount off by one from the exact floor-division result fails constraint', async () => {
    const inputs = matchInputs();
    const exact = (inputs.xlm_amount * inputs.clearing_price) / PRICE_SCALE;
    try {
      await proveMatch({ ...inputs, usdc_amount: exact + 1n });
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
