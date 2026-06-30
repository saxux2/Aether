import { create } from 'zustand';

interface WalletState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  traderSecret: bigint | null;
  setAddress: (address: string | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setTraderSecret: (secret: bigint | null) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  connected: false,
  connecting: false,
  error: null,
  traderSecret: null,
  setAddress: (address) => set({ address }),
  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setError: (error) => set({ error }),
  setTraderSecret: (traderSecret) => set({ traderSecret }),
  disconnect: () =>
    set({
      address: null,
      connected: false,
      connecting: false,
      error: null,
      traderSecret: null,
    }),
}));
