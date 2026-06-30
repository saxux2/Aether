use soroban_sdk::{contracttype, Address, BytesN};

#[contracttype]
pub enum DataKey {
    Admin,
    MatchingEngineAddr,
    SettlementAddr,
    /// nullifier -> DepositRecord
    Deposit(BytesN<32>),
}

#[contracttype]
#[derive(Clone, PartialEq)]
pub enum DepositStatus {
    Active,
    Matched,
    Settled,
    Expired,
    Cancelled,
}

#[contracttype]
#[derive(Clone)]
pub struct DepositRecord {
    pub trader: Address,
    pub asset: Address,
    pub amount: i128,
    pub nullifier: BytesN<32>,
    pub commitment: BytesN<32>,
    pub status: DepositStatus,
    pub created_at: u64,
    pub expires_at: u64,
}
