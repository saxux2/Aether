/**
 * One-off: give the trader a USDC trustline and fund it from mm1.
 * USDC = Circle testnet USDC (issuer GBBD47IF...), wrapped as SAC CBIELTK6...
 */
const {
  Horizon,
  TransactionBuilder,
  Operation,
  Asset,
  Keypair,
  Networks,
  BASE_FEE,
} = require('@stellar/stellar-sdk');
const { execSync } = require('child_process');

const HORIZON = 'https://horizon-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;

// Read secrets from the stellar keystore by alias so they never touch argv/logs.
function secretFor(alias) {
  return execSync(`stellar keys show ${alias}`, { encoding: 'utf8' }).trim();
}
const TRADER_SECRET = secretFor(process.env.TRADER_ALIAS || 'darkpool-deployer');
const MM1_SECRET = secretFor(process.env.MM1_ALIAS || 'mm1');
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const AMOUNT = process.env.AMOUNT || '500';

async function submit(server, sourceKp, buildOps, label) {
  const account = await server.loadAccount(sourceKp.publicKey());
  const tb = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  });
  buildOps(tb);
  const tx = tb.setTimeout(60).build();
  tx.sign(sourceKp);
  try {
    const res = await server.submitTransaction(tx);
    console.log(`[${label}] OK  hash=${res.hash}`);
  } catch (e) {
    const codes = e?.response?.data?.extras?.result_codes;
    console.log(`[${label}] FAIL`, JSON.stringify(codes) || e.message);
    throw e;
  }
}

(async () => {
  const server = new Horizon.Server(HORIZON);
  const usdc = new Asset('USDC', USDC_ISSUER);
  const trader = Keypair.fromSecret(TRADER_SECRET);
  const mm1 = Keypair.fromSecret(MM1_SECRET);

  console.log('trader:', trader.publicKey());
  console.log('mm1   :', mm1.publicKey());

  // 1. Trustline on trader (idempotent — ok if already exists)
  const tAcct = await server.loadAccount(trader.publicKey());
  const hasTrust = tAcct.balances.some(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
  );
  if (hasTrust) {
    console.log('[trustline] already present, skipping');
  } else {
    await submit(
      server,
      trader,
      (tb) => tb.addOperation(Operation.changeTrust({ asset: usdc })),
      'trustline'
    );
  }

  // 2. Payment mm1 -> trader
  await submit(
    server,
    mm1,
    (tb) =>
      tb.addOperation(
        Operation.payment({
          destination: trader.publicKey(),
          asset: usdc,
          amount: AMOUNT,
        })
      ),
    'payment'
  );

  // Report final balance
  const after = await server.loadAccount(trader.publicKey());
  const bal = after.balances.find(
    (b) => b.asset_code === 'USDC' && b.asset_issuer === USDC_ISSUER
  );
  console.log('trader USDC balance now:', bal?.balance);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
