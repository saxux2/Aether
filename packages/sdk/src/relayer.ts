import axios from 'axios';
import type {
  OrderSubmitRequest,
  OrderStatusResponse,
  BatchInfo,
  OrderBookDepth,
  TradeRecord,
} from './types';

export function createRelayerClient(baseUrl: string) {
  const http = axios.create({ baseURL: baseUrl });

  return {
    submitOrder: async (payload: OrderSubmitRequest) => {
      const { data } = await http.post('/api/orders/submit', payload);
      return data as { success: boolean; order_id: string; batch_id: number; estimated_match_at: string };
    },

    getOrder: async (commitment: string): Promise<OrderStatusResponse> => {
      const { data } = await http.get(`/api/orders/${commitment}`);
      return data;
    },

    cancelOrder: async (commitment: string, signedCancelXdr: string) => {
      const { data } = await http.delete(`/api/orders/${commitment}`, {
        data: { signed_cancel_xdr: signedCancelXdr },
      });
      return data as { success: boolean; tx_hash: string };
    },

    getBatch: async (): Promise<BatchInfo> => {
      const { data } = await http.get('/api/orderbook/batch');
      return data;
    },

    getDepth: async (): Promise<OrderBookDepth> => {
      const { data } = await http.get('/api/orderbook/depth');
      return data;
    },

    getRecentTrades: async (): Promise<{ trades: TradeRecord[] }> => {
      const { data } = await http.get('/api/orderbook/trades');
      return data;
    },

    getHealth: async () => {
      const { data } = await http.get('/api/health');
      return data as { status: string; mongodb: string; stellar: string };
    },
  };
}
