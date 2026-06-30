import { create } from 'zustand';

export interface LocalOrder {
  id: string;
  commitment: string;
  nullifier: string;
  direction: 'buy' | 'sell';
  quantity: bigint;
  price: bigint;
  status: string;
  createdAt: string;
  batchId?: number;
  salt: bigint;
  // settlement details (populated when the relayer reports the order settled)
  settledAt?: string;
  settlementTxHash?: string;
  settlementPrice?: string; // human-readable USDC price, if the relayer provides it
  filledXlm?: string;       // XLM that actually traded (≤ quantity)
  refundedXlm?: string;     // unfilled remainder refunded on-chain (partial fills)
  isPartial?: boolean;      // settled for less than the full quantity
}

interface OrdersState {
  orders: LocalOrder[];
  addOrder: (order: LocalOrder) => void;
  updateOrderStatus: (id: string, status: string) => void;
  updateOrder: (id: string, patch: Partial<LocalOrder>) => void;
  removeOrder: (id: string) => void;
  clearOrders: () => void;
}

export const useOrdersStore = create<OrdersState>((set) => ({
  orders: [],
  addOrder: (order) =>
    set((state) => ({ orders: [order, ...state.orders] })),
  updateOrderStatus: (id, status) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === id ? { ...o, status } : o)),
    })),
  updateOrder: (id, patch) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    })),
  removeOrder: (id) =>
    set((state) => ({ orders: state.orders.filter((o) => o.id !== id) })),
  clearOrders: () => set({ orders: [] }),
}));
