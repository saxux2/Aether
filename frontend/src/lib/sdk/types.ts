export interface OrderInputs {
  price: bigint;        // micro-USDC per XLM  (140000 = $0.14)
  quantity: bigint;     // XLM in stroops      (10_000_000 stroops = 1 XLM)
  direction: bigint;    // 0n = buy, 1n = sell
  salt: bigint;         // random 32-byte value as bigint
  secret: bigint;       // trader's private secret, derived from wallet signing
  nonce: bigint;        // per-order nonce (e.g. Date.now())
  balance: bigint;      // trader's current wallet balance of asset_in, in its base unit
  /**
   * The real amount being escrowed for this order (what OrderBook.submit_order
   * will pass as `amount_in`) — USDC base units for a buy order, XLM stroops
   * for a sell order. This is NOT always equal to `quantity`: `quantity` is
   * always the XLM-denominated order size (used for the order commitment and
   * matching), but a buy order escrows USDC, not XLM. balance_proof's public
   * `minimum_balance` is set to this value so order_book can check it against
   * the real on-chain `amount_in` — using `quantity` here instead would make
   * every honest buy order fail that check (see prover.ts).
   */
  escrowAmount: bigint;
}

/** Raw snarkjs Groth16 proof — as returned by groth16.fullProve() */
export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface GeneratedProofs {
  commitment: string;
  nullifier: string;
  /** Original order commitment salt: Poseidon(price, quantity, direction, salt). */
  salt: string;
  orderProof: Groth16Proof;
  orderPublicSignals: string[];
  balanceProof: Groth16Proof;
  balancePublicSignals: string[];
  rangeProof: Groth16Proof;
  rangePublicSignals: string[];
}

export interface OrderSubmitRequest {
  trader_address: string;
  asset_in: 'XLM' | 'USDC';
  asset_out: 'XLM' | 'USDC';
  amount_in: string;
  expires_in_seconds: number;
  commitment: string;
  nullifier: string;
  revealed_price: string;
  order_proof: Groth16Proof;
  order_public_signals: string[];
  balance_proof: Groth16Proof;
  balance_public_signals: string[];
  range_proof: Groth16Proof;
  range_public_signals: string[];
  signed_transaction_xdr: string;
}

export interface OrderStatusResponse {
  commitment: string;
  status: 'active' | 'matched' | 'settled' | 'expired' | 'cancelled';
  batch_id: number;
  asset_in: string;
  asset_out: string;
  submitted_at: string;
  expires_at: string;
  matched_at?: string;
  settled_at?: string;
}

export interface BatchInfo {
  batch_id: number;
  started_at: string;
  ends_at: string;
  seconds_remaining: number;
  order_count: number;
}

export interface DepthBucket {
  price_range: string;
  total_xlm: string;
}

export interface OrderBookDepth {
  pair: string;
  batch_id: number;
  next_batch_at: string;
  buy_depth_buckets: DepthBucket[];
  sell_depth_buckets: DepthBucket[];
  active_order_count: number;
}

export interface TradeRecord {
  settlement_price: string;
  xlm_amount: string;
  usdc_amount: string;
  settled_at: string;
  batch_id: number;
}
