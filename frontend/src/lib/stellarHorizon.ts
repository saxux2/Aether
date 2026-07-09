/**
 * Horizon reads/writes: balance lookup, payment-tx building, submission.
 * Network (testnet vs. mainnet) is driven by NEXT_PUBLIC_STELLAR_NETWORK.
 */
import { Horizon, TransactionBuilder, Operation, Asset } from '@stellar/stellar-sdk';
import { HORIZON_URL, STELLAR_NETWORK_PASSPHRASE } from '@/lib/stellarWallet';

interface HorizonBalanceEntry {
  asset_type?: string;
  balance?: string;
}

export interface XlmBalanceResult {
  balance: string;
  funded: boolean;
}

/** Fetches the native XLM balance for an address. Unfunded accounts return funded:false. */
export async function fetchXlmBalance(address: string): Promise<XlmBalanceResult> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return { balance: '0', funded: false };
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);

  const data = await res.json();
  const entries: HorizonBalanceEntry[] = Array.isArray(data?.balances) ? data.balances : [];
  const native = entries.find((b) => b.asset_type === 'native');
  return { balance: native?.balance ?? '0', funded: true };
}

/** Builds an unsigned native-XLM payment transaction XDR. */
export async function buildPaymentXdr(from: string, to: string, amount: string): Promise<string> {
  const server = new Horizon.Server(HORIZON_URL);
  const account = await server.loadAccount(from);
  const baseFee = await server.fetchBaseFee();

  const tx = new TransactionBuilder(account, {
    fee: baseFee.toString(),
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination: to,
        asset: Asset.native(),
        amount,
      })
    )
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

/** Submits a Freighter-signed payment XDR to Horizon. */
export async function submitSignedTx(signedXdr: string): Promise<{ hash: string }> {
  const server = new Horizon.Server(HORIZON_URL);
  const tx = TransactionBuilder.fromXDR(signedXdr, STELLAR_NETWORK_PASSPHRASE);
  const result = await server.submitTransaction(tx);
  return { hash: result.hash };
}
