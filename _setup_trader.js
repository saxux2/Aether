const { Keypair, Horizon, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } = require('@stellar/stellar-sdk');
const h = new Horizon.Server('https://horizon-testnet.stellar.org');
const GA = 'GA3SSO6D4YL5W6NDCO5V72BN5PHXC3SOBRAFMDSMUOM7OTXY2S6UAUHF';
(async () => {
  // 1. discover the USDC asset (code + issuer) the user already holds
  const ga = await h.loadAccount(GA);
  const usdcBal = ga.balances.find(b => b.asset_code === 'USDC');
  const USDC = new Asset(usdcBal.asset_code, usdcBal.asset_issuer);
  console.log('USDC asset:', USDC.code, USDC.issuer);

  // 2. new trader keypair
  const kp = Keypair.random();
  console.log('\n==== NEW TRADER ACCOUNT ====');
  console.log('PUBLIC:', kp.publicKey());
  console.log('SECRET:', kp.secret());

  // 3. fund via friendbot
  const fb = await fetch(`https://friendbot.stellar.org/?addr=${kp.publicKey()}`);
  console.log('\nfriendbot:', fb.ok ? 'funded' : 'failed('+fb.status+')');
  await new Promise(r => setTimeout(r, 3000));

  // 4. add USDC trustline
  const acct = await h.loadAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60).build();
  tx.sign(kp);
  const res = await h.submitTransaction(tx);
  console.log('USDC trustline added:', res.successful, 'tx', res.hash.slice(0,12)+'…');

  // 5. final balances
  const fin = await h.loadAccount(kp.publicKey());
  console.log('\nbalances:', fin.balances.map(b => (b.asset_code||'XLM')+'='+b.balance).join(', '));
  console.log('\n>>> Send USDC to this PUBLIC address from GA3SSO6D (it now trusts USDC).');
})().catch(e => console.error('ERROR:', e?.response?.data?.extras?.result_codes || e.message));
