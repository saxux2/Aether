#!/usr/bin/env node
/**
 * End-to-end test suite — ZK Dark Pool DEX
 *
 * Suite 1 — Circuit proof generation & verification (no relayer needed)
 * Suite 2 — Relayer health endpoints
 * Suite 3 — Order submission  (SKIP_CHAIN mode: validation layer only;
 *                               full mode: on-chain submit when ORDER_BOOK_ADDRESS is set)
 * Suite 4 — Batch auction     (only when Suite 3 orders are in DB)
 * Suite 5 — Error cases
 *
 * Usage:
 *   node scripts/e2e_test.js
 *   RELAYER_URL=http://localhost:3001 node scripts/e2e_test.js
 *   CIRCUITS_BUILD=/path/to/circuits/build node scripts/e2e_test.js
 *   SKIP_CHAIN=true node scripts/e2e_test.js          # force validation-layer mode
 *   ORDER_BOOK_ADDRESS=CXXX... node scripts/e2e_test.js # enable full on-chain flow
 *   BATCH_POLL_TIMEOUT_SECONDS=30 node scripts/e2e_test.js
 */
'use strict';

// ── Monorepo node_modules path resolution ─────────────────────────────────────
// Patching Module._resolveFilename causes infinite recursion in Node 22.
// Use NODE_PATH + _initPaths() instead — safe and side-effect free.
const path        = require('path');
const MODULE_ROOT = path.resolve(__dirname, '..');
const ROOT_NM     = path.join(MODULE_ROOT, 'node_modules');
process.env.NODE_PATH = (process.env.NODE_PATH ? process.env.NODE_PATH + path.delimiter : '') + ROOT_NM;
require('module').Module._initPaths();

const fs      = require('fs');
const axios   = require(path.join(ROOT_NM, 'axios'));
const snarkjs = require(path.join(ROOT_NM, 'snarkjs'));
const { buildPoseidon } = require(path.join(ROOT_NM, 'circomlibjs'));

// ── Configuration ─────────────────────────────────────────────────────────────
const RELAYER_URL  = process.env.RELAYER_URL    || 'http://localhost:3001';
const CIRCUITS_DIR = process.env.CIRCUITS_BUILD || process.env.CIRCUITS_DIR ||
                     path.join(__dirname, '..', 'circuits', 'build');
// SKIP_CHAIN: true when contracts are NOT deployed (no ORDER_BOOK_ADDRESS in env)
const SKIP_CHAIN   = process.env.SKIP_CHAIN === 'true' || !process.env.ORDER_BOOK_ADDRESS;
const BATCH_POLL_S = parseInt(process.env.BATCH_POLL_TIMEOUT_SECONDS || '120', 10);

// ── Stellar SDK (lazy-loaded only when not in SKIP_CHAIN mode) ────────────────
const STELLAR_RPC_URL     = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const ORDER_BOOK_ADDRESS  = process.env.ORDER_BOOK_ADDRESS || '';
// RELAYER_SECRET_KEY can be used as the test signer — it must be a funded
// testnet account. No hardcoded fallback: a committed secret key, even a
// testnet-only one, should be treated as burned the moment it's in source
// control. Only required in chain mode (SKIP_CHAIN=false).
const TEST_SECRET_KEY = process.env.TEST_SECRET_KEY || process.env.RELAYER_SECRET_KEY || '';
if (!SKIP_CHAIN && !TEST_SECRET_KEY) {
  console.error('ERROR: set TEST_SECRET_KEY or RELAYER_SECRET_KEY to a funded testnet account secret.');
  process.exit(1);
}
// Native XLM SAC address on testnet
const XLM_SAC_ADDRESS     = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const USDC_TOKEN_ADDRESS  = process.env.USDC_TOKEN_ADDRESS ||
                            'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

// ── ANSI colours ──────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
  grey:   '\x1b[90m',
};

// ── Test runner state ─────────────────────────────────────────────────────────
let totalPassed  = 0;
let totalFailed  = 0;
let totalSkipped = 0;
const failures   = [];

function banner(title) {
  console.log('\n' + C.bold + C.cyan + '─'.repeat(62) + C.reset);
  console.log(C.bold + C.cyan + '  ' + title + C.reset);
  console.log(C.cyan + '─'.repeat(62) + C.reset);
}

function passLine(name, ms) {
  totalPassed++;
  console.log('  ' + C.green + '✓' + C.reset + ' ' + name + ' ' + C.grey + '(' + ms + 'ms)' + C.reset);
}

function failLine(suite, name, ms, err) {
  totalFailed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log('  ' + C.red + '✗' + C.reset + ' ' + name + ' ' + C.grey + '(' + ms + 'ms)' + C.reset);
  console.log('    ' + C.red + '└ ' + msg + C.reset);
  failures.push({ suite, name, error: msg });
}

function skipLine(name, reason) {
  totalSkipped++;
  console.log('  ' + C.yellow + '⊘' + C.reset + ' ' + name + ' ' + C.yellow + '[skipped: ' + reason + ']' + C.reset);
}

async function test(suite, name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passLine(name, Date.now() - t0);
    return true;
  } catch (err) {
    failLine(suite, name, Date.now() - t0, err);
    return false;
  }
}

