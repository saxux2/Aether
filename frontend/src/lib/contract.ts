import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { server, networkPassphrase } from './stellar-sdk';

export const CONTRACT_ID: string =
  process.env.NEXT_PUBLIC_ORDER_BOOK_ADDRESS ?? '';

/**
 * Invoke a Soroban contract function.
 *
 * For read-only (simulation-only) calls pass signerSecret = undefined.
 * For state-changing calls pass the caller's secret key.
 */
export async function callContractFunction(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
  signerSecret?: string,
): Promise<StellarSdk.xdr.ScVal | null> {
  const keypair = signerSecret
    ? StellarSdk.Keypair.fromSecret(signerSecret)
    : StellarSdk.Keypair.random();

  const account = await server.getAccount(keypair.publicKey());

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: '100000',
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.invokeContractFunction({
        contract: contractId,
        function: method,
        args,
      }),
    )
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  if (!signerSecret) {
    return (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse)
      .result?.retval ?? null;
  }

  const assembled = SorobanRpc.assembleTransaction(
    tx,
    simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse,
  ).build();

  assembled.sign(keypair);

  const sendResult = await server.sendTransaction(assembled);

  if (sendResult.status === 'ERROR') {
    throw new Error(`Transaction failed: ${sendResult.errorResult}`);
  }

  let getResult: SorobanRpc.Api.GetTransactionResponse;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await server.getTransaction(sendResult.hash);
  } while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

  if (getResult.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`Transaction failed with status: ${getResult.status}`);
  }

  return (getResult as SorobanRpc.Api.GetSuccessfulTransactionResponse)
    .returnValue ?? null;
}

/**
 * Read the current batch ID from the OrderBook contract (read-only call).
 * Demonstrates contract.ts wired to a real on-chain function.
 */
export async function readCurrentBatch(): Promise<number | null> {
  try {
    const result = await callContractFunction(
      CONTRACT_ID,
      'get_current_batch',
      [],
    );
    if (!result) return null;
    return Number(StellarSdk.scValToNative(result));
  } catch {
    return null;
  }
}
