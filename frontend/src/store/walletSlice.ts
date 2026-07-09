import { create } from 'zustand';

interface WalletState {
  address: string | null;
  connected: boolean;
  connecting: boolean;
  error: string | null;
  traderSecret: bigint | null;
  /**
   * Base64 Freighter signature over the same deterministic message used to
   * derive traderSecret. Sent as a bearer credential on GET /api/orders so
   * the relayer can verify the caller actually controls this address's key
   * before returning that trader's order history (which includes
   * not-yet-matched orders' revealed_price) — without prompting for a
   * second signature, since it's the same signMessage call already made at
   * connect time.
   */
  traderSecretProof: string | null;
  setAddress: (address: string | null) => void;
  setConnected: (connected: boolean) => void;
  setConnecting: (connecting: boolean) => void;
  setError: (error: string | null) => void;
  setTraderSecret: (secret: bigint | null) => void;
  setTraderSecretProof: (proof: string | null) => void;
  disconnect: () => void;
}

export const useWalletStore = create<WalletState>((set) => ({
  address: null,
  connected: false,
  connecting: false,
  error: null,
  traderSecret: null,
  traderSecretProof: null,
  setAddress: (address) => set({ address }),
  setConnected: (connected) => set({ connected }),
  setConnecting: (connecting) => set({ connecting }),
  setError: (error) => set({ error }),
  setTraderSecret: (traderSecret) => set({ traderSecret }),
  setTraderSecretProof: (traderSecretProof) => set({ traderSecretProof }),
  disconnect: () =>
    set({
      address: null,
      connected: false,
      connecting: false,
      error: null,
      traderSecret: null,
      traderSecretProof: null,
    }),
}));
