use soroban_sdk::{contracttype, BytesN};

/// Local Groth16 proof type so matching_engine's own contract spec embeds the
/// type definition (the stellar CLI can't resolve an imported type used in this
/// contract's public interface — same fix order_book uses). Layout matches
/// zk_verifier's Groth16Proof exactly; converted at the call site.
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
    OrderBook,
    EscrowVault,
    Settlement,
    ZkVerifier,
    Relayer1,
    Relayer2,
    Relayer3,
    MatchCount,
}
