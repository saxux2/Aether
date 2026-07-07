'use client';

import { useCallback, useState } from 'react';
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
    disconnect: _disconnect,
  } = useWalletStore();

  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<{ hash: string } | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const sendXlm = useCallback(
    async (to: string, amount: string) => {
      if (!address) throw new Error('Wallet not connected');
      setSending(true);
      setTxError(null);
      setTxResult(null);
      try {
        const unsignedXdr = await buildPaymentXdr(address, to, amount);
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
      const secret = await deriveTraderSecret(pubKey);
      setAddress(pubKey);
      setTraderSecret(secret);
      setConnected(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnecting(false);
    }
  }, [setAddress, setConnected, setConnecting, setError, setTraderSecret]);

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
