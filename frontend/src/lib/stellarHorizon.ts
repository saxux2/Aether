/**
 * Horizon reads/writes: balance lookup, payment-tx building, submission.
 * Network (testnet vs. mainnet) is driven by NEXT_PUBLIC_STELLAR_NETWORK.
 */
import { Horizon, TransactionBuilder, Operation, Asset } from '@stellar/stellar-sdk';
import { HORIZON_URL, STELLAR_NETWORK_PASSPHRASE } from '@/lib/stellarWallet';
import { decimalToBaseUnits } from '@/utils/units';

interface HorizonBalanceEntry {
  asset_type?: string;
  balance?: string;
  selling_liabilities?: string;
}

/** The subset of Horizon's /accounts/{id} payload the reserve maths needs. */
export interface HorizonAccount {
  balances?: HorizonBalanceEntry[];
  subentry_count?: number;
  num_sponsoring?: number;
  num_sponsored?: number;
}

/** 0.5 XLM, in stroops — Stellar's base reserve per required entry. */
export const BASE_RESERVE_STROOPS = 5_000_000n;

/**
 * The XLM an account can actually part with, in stroops.
 *
 * A Stellar account cannot spend down to zero. It must retain
 * (2 + subentries + sponsoring - sponsored) x 0.5 XLM, and anything already
 * committed as a selling liability on the DEX is spoken for too. Horizon
 * reports only the gross `balance`, so the reserve has to be derived here.
 *
 * Escrowing the gross balance always fails: EscrowVault.deposit's token
 * transfer reverts for want of the reserve, after the trader has already sat
 * through ~30s of proof generation and signed in Freighter.
 */
export function spendableXlmStroops(account: HorizonAccount): bigint {
  const native = (account.balances ?? []).find((b) => b.asset_type === 'native');
  if (!native?.balance) return 0n;

  const subentries = BigInt(account.subentry_count ?? 0);
  const sponsoring = BigInt(account.num_sponsoring ?? 0);
  const sponsored = BigInt(account.num_sponsored ?? 0);
  const requiredEntries = 2n + subentries + sponsoring - sponsored;
  const reserve = (requiredEntries > 0n ? requiredEntries : 0n) * BASE_RESERVE_STROOPS;

  const gross = decimalToBaseUnits(native.balance);
  const selling = native.selling_liabilities
    ? decimalToBaseUnits(native.selling_liabilities)
    : 0n;

  const spendable = gross - reserve - selling;
  return spendable > 0n ? spendable : 0n;
}

/**
 * Reserve-adjusted native balance for `address`, in stroops. Unfunded
 * accounts (Horizon 404) have nothing to spend.
 */
export async function fetchSpendableXlm(address: string): Promise<bigint> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return 0n;
  if (!res.ok) throw new Error(`Horizon error: ${res.status}`);
  return spendableXlmStroops((await res.json()) as HorizonAccount);
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
