import { xdr, Address, scValToNative } from '@stellar/stellar-sdk';

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
  // js-xdr 5 (@stellar/stellar-sdk 17) decodes a union to a plain object
  // `{ type: '<armName>', <armName>: <value> }` and a struct to a plain object
  // of its fields — the old `envelope.switch().name` / `envelope.v1()` accessor
  // calls throw "is not a function" against it. Read the discriminant off
  // `.type` and the payload off the arm property instead.
  const envelope = xdr.TransactionEnvelope.fromXDR(signedXdr, 'base64') as any;

  const tx =
    envelope.type === 'envelopeTypeTxFeeBump'
      ? envelope.feeBump.tx.innerTx.v1.tx
      : envelope.v1?.tx;
  if (!tx) {
    throw new Error(`unsupported transaction envelope type: ${envelope.type}`);
  }

  const ops = tx.operations;
  if (ops.length !== 1) {
    throw new Error(`expected exactly 1 operation, got ${ops.length}`);
  }

  const body = ops[0].body;
  if (body.type !== 'invokeHostFunction') {
    throw new Error(`expected invokeHostFunction operation, got ${body.type}`);
  }

  const hostFunction = body.invokeHostFunctionOp.hostFunction;
  if (hostFunction.type !== 'hostFunctionTypeInvokeContract') {
    throw new Error(`expected contract invocation, got ${hostFunction.type}`);
  }

  const invoke = hostFunction.invokeContract;
  return {
    contractId: Address.fromScAddress(invoke.contractAddress).toString(),
    functionName: invoke.functionName.toString(),
    args: invoke.args,
  };
}

/** Decode an Address-typed ScVal argument to its G.../C... strkey string. */
export function scValToAddress(v: xdr.ScVal): string {
  return Address.fromScVal(v).toString();
}

/** Decode a BytesN<32>-typed ScVal argument to a hex string. */
export function scValToBytesHex(v: xdr.ScVal): string {
  return Buffer.from(scValToNative(v) as Uint8Array).toString('hex');
}

/**
 * Decode an i128-typed ScVal argument to a bigint.
 *
 * scValToNative already reassembles the hi/lo halves as a signed 128-bit
 * bigint, so it is exact for the full i128 range — not just the non-negative
 * escrow/fill amounts this codebase actually builds. It is also the one ScVal
 * accessor whose shape is stable across js-xdr versions, unlike `v.i128()`.
 */
export function scValToBigInt(v: xdr.ScVal): bigint {
  return scValToNative(v) as bigint;
}

/** Compare a decimal or 0x-prefixed hex field-element string to hex bytes from an ScVal. */
export function fieldElementMatchesBytesHex(fieldElement: string, hexBytes: string): boolean {
  return BigInt(fieldElement) === BigInt(`0x${hexBytes}`);
}

/**
 * Decode a u64-typed ScVal argument to a bigint. Used for submit_order's
 * `expires_at` (a unix timestamp in seconds), which the contract stores
 * verbatim on the DepositRecord — so this is the authoritative expiry, not
 * whatever the JSON body claims.
 */
export function scValToU64(v: xdr.ScVal): bigint {
  return scValToNative(v) as bigint;
}
