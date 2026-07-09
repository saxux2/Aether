import { xdr, Address } from '@stellar/stellar-sdk';

export interface DecodedInvocation {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
}

/**
 * Decode a signed Soroban transaction XDR and extract the single
 * invoke-host-function call it makes.
 *
 * Deliberately uses the low-level xdr.TransactionEnvelope.fromXDR path
 * rather than the high-level Transaction/TransactionBuilder.fromXDR — the
 * latter fails to parse some Soroban transactions (see
 * SorobanService.broadcastTransaction for the same workaround elsewhere in
 * this codebase).
 *
 * Used to verify a client-provided signed transaction actually invokes the
 * contract/function/args the relayer is about to trust and persist to the
 * database, instead of taking the request body's claims on faith. Without
 * this, an attacker could submit ANY successfully-broadcastable transaction
 * (signed with their own unrelated key) alongside a claimed commitment/
 * trader/amount in the JSON body, and the relayer would record it as if it
 * were a real order or a real cancellation of someone else's order.
 */
export function decodeInvocation(signedXdr: string): DecodedInvocation {
  const envelope = xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64');

  const tx =
    envelope.switch().name === 'envelopeTypeTxFeeBump'
      ? envelope.feeBump().tx().innerTx().v1().tx()
      : envelope.v1().tx();

  const ops = tx.operations();
  if (ops.length !== 1) {
    throw new Error(`expected exactly 1 operation, got ${ops.length}`);
  }

  const body = ops[0].body();
  if (body.switch().name !== 'invokeHostFunction') {
    throw new Error(`expected invokeHostFunction operation, got ${body.switch().name}`);
  }

  const hostFunction = body.invokeHostFunctionOp().hostFunction();
  if (hostFunction.switch().name !== 'hostFunctionTypeInvokeContract') {
    throw new Error(`expected contract invocation, got ${hostFunction.switch().name}`);
  }

  const invoke = hostFunction.invokeContract();
  return {
    contractId: Address.fromScAddress(invoke.contractAddress()).toString(),
    functionName: invoke.functionName().toString(),
    args: invoke.args(),
  };
}

/** Decode an Address-typed ScVal argument to its G.../C... strkey string. */
export function scValToAddress(v: xdr.ScVal): string {
  return Address.fromScVal(v).toString();
}

/** Decode a BytesN<32>-typed ScVal argument to a hex string. */
export function scValToBytesHex(v: xdr.ScVal): string {
  return v.bytes().toString('hex');
}

/**
 * Decode an i128-typed ScVal argument to a bigint. Every i128 this codebase
 * builds (see soroban.ts / relayer soroban.ts) is a non-negative escrow/fill
 * amount encoded with hi=0, so plain (hi << 64) + lo is exact for our range.
 */
export function scValToBigInt(v: xdr.ScVal): bigint {
  const parts = v.i128();
  const hi = BigInt(parts.hi().toString());
  const lo = BigInt(parts.lo().toString());
  return (hi << 64n) + lo;
}

/** Compare a decimal or 0x-prefixed hex field-element string to hex bytes from an ScVal. */
export function fieldElementMatchesBytesHex(fieldElement: string, hexBytes: string): boolean {
  return BigInt(fieldElement) === BigInt(`0x${hexBytes}`);
}
