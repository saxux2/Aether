import {
  Account,
  Address,
  Contract,
  Networks,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import {
  decodeInvocation,
  scValToAddress,
  scValToBytesHex,
  scValToBigInt,
  scValToU64,
  fieldElementMatchesBytesHex,
} from './txInspect';

const TRADER = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';
const CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));
const COMMITMENT_HEX = 'ab'.repeat(32);

function buildInvokeTx(fn: string, args: xdr.ScVal[]): string {
  const account = new Account(TRADER, '1');
  const contract = new Contract(CONTRACT_ID);
  const tx = new TransactionBuilder(account, {
    fee: '1000000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call(fn, ...args))
    .setTimeout(300)
    .build();
  return tx.toXDR();
}

describe('decodeInvocation', () => {
  it('extracts contract id, function name, and args from a real invoke-host-function tx', () => {
    const args = [
      new Address(TRADER).toScVal(),
      xdr.ScVal.scvBytes(Buffer.from(COMMITMENT_HEX, 'hex')),
    ];
    const decoded = decodeInvocation(buildInvokeTx('cancel', args));

    expect(decoded.contractId).toBe(CONTRACT_ID);
    expect(decoded.functionName).toBe('cancel');
    expect(scValToAddress(decoded.args[0])).toBe(TRADER);
    expect(scValToBytesHex(decoded.args[1])).toBe(COMMITMENT_HEX);
  });

  it('decodes i128 amount args exactly', () => {
    const amount = 123_456_789_012_345n;
    const i128 = xdr.ScVal.scvI128(
      new xdr.Int128Parts({ hi: xdr.Int64.fromString('0'), lo: xdr.Uint64.fromString(amount.toString()) })
    );
    const decoded = decodeInvocation(buildInvokeTx('submit_order', [i128]));
    expect(scValToBigInt(decoded.args[0])).toBe(amount);
  });

  it('decodes the u64 expires_at arg exactly', () => {
    // Order expiry is read from the signed tx, not the request body, so this
    // decode is what binds the DB's expiresAt to EscrowVault's expires_at.
    const expiresAt = 1_893_456_000n; // year 2030, comfortably past 2^31
    const u64 = xdr.ScVal.scvU64(xdr.Uint64.fromString(expiresAt.toString()));
    const decoded = decodeInvocation(buildInvokeTx('submit_order', [u64]));
    expect(scValToU64(decoded.args[0])).toBe(expiresAt);
  });

  it('throws on a transaction with more than one operation', () => {
    const account = new Account(TRADER, '1');
    const contract = new Contract(CONTRACT_ID);
    const tx = new TransactionBuilder(account, { fee: '1000000', networkPassphrase: Networks.TESTNET })
      .addOperation(contract.call('cancel', new Address(TRADER).toScVal()))
      .addOperation(contract.call('cancel', new Address(TRADER).toScVal()))
      .setTimeout(300)
      .build();
    expect(() => decodeInvocation(tx.toXDR())).toThrow(/exactly 1 operation/);
  });

  it('throws on garbage input rather than silently returning something', () => {
    expect(() => decodeInvocation('not-valid-xdr-at-all')).toThrow();
  });
});

describe('fieldElementMatchesBytesHex', () => {
  it('matches a decimal field element against its own hex byte encoding', () => {
    const decimal = BigInt(`0x${COMMITMENT_HEX}`).toString();
    expect(fieldElementMatchesBytesHex(decimal, COMMITMENT_HEX)).toBe(true);
  });

  it('rejects a mismatched value — the exact griefing/forgery case this guards against', () => {
    const decimal = BigInt(`0x${COMMITMENT_HEX}`).toString();
    const otherHex = 'cd'.repeat(32);
    expect(fieldElementMatchesBytesHex(decimal, otherHex)).toBe(false);
  });
});
