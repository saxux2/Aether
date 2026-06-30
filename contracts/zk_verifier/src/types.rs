use soroban_sdk::{contracttype, BytesN, Vec};

#[contracttype]
pub enum DataKey {
    Admin,
    VkOrder,
    VkBalance,
    VkRange,
    VkMatch,
}

/// Groth16 proof points on BN254.
/// pi_a, pi_c: G1 points (64 bytes each — uncompressed x,y)
/// pi_b:       G2 point  (128 bytes — uncompressed x0,x1,y0,y1)
#[contracttype]
#[derive(Clone)]
pub struct Groth16Proof {
    pub pi_a: BytesN<64>,
    pub pi_b: BytesN<128>,
    pub pi_c: BytesN<64>,
}

/// Groth16 verification key.
/// gamma_abc has length n+1 where n is the number of public inputs.
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: BytesN<64>,
    pub beta: BytesN<128>,
    pub gamma: BytesN<128>,
    pub delta: BytesN<128>,
    pub gamma_abc: Vec<BytesN<64>>,
}
