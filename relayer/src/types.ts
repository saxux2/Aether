export type AssetSymbol = 'XLM' | 'USDC';
export type OrderStatus = 'active' | 'matched' | 'settled' | 'expired' | 'cancelled';
export type BatchStatus = 'open' | 'closed';
export type MatchStatus = 'pending' | 'settled' | 'failed';

export interface Groth16Proof {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
}

export interface ActiveOrder {
  commitment: string;
  nullifier: string;
  traderAddress: string;
  assetIn: AssetSymbol;
  assetOut: AssetSymbol;
  amountIn: bigint;
  revealedPrice: bigint;
  /** FULL original XLM quantity of the order (commitment preimage value). */
  xlmQuantity: bigint;
  /** Cumulative XLM already filled in previous batches. */
  filledQuantity: bigint;
  /** xlmQuantity - filledQuantity — what is still up for matching. */
  remainingQuantity: bigint;
  revealedSalt: string;
  /** Submission time — used for time priority among equal prices. */
  submittedAt: Date;
}

export interface MatchResult {
  buyerCommitment: string;
  buyerPrice: bigint;
  /**
   * FULL original order quantity (NOT the filled amount). The on-chain
   * MatchingEngine.submit_match re-derives the order commitment from
   * (price, quantity, salt), so this must be the commitment preimage value.
   * The actually-settled amounts are xlmAmount / usdcAmount below.
   */
  buyerQuantity: bigint;
  buyerSalt: string;
  sellerCommitment: string;
  sellerPrice: bigint;
  /** FULL original order quantity — see buyerQuantity. */
  sellerQuantity: bigint;
  sellerSalt: string;
  /** Filled XLM amount for THIS match (stroops) — what actually settles. */
  xlmAmount: bigint;
  /** Filled USDC amount for THIS match (stroops) — what actually settles. */
  usdcAmount: bigint;
  /** Uniform batch clearing price (micro-USDC per XLM). */
  settlementPrice: bigint;
}
