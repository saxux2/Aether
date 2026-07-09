'use client';

import { useCallback, useState } from 'react';
import { StrKey } from '@stellar/stellar-sdk';
import { useWalletStore } from '@/store/walletSlice';
import { deriveTraderSecret } from '@/utils/stellar';
import { connectWallet, signTx } from '@/lib/stellarWallet';
import { buildPaymentXdr, submitSignedTx } from '@/lib/stellarHorizon';

export function useWallet() {
  const {
    address,
    connected,
    connecting,
    error,
    traderSecret,
    setAddress,
    setConnected,
    setConnecting,
    setError,
    setTraderSecret,
    setTraderSecretProof,
    disconnect: _disconnect,
  } = useWalletStore();

  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{ hash: string } | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const sendXlm = useCallback(
    async (to: string, amount: string) => {
      if (!address) throw new Error('Wallet not connected');

      // Validate before building/signing anything — these are real funds and a
      // malformed destination or amount should never reach Freighter or Horizon.
      const destination = to.trim();
      if (!StrKey.isValidEd25519PublicKey(destination)) {
        const err = new Error('Invalid destination address — must be a valid Stellar G... address');
        setTxError(err.message);
        throw err;
      }
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        const err = new Error('Amount must be a positive number');
        setTxError(err.message);
        throw err;
      }
      if (destination === address) {
        const err = new Error('Destination address must be different from your wallet address');
        setTxError(err.message);
        throw err;
      }

      setSending(true);
      setTxError(null);
      setTxResult(null);
      try {
        const unsignedXdr = await buildPaymentXdr(address, destination, amount);
        const signedXdr = await signTx(unsignedXdr);
        const result = await submitSignedTx(signedXdr);
        setTxResult(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Transaction failed';
        setTxError(message);
        throw new Error(message);
      } finally {
        setSending(false);
      }
    },
    [address]
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const pubKey = await connectWallet();
      const { secret, proof } = await deriveTraderSecret(pubKey);
      setAddress(pubKey);
      setTraderSecret(secret);
      setTraderSecretProof(proof);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }, [setAddress, setConnected, setConnecting, setError, setTraderSecret, setTraderSecretProof]);

  const disconnect = useCallback(() => {
    _disconnect();
    setTxResult(null);
    setTxError(null);
  }, [_disconnect]);

  return {
    address,
    connected,
    connecting,
    error,
    traderSecret,
    connect,
    disconnect,
    sending,
    txResult,
    txError,
    sendXlm,
  };
}