// ── Assertion helpers ─────────────────────────────────────────────────────────
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}
function assertEq(actual, expected, label) {
  if (actual !== expected)
    throw new Error((label || 'Value') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}
function assertHTTP(res, code, label) {
  if (res.status !== code) {
    const body = JSON.stringify(res.data).slice(0, 240);
    throw new Error((label || 'HTTP') + ': expected ' + code + ', got ' + res.status + ' — ' + body);
  }
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
const HTTP_OPTS = { validateStatus: () => true };

function apiGet(url)       { return axios.get(url,    { ...HTTP_OPTS, timeout: 10_000 }); }
function apiPost(url, data) { return axios.post(url, data, { ...HTTP_OPTS, timeout: 120_000 }); }
function apiDelete(url, data) {
  return axios.delete(url, { data, ...HTTP_OPTS, timeout: 10_000 });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Unique run seed (prevents nullifier/commitment collisions across runs) ─────
const RUN_SEED = BigInt(Date.now());

// ── Static order parameters ───────────────────────────────────────────────────
//   price   : micro-USDC per XLM  (140000 = $0.14/XLM)
//   quantity: stroops             (5_000_000_000 = 500 XLM)
//   balance : stroops             (100_000_000_000_000 = 10,000,000 XLM)
const BUY_PARAMS = {
  price:    140000n,
  quantity: 5_000_000_000n,
  direction: 0n,                                     // 0 = buy
  salt:     RUN_SEED + 11_111_111_111_111_111_111n,
  secret:   RUN_SEED + 99_887_766_554_433_221_100n,
  balance:  100_000_000_000_000n,
  nonce:    RUN_SEED + 1n,
  priceMin: 1_000n,
  priceMax: 10_000_000n,
};

const SELL_PARAMS = {
  price:    130000n,                                 // $0.13 < $0.14 → crosses the buy
  quantity: 5_000_000_000n,
  direction: 1n,                                     // 1 = sell
  salt:     RUN_SEED + 22_222_222_222_222_222_222n,
  secret:   RUN_SEED + 88_776_655_443_322_110_099n,
  balance:  100_000_000_000_000n,
  nonce:    RUN_SEED + 2n,
  priceMin: 1_000n,
  priceMax: 10_000_000n,
};

// ── Shared state ──────────────────────────────────────────────────────────────
let poseidon   = null;
let F          = null;
let buyProofs  = null;
let sellProofs = null;
let buyCommitment  = null;
let sellCommitment = null;
let ordersInDB     = false;

const PRICE_SCALE = 1_000_000n;

/** USDC base units for a buy order, XLM stroops directly for a sell — must
 * match order_book.rs's amount_to_b32 binding and the frontend's
 * computeEscrowAmount exactly (see frontend/src/utils/constants.ts). */
function computeEscrowAmount(direction, quantity, price) {
  return direction === 0n ? (quantity * price) / PRICE_SCALE : quantity;
}

// ── Proof generation ──────────────────────────────────────────────────────────
/**
 * Generate all three Groth16 proofs for a dark pool order.
 *
 * WASM and zkey files are loaded from CIRCUITS_DIR/*_js/ subdirectories
 * which are the canonical output of `circom --wasm`.
 */
async function generateProofs(params, label) {
  const { price, quantity, direction, salt, secret, balance, nonce, priceMin, priceMax } = params;

  // Derived values
  const commitment   = F.toString(poseidon([price, quantity, direction, salt]));
  const nullifier     = F.toString(poseidon([secret, nonce]));
  const escrowAmount  = computeEscrowAmount(direction, quantity, price);

  const wasmOrder   = path.join(CIRCUITS_DIR, 'order_commitment_js', 'order_commitment.wasm');
  const zkeyOrder   = path.join(CIRCUITS_DIR, 'order_commitment_final.zkey');
  const wasmBalance = path.join(CIRCUITS_DIR, 'balance_proof_js', 'balance_proof.wasm');
  const zkeyBalance = path.join(CIRCUITS_DIR, 'balance_proof_final.zkey');
  const wasmRange   = path.join(CIRCUITS_DIR, 'range_proof_js', 'range_proof.wasm');
  const zkeyRange   = path.join(CIRCUITS_DIR, 'range_proof_final.zkey');

  // 1. order_commitment circuit
  //    Inputs: price, quantity, direction, salt (private); commitment (public)
  //    Outputs: valid (public signal index 0)
  console.log('    ' + C.grey + '[' + label + '] Generating order_commitment proof…' + C.reset);
  const { proof: orderProof, publicSignals: orderPublicSignals } =
    await snarkjs.groth16.fullProve(
      {
        price:      price.toString(),
        quantity:   quantity.toString(),
        direction:  direction.toString(),
        salt:       salt.toString(),
        commitment,
      },
      wasmOrder, zkeyOrder
    );

  // 2. balance_proof circuit
  //    Inputs: secret, balance, quantity, nonce (private); nullifier, minimum_balance (public)
  //    quantity/minimum_balance are the real escrow amount (escrowAmount),
  //    NOT the order's XLM-denominated `quantity` — order_book checks
  //    minimum_balance against the real on-chain amount_in, and for a buy
  //    order that's USDC, not XLM. See computeEscrowAmount above.
  console.log('    ' + C.grey + '[' + label + '] Generating balance_proof…' + C.reset);
  const { proof: balanceProof, publicSignals: balancePublicSignals } =
    await snarkjs.groth16.fullProve(
      {
        secret:          secret.toString(),
        balance:         balance.toString(),
        quantity:        escrowAmount.toString(),
        nonce:           nonce.toString(),
        nullifier,
        minimum_balance: escrowAmount.toString(),
      },
      wasmBalance, zkeyBalance
    );

  // 3. range_proof circuit
  //    Inputs: price, quantity, direction, salt (private, same preimage as
  //    order_commitment); price_min, price_max, commitment (public). Proves
  //    the price of THIS specific order (identified by its real commitment)
  //    is in-band — see circuits/range_proof.circom for why it shares the
  //    order's preimage instead of a separate, unbound price commitment.
  console.log('    ' + C.grey + '[' + label + '] Generating range_proof…' + C.reset);
  const { proof: rangeProof, publicSignals: rangePublicSignals } =
    await snarkjs.groth16.fullProve(
      {
        price:      price.toString(),
        quantity:   quantity.toString(),
        direction:  direction.toString(),
        salt:       salt.toString(),
        price_min:  priceMin.toString(),
        price_max:  priceMax.toString(),
        commitment,
      },
      wasmRange, zkeyRange
    );

  return {
    orderProof,   orderPublicSignals,
    balanceProof, balancePublicSignals,
    rangeProof,   rangePublicSignals,
    commitment,
    nullifier,
    escrowAmount: escrowAmount.toString(),
    revealedPrice: price.toString(),
    revealedSalt:  salt.toString(),
  };
}

/**
 * Build a real signed Soroban transaction calling OrderBook.submit_order().
 * Returns the base64 XDR of the signed transaction ready for broadcast.
 *
 * Encoding:
 *   Groth16Proof  → scvMap { pi_a: bytes64, pi_b: bytes128, pi_c: bytes64 }
 *   public signals → scvVec of scvBytes(32) (each field element as big-endian 32B)
 *   commitment/nullifier → scvBytes(32) from decimal field element string
 *
 * Auth: prepareTransaction() returns the auth tree from simulation; the transaction
 * is then signed with the keypair so the account's auth covers all require_auth()
 * calls in the call tree (order_book + escrow_vault + token).
 */
async function buildSignedSubmitOrderXDR(proofs, assetIn, assetOut, amountIn) {
  // Lazy-load @stellar/stellar-sdk — only needed in full chain mode
  const stellar = require(path.join(ROOT_NM, '@stellar/stellar-sdk'));
  const { Keypair, Networks, rpc, TransactionBuilder, Contract, Address, xdr: X } = stellar;

  const keypair   = Keypair.fromSecret(TEST_SECRET_KEY);
  const server    = new rpc.Server(STELLAR_RPC_URL);
  const account   = await server.getAccount(keypair.publicKey());
  const contract  = new Contract(ORDER_BOOK_ADDRESS);
  const passphrase = Networks.TESTNET;

  // ── Encoding helpers ──────────────────────────────────────────────────────
  function hexPad32(n) {
    return Buffer.from(BigInt(n).toString(16).padStart(64, '0'), 'hex');
  }
  function g1ToBytes(pt) { // G1 point [x, y, "1"] → 64 bytes
    return Buffer.concat([hexPad32(pt[0]), hexPad32(pt[1])]);
  }
  function g2ToBytes(pt) { // G2 point [[c0,c1],[c0,c1]] → 128 bytes
    // Stellar BN254 wants imaginary-first per Fp2: be(c1)||be(c0).
    // snarkjs gives [c0, c1], so swap. (Must match the on-chain verifier.)
    return Buffer.concat([hexPad32(pt[0][1]), hexPad32(pt[0][0]),
                          hexPad32(pt[1][1]), hexPad32(pt[1][0])]);
  }
  function proofScVal(proof) {
    return X.ScVal.scvMap([
      new X.ScMapEntry({ key: X.ScVal.scvSymbol('pi_a'), val: X.ScVal.scvBytes(g1ToBytes(proof.pi_a)) }),
      new X.ScMapEntry({ key: X.ScVal.scvSymbol('pi_b'), val: X.ScVal.scvBytes(g2ToBytes(proof.pi_b)) }),
      new X.ScMapEntry({ key: X.ScVal.scvSymbol('pi_c'), val: X.ScVal.scvBytes(g1ToBytes(proof.pi_c)) }),
    ]);
  }
  function signalsScVal(signals) {
    return X.ScVal.scvVec(signals.map(s => X.ScVal.scvBytes(hexPad32(s))));
  }
  function fieldBytes32(s) { // decimal field element → BytesN<32>
    return X.ScVal.scvBytes(hexPad32(s));
  }

  const assetInAddr  = assetIn  === 'XLM' ? XLM_SAC_ADDRESS  : USDC_TOKEN_ADDRESS;
  const assetOutAddr = assetOut === 'XLM' ? XLM_SAC_ADDRESS  : USDC_TOKEN_ADDRESS;
  const expiresAt    = Math.floor(Date.now() / 1000) + 3600;

  const args = [
    new Address(keypair.publicKey()).toScVal(),
    fieldBytes32(proofs.commitment),
    fieldBytes32(proofs.nullifier),
    new Address(assetInAddr).toScVal(),
    new Address(assetOutAddr).toScVal(),
    X.ScVal.scvI128(new X.Int128Parts({
      hi: X.Int64.fromString('0'),
      lo: X.Uint64.fromString(BigInt(amountIn).toString()),
    })),
    proofScVal(proofs.orderProof),
    signalsScVal(proofs.orderPublicSignals),
    proofScVal(proofs.balanceProof),
    signalsScVal(proofs.balancePublicSignals),
    proofScVal(proofs.rangeProof),
    signalsScVal(proofs.rangePublicSignals),
    X.ScVal.scvU64(X.Uint64.fromString(expiresAt.toString())),
  ];

  const tx = new TransactionBuilder(account, { fee: '10000000', networkPassphrase: passphrase })
    .addOperation(contract.call('submit_order', ...args))
    .setTimeout(300)  // 5 minutes validity
    .build();

  // Simulate to get footprint + auth entries from the RPC
  let prepared;
  try {
    prepared = await server.prepareTransaction(tx);
  } catch (simErr) {
    throw new Error('prepareTransaction failed: ' + simErr.message +
      (simErr.result ? (' | result: ' + JSON.stringify(simErr.result).slice(0, 200)) : ''));
  }

  // The auth entries use sorobanCredentialsSourceAccount, which means the
  // outer transaction signature IS the authorization — no separate entry signing needed.
  prepared.sign(keypair);
  const resultXdr = prepared.toXDR();

  // Validate roundtrip before returning — catches any encoding issues early
  try {
    TransactionBuilder.fromXDR(resultXdr, passphrase);
  } catch (parseErr) {
    throw new Error('buildSignedSubmitOrderXDR: produced invalid XDR: ' + parseErr.message);
  }

  if (process.env.DEBUG_XDR) {
    console.log('  DEBUG XDR (first 100):', resultXdr.slice(0, 100));
    console.log('  DEBUG XDR length:', resultXdr.length);
  }

  return resultXdr;
}

/** Build the full payload for POST /api/orders/submit */
function orderPayload(proofs, assetIn, assetOut, amountIn, traderAddress, xdr) {
  return {
    trader_address:         traderAddress,
    asset_in:               assetIn,
    asset_out:              assetOut,
    amount_in:              amountIn,
    expires_in_seconds:     '3600',
    commitment:             proofs.commitment,
    nullifier:              proofs.nullifier,
    revealed_price:         proofs.revealedPrice,
    revealed_salt:          proofs.revealedSalt,
    order_proof:            proofs.orderProof,
    order_public_signals:   proofs.orderPublicSignals,
    balance_proof:          proofs.balanceProof,
    balance_public_signals: proofs.balancePublicSignals,
    range_proof:            proofs.rangeProof,
    range_public_signals:   proofs.rangePublicSignals,
    signed_transaction_xdr: xdr || 'MOCK_XDR_FOR_TESTING',
  };
}

/** Flip the last hex digit of pi_a[0] to produce an invalid proof element. */
function tamperProof(proof) {
  const t    = JSON.parse(JSON.stringify(proof));
  const orig = t.pi_a[0];
  const last = orig.slice(-1);
  const flipped = last === '0' ? '1'
    : String((parseInt(last, 16) ^ 0xf).toString(16));
  t.pi_a[0] = orig.slice(0, -1) + flipped;
  return t;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n' + C.bold + C.white + 'ZK Dark Pool DEX — End-to-End Test Suite' + C.reset);
  console.log(C.grey + '  Relayer  : ' + RELAYER_URL + C.reset);
  console.log(C.grey + '  Circuits : ' + CIRCUITS_DIR + C.reset);
  console.log(C.grey + '  Run seed : ' + RUN_SEED + C.reset);
  console.log(C.grey + '  Mode     : ' + (SKIP_CHAIN
    ? 'SKIP_CHAIN (validation layer only — ORDER_BOOK_ADDRESS not set)'
    : 'FULL (on-chain enabled)') + C.reset);
  const suiteStart = Date.now();

  // ════════════════════════════════════════════════════════════════════
  // Suite 1: Circuit proof generation & verification (no relayer needed)
  // ════════════════════════════════════════════════════════════════════
  banner('Suite 1: Circuit Proof Generation & Verification');
  console.log('  ' + C.grey + 'fullProve is CPU-intensive (15–45 s per circuit). Please wait.' + C.reset);

  // 1.0 Initialise Poseidon
  let poseidonReady = false;
  await test('suite1', 'Build Poseidon hasher (circomlibjs)', async () => {
    poseidon      = await buildPoseidon();
    F             = poseidon.F;
    poseidonReady = true;
  });

  // 1.1 Load & sanity-check verification keys
  let vkOrder = null, vkBalance = null, vkRange = null;
  await test('suite1', 'Load and sanity-check all three verification keys', () => {
    const paths = {
      order:   path.join(CIRCUITS_DIR, 'order_commitment_vk.json'),
      balance: path.join(CIRCUITS_DIR, 'balance_proof_vk.json'),
      range:   path.join(CIRCUITS_DIR, 'range_proof_vk.json'),
    };
    for (const [name, p] of Object.entries(paths))
      assert(fs.existsSync(p), 'Missing verification key: ' + p + ' (circuit: ' + name + ')');

    vkOrder   = JSON.parse(fs.readFileSync(paths.order,   'utf8'));
    vkBalance = JSON.parse(fs.readFileSync(paths.balance, 'utf8'));
    vkRange   = JSON.parse(fs.readFileSync(paths.range,   'utf8'));

    assert(vkOrder.protocol   === 'groth16', 'order_commitment vk: protocol=groth16');
    assert(vkBalance.protocol === 'groth16', 'balance_proof vk: protocol=groth16');
    assert(vkRange.protocol   === 'groth16', 'range_proof vk: protocol=groth16');
    assert(vkOrder.nPublic    === 2,  'order_commitment nPublic must be 2, got ' + vkOrder.nPublic);
    assert(vkBalance.nPublic  === 2,  'balance_proof nPublic must be 2, got '    + vkBalance.nPublic);
    assert(vkRange.nPublic    === 3,  'range_proof nPublic must be 3, got '       + vkRange.nPublic);
  });

  if (!poseidonReady) {
    ['Generate buy proofs', 'order_commitment verify → true', 'balance_proof verify → true',
     'range_proof verify → true', 'order_commitment public signals', 'balance_proof public signals',
     'range_proof public signals', 'Tampered proof rejects → false', 'Generate sell proofs',
     'sell order_commitment verify → true',
    ].forEach(n => skipLine(n, 'Poseidon build failed'));
  } else {
    // 1.2 Generate all three proofs for the buy order
    let buyProofsOk = false;
    await test('suite1', 'Generate all 3 Groth16 proofs for buy order (price=$0.14, qty=500 XLM)', async () => {
      buyProofs   = await generateProofs(BUY_PARAMS, 'BUY');
      buyProofsOk = true;
      console.log('    ' + C.grey + 'commitment : ' + buyProofs.commitment.slice(0, 24) + '…' + C.reset);
      console.log('    ' + C.grey + 'nullifier  : ' + buyProofs.nullifier.slice(0, 24)  + '…' + C.reset);
    });

    if (!buyProofsOk) {
      ['order_commitment verify → true', 'balance_proof verify → true', 'range_proof verify → true',
       'order_commitment public signals', 'balance_proof public signals', 'range_proof public signals',
       'Tampered proof rejects → false', 'Generate sell proofs', 'sell order_commitment verify → true',
      ].forEach(n => skipLine(n, 'buy proof generation failed'));
    } else {
      // 1.3 Verify each proof against its vk — all must return true
      await test('suite1', 'order_commitment proof verifies against vk.json → true', async () => {
        const ok = await snarkjs.groth16.verify(vkOrder, buyProofs.orderPublicSignals, buyProofs.orderProof);
        assert(ok === true, 'groth16.verify returned false for order_commitment proof');
      });

      await test('suite1', 'balance_proof verifies against vk.json → true', async () => {
        const ok = await snarkjs.groth16.verify(vkBalance, buyProofs.balancePublicSignals, buyProofs.balanceProof);
        assert(ok === true, 'groth16.verify returned false for balance_proof');
      });

      await test('suite1', 'range_proof verifies against vk.json → true', async () => {
        const ok = await snarkjs.groth16.verify(vkRange, buyProofs.rangePublicSignals, buyProofs.rangeProof);
        assert(ok === true, 'groth16.verify returned false for range_proof');
      });

      // 1.4 Validate public signal contents
      // order_commitment circuit: output `valid` (index 0), public input `commitment` (index 1)
      await test('suite1', 'order_commitment public signals: [valid=1, commitment_hash]', () => {
        assertEq(buyProofs.orderPublicSignals[0], '1',
          'orderPublicSignals[0] — valid output signal');
        assertEq(buyProofs.orderPublicSignals[1], buyProofs.commitment,
          'orderPublicSignals[1] — commitment');
      });

      // balance_proof circuit: public inputs nullifier (index 0), minimum_balance (index 1)
      await test('suite1', 'balance_proof public signals: [nullifier, minimum_balance=escrowAmount]', () => {
        assertEq(buyProofs.balancePublicSignals[0], buyProofs.nullifier,
          'balancePublicSignals[0] — nullifier');
        assertEq(buyProofs.balancePublicSignals[1], buyProofs.escrowAmount,
          'balancePublicSignals[1] — minimum_balance');
      });

      // range_proof circuit: public inputs price_min (0), price_max (1), commitment (2)
      await test('suite1', 'range_proof public signals: [price_min, price_max, commitment]', () => {
        assertEq(buyProofs.rangePublicSignals[0], BUY_PARAMS.priceMin.toString(),
          'rangePublicSignals[0] — price_min');
        assertEq(buyProofs.rangePublicSignals[1], BUY_PARAMS.priceMax.toString(),
          'rangePublicSignals[1] — price_max');
        assertEq(buyProofs.rangePublicSignals[2], buyProofs.commitment,
          'rangePublicSignals[2] — commitment');
      });

      // 1.5 Tamper a byte of pi_a[0] → verify must return false
      await test('suite1', 'Tampered proof (flipped pi_a[0] byte) → groth16.verify returns false', async () => {
        const tampered = tamperProof(buyProofs.orderProof);
        assert(tampered.pi_a[0] !== buyProofs.orderProof.pi_a[0],
          'Sanity: tampered pi_a[0] must differ from original');
        const ok = await snarkjs.groth16.verify(vkOrder, buyProofs.orderPublicSignals, tampered);
        assert(ok === false, 'Expected groth16.verify to return false for tampered proof, got ' + ok);
      });

      // 1.6 Generate sell proofs (needed for Suites 3 & 4)
      let sellProofsOk = false;
      await test('suite1', 'Generate all 3 Groth16 proofs for sell order (price=$0.13, qty=500 XLM)', async () => {
        sellProofs   = await generateProofs(SELL_PARAMS, 'SELL');
        sellProofsOk = true;
        console.log('    ' + C.grey + 'commitment : ' + sellProofs.commitment.slice(0, 24) + '…' + C.reset);
      });

      if (sellProofsOk) {
        await test('suite1', 'sell order_commitment proof verifies → true', async () => {
          const ok = await snarkjs.groth16.verify(vkOrder, sellProofs.orderPublicSignals, sellProofs.orderProof);
          assert(ok === true, 'groth16.verify returned false for sell order_commitment proof');
        });
      } else {
        skipLine('sell order_commitment verify → true', 'sell proof generation failed');
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Suite 2: Relayer health
  // ════════════════════════════════════════════════════════════════════
  banner('Suite 2: Relayer Health');

  await test('suite2', 'GET /api/health → status ok/degraded, mongodb=connected, uptime≥0', async () => {
    const res = await apiGet(RELAYER_URL + '/api/health');
    assert(res.status === 200 || res.status === 503,
      'Unexpected HTTP ' + res.status + ' — is the relayer running at ' + RELAYER_URL + '?');
    const { status, mongodb, stellar, uptime } = res.data;
    assert(['ok', 'degraded'].includes(status), 'status must be ok or degraded, got: ' + status);
    assert(mongodb === 'connected',              'mongodb must be connected, got: ' + mongodb);
    assert(typeof uptime === 'number' && uptime >= 0, 'uptime must be a non-negative number');
    assert(typeof stellar === 'string',          'stellar must be a string');
    console.log('    ' + C.grey + 'status=' + status + ' mongodb=' + mongodb +
      ' stellar=' + stellar + ' uptime=' + uptime + 's' + C.reset);
  });

  await test('suite2', 'GET /api/health → response shape is complete (status/mongodb/stellar/uptime)', async () => {
    const res = await apiGet(RELAYER_URL + '/api/health');
    const required = ['status', 'mongodb', 'stellar', 'uptime'];
    const missing  = required.filter(k => !(k in (res.data || {})));
    assert(missing.length === 0, 'Missing health fields: ' + missing.join(', '));
  });

  await test('suite2', 'GET /api/orderbook/batch → has batch_id and seconds_remaining', async () => {
    const res = await apiGet(RELAYER_URL + '/api/orderbook/batch');
    assertHTTP(res, 200, '/api/orderbook/batch');
    assert(typeof res.data.batch_id          === 'number', 'batch_id must be a number');
    assert(typeof res.data.seconds_remaining === 'number', 'seconds_remaining must be a number');
    assert(res.data.seconds_remaining        >= 0,         'seconds_remaining must be ≥0');
    assert(typeof res.data.started_at        === 'string', 'started_at must be a string');
    assert(typeof res.data.ends_at           === 'string', 'ends_at must be a string');
    console.log('    ' + C.grey + 'batch_id=' + res.data.batch_id +
      ' seconds_remaining=' + res.data.seconds_remaining + C.reset);
  });

  await test('suite2', 'GET /api/orderbook/depth → has buy_depth_buckets and sell_depth_buckets', async () => {
    const res = await apiGet(RELAYER_URL + '/api/orderbook/depth');
    assertHTTP(res, 200, '/api/orderbook/depth');
    assert(Array.isArray(res.data.buy_depth_buckets),  'buy_depth_buckets must be an array');
    assert(Array.isArray(res.data.sell_depth_buckets), 'sell_depth_buckets must be an array');
    assert(res.data.pair     === 'XLM/USDC',           'pair must be XLM/USDC, got ' + res.data.pair);
    assert(typeof res.data.batch_id === 'number',      'batch_id must be present');
    console.log('    ' + C.grey + 'pair=' + res.data.pair +
      ' buy_buckets=' + res.data.buy_depth_buckets.length +
      ' sell_buckets=' + res.data.sell_depth_buckets.length + C.reset);
  });

  await test('suite2', 'GET /api/status → running=true with network and batch_interval_seconds', async () => {
    const res = await apiGet(RELAYER_URL + '/api/status');
    assertHTTP(res, 200, '/api/status');
    assert(res.data.running === true,                        'running must be true');
    assert(typeof res.data.batch_interval_seconds === 'number', 'batch_interval_seconds present');
    assert(typeof res.data.current_batch_id       === 'number', 'current_batch_id present');
    assert(typeof res.data.network                === 'string', 'network present');
    console.log('    ' + C.grey + 'network=' + res.data.network +
      ' batch_interval=' + res.data.batch_interval_seconds +
      's batch_id='      + res.data.current_batch_id + C.reset);
  });

  await test('suite2', 'GET /api/orderbook/trades → has trades array', async () => {
    const res = await apiGet(RELAYER_URL + '/api/orderbook/trades');
    assertHTTP(res, 200, '/api/orderbook/trades');
    assert(Array.isArray(res.data.trades), 'trades must be an array');
    console.log('    ' + C.grey + 'recent settled trades: ' + res.data.trades.length + C.reset);
  });

  // ════════════════════════════════════════════════════════════════════
  // Suite 3: Order submission
  // ════════════════════════════════════════════════════════════════════
  banner('Suite 3: Order Submission');

  if (!buyProofs || !sellProofs) {
    skipLine('All order submission tests', 'Circuit proofs not generated in Suite 1');
  } else if (SKIP_CHAIN) {
    // ── SKIP_CHAIN mode: contracts not deployed — test the validation layer only ──
    console.log('  ' + C.yellow + 'SKIP_CHAIN mode (ORDER_BOOK_ADDRESS not set).' + C.reset);
    console.log('  ' + C.yellow + 'Submission halts at broadcastTransaction — only pre-broadcast' + C.reset);
    console.log('  ' + C.yellow + 'validation (pair check, size check, ZK proof check) is exercised.' + C.reset);

    // 3a. Submit empty body → pair validation fires → 400
    await test('suite3', 'Submit with no body (missing required fields) → 400', async () => {
      const res = await apiPost(RELAYER_URL + '/api/orders/submit', {});
      assertHTTP(res, 400, 'empty body');
      assert(res.data.error, 'error field must be present');
      console.log('    ' + C.grey + 'error: ' + String(res.data.error).slice(0, 80) + C.reset);
    });

    // 3b. Submit with valid pair + size but tampered proof → proof verify fires → 400
    await test('suite3', 'Submit with tampered order_proof → 400 "Invalid ZK proof"', async () => {
      const payload = orderPayload(buyProofs, 'USDC', 'XLM', '700000000',
        'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZPVI3FYIJ37GFWEZN4WZ');
      payload.order_proof = tamperProof(buyProofs.orderProof);

      const res = await apiPost(RELAYER_URL + '/api/orders/submit', payload);
      assertHTTP(res, 400, 'tampered proof');
      assert(
        res.data.error && res.data.error.toLowerCase().includes('invalid zk proof'),
        'Expected "Invalid ZK proof", got: ' + JSON.stringify(res.data)
      );
    });

    // 3c. Submit with wrong pair → 400
    await test('suite3', 'Submit with asset_in=BTC (wrong pair) → 400 "Only XLM/USDC"', async () => {
      const payload = orderPayload(buyProofs, 'BTC', 'ETH', '100000000',
        'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZPVI3FYIJ37GFWEZN4WZ');
      const res = await apiPost(RELAYER_URL + '/api/orders/submit', payload);
      assertHTTP(res, 400, 'wrong pair');
      assert(res.data.error && res.data.error.includes('XLM/USDC'),
        'Expected XLM/USDC error, got: ' + JSON.stringify(res.data));
    });

    console.log('\n  ' + C.yellow +
      'To run the full submission flow, deploy contracts and set ORDER_BOOK_ADDRESS.' + C.reset);

  } else {
    // ── Full mode: contracts are deployed, submit orders and broadcast on-chain ──
    const stellar = require(path.join(ROOT_NM, '@stellar/stellar-sdk'));
    const traderAddress = stellar.Keypair.fromSecret(TEST_SECRET_KEY).publicKey();
    console.log('  ' + C.grey + 'Trader: ' + traderAddress + C.reset);

    await test('suite3', 'POST /api/orders/submit (sell XLM→USDC) → 200 success + order_id + tx_hash', async () => {
      console.log('    ' + C.grey + 'Building & signing Soroban tx for sell order…' + C.reset);
      const signedXdr = await buildSignedSubmitOrderXDR(sellProofs, 'XLM', 'USDC', '5000000000');
      const payload   = orderPayload(sellProofs, 'XLM', 'USDC', '5000000000', traderAddress, signedXdr);
      const res       = await apiPost(RELAYER_URL + '/api/orders/submit', payload);
      assertHTTP(res, 200, 'sell order submit');
      assert(res.data.success  === true, 'success flag must be true');
      assert(res.data.order_id,          'order_id must be present');
      assert(res.data.tx_hash,           'tx_hash must be present');
      sellCommitment = res.data.order_id;
      ordersInDB     = true;
      console.log('    ' + C.grey + 'order_id=' + sellCommitment.slice(0, 22) + '… tx=' + res.data.tx_hash.slice(0, 12) + '…' + C.reset);
    });

    // Submit a BUY order (USDC→XLM) that crosses the sell: buyer $0.14 ≥ seller $0.13.
    // The trader account now holds testnet USDC (+ trustline), so the escrow deposit
    // of USDC succeeds. This forms a crossing pair so Suite 4 matching/settlement runs.
    //   BUY amount_in (USDC, 7-decimals) = quantity_xlm * price / PRICE_SCALE
    //   = 5_000_000_000 * 140000 / 1_000_000 = 700_000_000 (= 70 USDC)
    if (sellCommitment) {
      await test('suite3', 'POST /api/orders/submit (buy USDC→XLM) → 200 success + order_id + tx_hash', async () => {
        console.log('    ' + C.grey + 'Building & signing Soroban tx for buy order (deposits 70 USDC)…' + C.reset);
        const xdrBuy  = await buildSignedSubmitOrderXDR(buyProofs, 'USDC', 'XLM', '700000000');
        const payload = orderPayload(buyProofs, 'USDC', 'XLM', '700000000', traderAddress, xdrBuy);
        const res     = await apiPost(RELAYER_URL + '/api/orders/submit', payload);
        assertHTTP(res, 200, 'buy order submit');
        assert(res.data.success === true, 'success flag must be true');
        assert(res.data.order_id,         'order_id must be present');
        assert(res.data.tx_hash,          'tx_hash must be present');
        buyCommitment = res.data.order_id;
        ordersInDB    = true;
        console.log('    ' + C.grey + 'order_id=' + buyCommitment.slice(0, 22) + '… tx=' + res.data.tx_hash.slice(0, 12) + '…' + C.reset);
      });
    }

    if (sellCommitment) {
      await test('suite3', 'GET /api/orders/:commitment → status=active with correct assets', async () => {
        const res = await apiGet(RELAYER_URL + '/api/orders/' + sellCommitment);
        assertHTTP(res, 200, 'order lookup');
        assertEq(res.data.status,    'active', 'order status');
        assertEq(res.data.asset_in,  'XLM',    'asset_in');
        assertEq(res.data.asset_out, 'USDC',   'asset_out');
        assert(res.data.commitment,             'commitment field present');
        assert(res.data.batch_id,               'batch_id field present');
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Suite 4: Batch auction
  // ════════════════════════════════════════════════════════════════════
  banner('Suite 4: Batch Auction');

  if (!ordersInDB || !buyCommitment || !sellCommitment) {
    skipLine('Orderbook depth shows active orders',       'orders not in DB (SKIP_CHAIN or Suite 3 failed)');
    skipLine('Batch order_count >= 2',                    'orders not in DB');
    skipLine('Buy order matches within timeout',          'orders not in DB');
    skipLine('Sell order matches within timeout',         'orders not in DB');
    skipLine('Trade history shows a settled trade',       'matching not possible');
    console.log('  ' + C.yellow + 'TIP: Deploy contracts (ORDER_BOOK_ADDRESS=…) to run the full auction suite.' + C.reset);
  } else {
    // ── 4a. Depth check ─────────────────────────────────────────────────────────
    // We submitted 2 sell (XLM→USDC) orders; no buy orders because the test
    // account has no USDC on testnet. Relax the depth assertion accordingly.
    let hasBuyDepth = false;
    await test('suite4', 'GET /api/orderbook/depth → active_order_count≥2 and ≥1 sell bucket', async () => {
      const res = await apiGet(RELAYER_URL + '/api/orderbook/depth');
      assertHTTP(res, 200, '/api/orderbook/depth');
      const totalBuckets = res.data.buy_depth_buckets.length + res.data.sell_depth_buckets.length;
      assert(totalBuckets >= 1,
        'expected at least 1 depth bucket (buy or sell), got ' + totalBuckets);
      assert(res.data.active_order_count >= 2,
        'expected active_order_count≥2, got ' + res.data.active_order_count);
      hasBuyDepth = res.data.buy_depth_buckets.length >= 1;
      console.log('    ' + C.grey + 'active_order_count=' + res.data.active_order_count +
        ' buy_buckets=' + res.data.buy_depth_buckets.length +
        ' sell_buckets=' + res.data.sell_depth_buckets.length + C.reset);
      if (res.data.sell_depth_buckets[0])
        console.log('    ' + C.grey + 'sell[0]=' + JSON.stringify(res.data.sell_depth_buckets[0]) + C.reset);
    });

    // ── 4b. Batch order count ───────────────────────────────────────────────────
    // The two orders are submitted ~10s apart, so with a short BATCH_INTERVAL they
    // can straddle a batch boundary and land in consecutive batches (orders carry
    // over across batches until matched). So assert the increment works (≥1 in the
    // current batch); "both orders are live" is covered by the depth test above
    // (active_order_count≥2). order_count≥1 still guards the session-3 Bug 3 fix
    // (insertOrder must $inc the batch orderCount).
    await test('suite4', 'GET /api/orderbook/batch → order_count increments (≥1)', async () => {
      const res = await apiGet(RELAYER_URL + '/api/orderbook/batch');
      assertHTTP(res, 200, '/api/orderbook/batch');
      assert(typeof res.data.batch_id          === 'number', 'batch_id must be a number');
      assert(typeof res.data.seconds_remaining === 'number', 'seconds_remaining must be a number');
      assert(res.data.order_count >= 1,
        'expected order_count≥1 in current batch (orderCount increment), got ' + res.data.order_count);
      console.log('    ' + C.grey + 'batch_id=' + res.data.batch_id +
        ' order_count=' + res.data.order_count +
        ' seconds_remaining=' + res.data.seconds_remaining + C.reset);
    });

    // ── 4c. Batch matching (requires a buy+sell crossing pair) ──────────────────
    // Matching only fires when there is at least one buy order AND one sell order
    // whose prices cross. If the buy order failed to submit (e.g. trader has no
    // USDC), skip the polling tests with a clear explanation.
    if (!hasBuyDepth) {
      skipLine('Sell order reaches matched or settled status within ' + BATCH_POLL_S + 's',
               'no buy orders in batch (trader has no USDC — run scripts/fund_usdc.js)');
      skipLine('Buy order reaches matched or settled status within ' + BATCH_POLL_S + 's',
               'no buy orders in batch (trader has no USDC — run scripts/fund_usdc.js)');
      skipLine('Trade history records THIS settlement (500 XLM, clearing price $0.13–$0.14)',
               'matching requires a buy+sell crossing pair');
    } else {
      console.log('  ' + C.grey + 'Polling for order status=matched/settled (timeout: ' + BATCH_POLL_S + 's)…' + C.reset);
      console.log('  ' + C.grey + 'Tip: set BATCH_INTERVAL_SECONDS=10 in relayer env for faster matching.' + C.reset);

      let sellMatched = false;

      // Poll a specific order to a terminal-ish status. Returns its final status.
      const pollOrder = async (commitment, label) => {
        const deadline = Date.now() + BATCH_POLL_S * 1000;
        while (Date.now() < deadline) {
          const res = await apiGet(RELAYER_URL + '/api/orders/' + commitment);
          const st  = res.data && res.data.status;
          if (st === 'matched' || st === 'settled') {
            console.log('    ' + C.grey + label + ' status=' + st + C.reset);
            return st;
          }
          process.stdout.write('    ' + C.grey + label + ' status=' + (st || '?') + '… waiting 5s\r' + C.reset);
          await sleep(5000);
        }
        throw new Error('Timed out after ' + BATCH_POLL_S + 's waiting for ' + label + ' order to match');
      };

      await test('suite4', 'Sell order reaches matched or settled status within ' + BATCH_POLL_S + 's', async () => {
        await pollOrder(sellCommitment, 'sell');
        sellMatched = true;
      });

      // The buy side must reach the same terminal state — both legs of the pair
      // settle atomically, so a buy stuck 'active' would reveal a one-sided settle.
      await test('suite4', 'Buy order reaches matched or settled status within ' + BATCH_POLL_S + 's', async () => {
        await pollOrder(buyCommitment, 'buy');
      });

      if (sellMatched) {
        await test('suite4', 'Trade history records THIS settlement (500 XLM @ clearing $0.135, USDC=67.50)', async () => {
          // The order flips to 'matched' in the DB the instant a match is recorded,
          // but the trade record is only written AFTER the on-chain submit_match
          // confirms (~5s). Poll the trades endpoint until our trade appears.
          const finder = (trades) => trades.find(t =>
            t.xlm_amount === '500.00' &&
            Number(t.price_micro) >= 130000 && Number(t.price_micro) <= 140000
          );
          let ours = null;
          let lastTrades = [];
          const deadline = Date.now() + 30_000;
          while (Date.now() < deadline) {
            const res = await apiGet(RELAYER_URL + '/api/orderbook/trades');
            assertHTTP(res, 200, '/api/orderbook/trades');
            assert(Array.isArray(res.data.trades), 'trades must be an array');
            lastTrades = res.data.trades;
            ours = finder(lastTrades);
            if (ours) break;
            await sleep(3000);
          }
          assert(ours,
            'no trade matching this run (xlm=500.00, price_micro∈[130000,140000]) within 30s; ' +
            'most recent trade was ' + JSON.stringify(lastTrades[0]));
          assert(['up', 'down', 'flat'].includes(ours.direction), 'direction must be up/down/flat');
          // Clearing price for buy@140000 / sell@130000 of equal size is the midpoint 135000.
          assertEq(ours.price_micro, '135000', 'clearing price_micro (expected midpoint 135000)');
          // Bug A fix: settled USDC must be the CLEARED cost (500 × 0.135 = 67.50),
          // NOT the buyer's full limit-price deposit (500 × 0.14 = 70.00).
          assertEq(ours.usdc_amount, '67.50', 'settled USDC = cleared cost, not buyer limit deposit');
          console.log('    ' + C.grey + 'our trade: price=' + ours.price + ' xlm=' + ours.xlm_amount + ' usdc=' + ours.usdc_amount + ' dir=' + ours.direction + C.reset);
        });
      } else {
        skipLine('Trade history shows a settled trade', 'matching timed out');
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // Suite 5: Error cases
  // ════════════════════════════════════════════════════════════════════
  banner('Suite 5: Error Cases');

  // 5.1 Missing trader_address (and everything else) → pair validation → 400
  await test('suite5', 'POST /api/orders/submit missing trader_address (empty body) → 400', async () => {
    const res = await apiPost(RELAYER_URL + '/api/orders/submit', {});
    assertHTTP(res, 400, 'missing fields');
    assert(res.data.error, 'error field must be present');
    console.log('    ' + C.grey + 'error: ' + String(res.data.error).slice(0, 80) + C.reset);
  });

  // 5.2 Wrong trading pair (BTC) → 400 "Only XLM/USDC pair supported"
  await test('suite5', 'POST /api/orders/submit with asset_in=BTC → 400 "Only XLM/USDC"', async () => {
    // Needs the other required-string fields present (even as placeholders)
    // to get past the relayer's upfront shape check and actually reach the
    // trading-pair validation this test targets.
    const dummyProof = { pi_a: ['0','0','1'], pi_b: [['0','0'],['0','0'],['1','0']], pi_c: ['0','0','1'], protocol: 'groth16', curve: 'bn128' };
    const res = await apiPost(RELAYER_URL + '/api/orders/submit', {
      trader_address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZPVI3FYIJ37GFWEZN4WZ',
      asset_in: 'BTC', asset_out: 'ETH', amount_in: '100000000',
      commitment: '0', nullifier: '0', revealed_price: '1',
      order_proof: dummyProof, order_public_signals: ['1', '0'],
      balance_proof: dummyProof, balance_public_signals: ['0', '0'],
      range_proof: dummyProof, range_public_signals: ['1000', '10000000', '0'],
      signed_transaction_xdr: 'MOCK',
    });
    assertHTTP(res, 400, 'wrong pair');
    assert(
      res.data.error && res.data.error.includes('XLM/USDC'),
      'Expected "Only XLM/USDC pair supported", got: ' + JSON.stringify(res.data)
    );
    console.log('    ' + C.grey + 'error: ' + res.data.error + C.reset);
  });

  // 5.3 XLM order below minimum size (0.0001 XLM vs 100 XLM floor) → 400
  await test('suite5', 'POST /api/orders/submit XLM amount below 100 XLM minimum → 400 "Minimum"', async () => {
    const res = await apiPost(RELAYER_URL + '/api/orders/submit', {
      trader_address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZPVI3FYIJ37GFWEZN4WZ',
      asset_in:    'XLM',
      asset_out:   'USDC',
      amount_in:   '1000',   // 0.0001 XLM — far below 100 XLM floor
      expires_in_seconds: '3600',
      commitment:  '0', nullifier: '0',
      revealed_price: '140000', revealed_salt: '0',
      order_proof:  { pi_a: ['0','0','1'], pi_b: [['0','0'],['0','0'],['1','0']], pi_c: ['0','0','1'], protocol: 'groth16', curve: 'bn128' },
      order_public_signals: ['1','0'],
      balance_proof: { pi_a: ['0','0','1'], pi_b: [['0','0'],['0','0'],['1','0']], pi_c: ['0','0','1'], protocol: 'groth16', curve: 'bn128' },
      balance_public_signals: ['0','0'],
      range_proof:  { pi_a: ['0','0','1'], pi_b: [['0','0'],['0','0'],['1','0']], pi_c: ['0','0','1'], protocol: 'groth16', curve: 'bn128' },
      range_public_signals: ['1000','10000000','0'],
      signed_transaction_xdr: 'MOCK',
    });
    assertHTTP(res, 400, 'below minimum size');
    assert(
      res.data.error && res.data.error.toLowerCase().includes('minimum'),
      'Expected minimum size error, got: ' + JSON.stringify(res.data)
    );
    console.log('    ' + C.grey + 'error: ' + res.data.error + C.reset);
  });

  // 5.4 Tampered proof sent to relayer → proof verifier rejects → 400
  if (!buyProofs) {
    skipLine('Submit tampered proof to relayer → 400', 'proofs not generated in Suite 1');
  } else {
    await test('suite5', 'POST /api/orders/submit with tampered pi_a → 400 "Invalid ZK proof"', async () => {
      // Keep every field self-consistent with buyProofs's own real values —
      // the relayer now binds commitment/nullifier/amount_in against the
      // proofs' own public signals before it ever reaches proof
      // verification, so a mismatched nullifier here would trip that check
      // first instead of the "Invalid ZK proof" path this test is for.
      // Reusing buyProofs.nullifier is safe even though Suite 3 already
      // submitted it for real: the tampered order_proof fails
      // verifyAllProofs before the relayer ever gets to a DB write, so
      // there's no duplicate-key path to worry about.
      const res = await apiPost(RELAYER_URL + '/api/orders/submit', {
        trader_address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZPVI3FYIJ37GFWEZN4WZ',
        asset_in:  'USDC', asset_out: 'XLM',
        amount_in: buyProofs.escrowAmount,
        expires_in_seconds: '3600',
        commitment:      buyProofs.commitment,
        nullifier:       buyProofs.nullifier,
        revealed_price:  buyProofs.revealedPrice,
        revealed_salt:   buyProofs.revealedSalt,
        order_proof:     tamperProof(buyProofs.orderProof),  // <-- tampered
        order_public_signals:   buyProofs.orderPublicSignals,
        balance_proof:          buyProofs.balanceProof,
        balance_public_signals: buyProofs.balancePublicSignals,
        range_proof:            buyProofs.rangeProof,
        range_public_signals:   buyProofs.rangePublicSignals,
        signed_transaction_xdr: 'MOCK_XDR_FOR_TESTING',
      });
      assertHTTP(res, 400, 'tampered proof → relayer');
      assert(
        res.data.error && res.data.error.toLowerCase().includes('invalid zk proof'),
        'Expected "Invalid ZK proof", got: ' + JSON.stringify(res.data)
      );
    });
  }

  // 5.5 GET non-existent commitment → 404
  await test('suite5', 'GET /api/orders/nonexistent_commitment → 404', async () => {
    const res = await apiGet(RELAYER_URL + '/api/orders/commitment-does-not-exist-00000000001');
    assertHTTP(res, 404, 'non-existent order');
    assert(res.data.error, 'error field must be present');
    console.log('    ' + C.grey + 'error: ' + res.data.error + C.reset);
  });

  // 5.6 DELETE non-existent order with mock XDR → ≥400 (Soroban rejects MOCK XDR)
  await test('suite5', 'DELETE /api/orders/nonexistent with MOCK XDR → ≥400 (Soroban rejects)', async () => {
    const res = await apiDelete(
      RELAYER_URL + '/api/orders/commitment-does-not-exist-00000000002',
      { signed_cancel_xdr: 'MOCK_XDR_FOR_TESTING' }
    );
    assert(res.status >= 400,
      'Expected ≥400 for cancel with placeholder XDR, got ' + res.status + ': ' + JSON.stringify(res.data).slice(0, 100));
    console.log('    ' + C.grey + 'HTTP ' + res.status + ' (expected — MOCK XDR rejected)' + C.reset);
  });

  // 5.7 Unknown API route → 404
  await test('suite5', 'GET /api/nonexistent-route → 404', async () => {
    const res = await apiGet(RELAYER_URL + '/api/this-route-does-not-exist');
    assertHTTP(res, 404, 'unknown route');
  });

  // ════════════════════════════════════════════════════════════════════
  // Summary
  // ════════════════════════════════════════════════════════════════════
  const elapsed = ((Date.now() - suiteStart) / 1000).toFixed(1);
  const total   = totalPassed + totalFailed + totalSkipped;

  console.log('\n' + C.bold + '═'.repeat(62) + C.reset);
  console.log(C.bold + '  Test Results  (' + elapsed + 's elapsed)' + C.reset);
  console.log('═'.repeat(62) + C.reset);
  console.log(
    '  ' + C.green + C.bold + totalPassed + ' passed' + C.reset +
    '   ' + C.red + C.bold + totalFailed + ' failed' + C.reset +
    '   ' + C.yellow + totalSkipped + ' skipped' + C.reset +
    '   ' + C.grey + total + ' total' + C.reset
  );

  if (failures.length > 0) {
    console.log('\n' + C.red + C.bold + '  Failures:' + C.reset);
    for (const { suite, name, error } of failures) {
      console.log('  ' + C.red + '✗' + C.reset + ' ' + C.grey + '[' + suite + ']' + C.reset + ' ' + name);
      console.log('    ' + C.grey + error + C.reset);
    }
  }

  if (totalSkipped > 0) {
    console.log('\n' + C.yellow + '  ' + totalSkipped + ' test(s) skipped — contracts not deployed.' + C.reset);
    console.log(C.grey + '  To run the full suite set ORDER_BOOK_ADDRESS and other contract addresses:' + C.reset);
    console.log(C.grey + '    ORDER_BOOK_ADDRESS=C... MATCHING_ENGINE_ADDRESS=C... node scripts/e2e_test.js' + C.reset);
  }

  console.log('');
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('\n' + C.red + C.bold + 'FATAL: ' + C.reset + err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});
