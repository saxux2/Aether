import * as StellarSdk from '@stellar/stellar-sdk';
import { rpc as SorobanRpc } from '@stellar/stellar-sdk';
import { server, networkPassphrase } from './stellar-sdk';

export const CONTRACT_ID: string =
  process.env.NEXT_PUBLIC_ORDER_BOOK_ADDRESS ?? '';

/**
 * Simulate a read-only Soroban contract call (no signing, no state change).
 *
 * This is intentionally read-only: it never accepts or handles a secret key.
 * Any state-changing call must be built as an XDR transaction and signed via
 * the Freighter browser extension (see utils/stellar.ts / lib/stellarWallet.ts)
 * — raw secret keys must never be entered into or handled by this frontend.
 */
export async function callContractFunction(
  contractId: string,
  method: string,
  args: StellarSdk.xdr.ScVal[],
): Promise<StellarSdk.xdr.ScVal | null> {
  const keypair = StellarSdk.Keypair.random();

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

  return (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse)
    .result?.retval ?? null;
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
