use soroban_sdk::{contracttype, Address, BytesN};

/// Groth16 proof — must be defined here (not just imported from zk_verifier)
/// so the Stellar CLI can resolve the type schema for submit_order.
#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub pi_a: BytesN<64>,
    pub pi_b: BytesN<128>,
    pub pi_c: BytesN<64>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    ZkVerifierAddr,
    EscrowVaultAddr,
    Paused,
    /// commitment -> OrderRecord
    Order(BytesN<32>),
    /// nullifier -> bool
    NullifierUsed(BytesN<32>),
    ActiveOrders,
    OrderCount,
    CurrentBatchId,
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum OrderStatus {
    Active,
    Matched,
    Settled,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct OrderRecord {
    pub commitment: BytesN<32>,
    pub nullifier: BytesN<32>,
    pub trader: Address,
    pub asset_in: Address,
    pub asset_out: Address,
    /// Amount of asset_in locked in escrow — public, needed for settlement sizing
    pub amount_in: i128,
    pub status: OrderStatus,
    pub submitted_at: u64,
    pub expires_at: u64,
    pub batch_id: u64,
}
