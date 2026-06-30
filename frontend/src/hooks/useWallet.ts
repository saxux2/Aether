'use client';

import { useCallback } from 'react';
import { useWalletStore } from '@/store/walletSlice';
import { deriveTraderSecret } from '@/utils/stellar';

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

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const { getAddress, isConnected, requestAccess } = await import('@stellar/freighter-api');
      const connStatus = await isConnected();
      if (!connStatus || !connStatus.isConnected) {
        throw new Error('Freighter not installed');
      }

      // requestAccess triggers the Freighter permission popup and returns the address.
      // getAddress() alone returns empty if access was never granted (Freighter API v4).
      const accessResult = await requestAccess();
      if (accessResult.error) throw new Error(accessResult.error);

      // Prefer the address from requestAccess; fall back to getAddress for already-connected sessions.
      let pubKey = accessResult.address;
      if (!pubKey) {
        const addrResult = await getAddress();
        if (addrResult.error) throw new Error(addrResult.error);
        pubKey = addrResult.address;
      }
      if (!pubKey) throw new Error('No public key returned — unlock Freighter and try again');
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
  }, [_disconnect]);

  return { address, connected, connecting, error, traderSecret, connect, disconnect };
}
