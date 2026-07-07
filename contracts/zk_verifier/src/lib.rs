#![no_std]

mod groth16;
#[cfg(test)]
mod match_vector;
#[cfg(test)]
mod test_vector;
mod types;

pub use types::{DataKey, Groth16Proof, VerificationKey};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

#[contract]
pub struct ZKVerifier;

#[contractimpl]
impl ZKVerifier {
    /// One-time initialization. Sets the admin and all three verification keys.
    /// Panics if called a second time.
    pub fn initialize(
        env: Env,
        admin: Address,
        vk_order: VerificationKey,
        vk_balance: VerificationKey,
        vk_range: VerificationKey,
        vk_match: VerificationKey,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VkOrder, &vk_order);
        env.storage()
            .instance()
            .set(&DataKey::VkBalance, &vk_balance);
        env.storage().instance().set(&DataKey::VkRange, &vk_range);
        env.storage().instance().set(&DataKey::VkMatch, &vk_match);
    }

    /// Verify an OrderCommitment Groth16 proof.
    pub fn verify_order_proof(
        env: Env,
        proof: Groth16Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> bool {
        let vk: VerificationKey = env.storage().instance().get(&DataKey::VkOrder).unwrap();
        groth16::verify_groth16(&env, &proof, &public_signals, &vk)
    }

    /// Verify a BalanceProof Groth16 proof.
    pub fn verify_balance_proof(
        env: Env,
        proof: Groth16Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> bool {
        let vk: VerificationKey = env.storage().instance().get(&DataKey::VkBalance).unwrap();
        groth16::verify_groth16(&env, &proof, &public_signals, &vk)
    }

    /// Verify a RangeProof Groth16 proof.
    pub fn verify_range_proof(
        env: Env,
        proof: Groth16Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> bool {
        let vk: VerificationKey = env.storage().instance().get(&DataKey::VkRange).unwrap();
        groth16::verify_groth16(&env, &proof, &public_signals, &vk)
    }

    /// Verify a MatchProof Groth16 proof. Public signals:
    /// [buyer_commitment, seller_commitment, clearing_price, xlm_amount, usdc_amount].
    pub fn verify_match_proof(
        env: Env,
        proof: Groth16Proof,
        public_signals: Vec<BytesN<32>>,
    ) -> bool {
        let vk: VerificationKey = env.storage().instance().get(&DataKey::VkMatch).unwrap();
        groth16::verify_groth16(&env, &proof, &public_signals, &vk)
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::match_vector as mv;
    use crate::test_vector as tv;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Vec};

    /// Real verification key for the order_commitment circuit (BN254 wire encoding).
    fn order_vk(env: &Env) -> VerificationKey {
        let mut ic: Vec<BytesN<64>> = Vec::new(env);
        for raw in tv::VK_IC.iter() {
            ic.push_back(BytesN::from_array(env, raw));
        }
        VerificationKey {
            alpha: BytesN::from_array(env, &tv::VK_ALPHA),
            beta: BytesN::from_array(env, &tv::VK_BETA),
            gamma: BytesN::from_array(env, &tv::VK_GAMMA),
            delta: BytesN::from_array(env, &tv::VK_DELTA),
            gamma_abc: ic,
        }
    }

    fn real_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &tv::PI_A),
            pi_b: BytesN::from_array(env, &tv::PI_B),
            pi_c: BytesN::from_array(env, &tv::PI_C),
        }
    }

    fn real_signals(env: &Env) -> Vec<BytesN<32>> {
        let mut v: Vec<BytesN<32>> = Vec::new(env);
        for s in tv::SIGNALS.iter() {
            v.push_back(BytesN::from_array(env, s));
        }
        v
    }

    fn vk_from(
        env: &Env,
        alpha: &[u8; 64],
        beta: &[u8; 128],
        gamma: &[u8; 128],
        delta: &[u8; 128],
        ic: &[[u8; 64]],
    ) -> VerificationKey {
        let mut v: Vec<BytesN<64>> = Vec::new(env);
        for raw in ic.iter() {
            v.push_back(BytesN::from_array(env, raw));
        }
        VerificationKey {
            alpha: BytesN::from_array(env, alpha),
            beta: BytesN::from_array(env, beta),
            gamma: BytesN::from_array(env, gamma),
            delta: BytesN::from_array(env, delta),
            gamma_abc: v,
        }
    }

    fn match_vk(env: &Env) -> VerificationKey {
        vk_from(
            env,
            &mv::M_VK_ALPHA,
            &mv::M_VK_BETA,
            &mv::M_VK_GAMMA,
            &mv::M_VK_DELTA,
            &mv::M_VK_IC,
        )
    }

    fn setup(env: &Env) -> ZKVerifierClient<'_> {
        let contract_id = env.register(ZKVerifier, ());
        let client = ZKVerifierClient::new(env, &contract_id);
        let admin = Address::generate(env);
        let vk = order_vk(env);
        // order/balance/range share the order VK here (we only exercise order + match);
        // the match slot gets the real match VK.
        client.initialize(&admin, &vk.clone(), &vk.clone(), &vk, &match_vk(env));
        client
    }

    /// A genuine groth16 proof must verify on-chain via the BN254 host functions.
    #[test]
    fn test_real_proof_verifies() {
        let env = Env::default();
        let client = setup(&env);
        assert!(client.verify_order_proof(&real_proof(&env), &real_signals(&env)));
    }

    /// Tampering with a public signal must make the pairing fail.
    #[test]
    fn test_tampered_signal_rejected() {
        let env = Env::default();
        let client = setup(&env);

        let mut bad = real_signals(&env);
        let mut s1 = tv::SIGNALS[1];
        s1[31] ^= 0x01; // flip a bit of the committed value
        bad.set(1, BytesN::from_array(&env, &s1));

        assert!(!client.verify_order_proof(&real_proof(&env), &bad));
    }

    /// A proof built from valid-but-wrong-role points must fail the pairing.
    /// (Swapping pi_a and pi_c keeps both on-curve, so this exercises the pairing
    /// equation itself rather than an off-curve host rejection.)
    #[test]
    fn test_wrong_proof_rejected() {
        let env = Env::default();
        let client = setup(&env);
        let proof = Groth16Proof {
            pi_a: BytesN::from_array(&env, &tv::PI_C),
            pi_b: BytesN::from_array(&env, &tv::PI_B),
            pi_c: BytesN::from_array(&env, &tv::PI_A),
        };
        assert!(!client.verify_order_proof(&proof, &real_signals(&env)));
    }

    /// Wrong number of public signals relative to the VK is rejected, not panicked.
    #[test]
    fn test_signal_count_mismatch_rejected() {
        let env = Env::default();
        let client = setup(&env);
        let mut short: Vec<BytesN<32>> = Vec::new(&env);
        short.push_back(BytesN::from_array(&env, &tv::SIGNALS[0]));
        assert!(!client.verify_order_proof(&real_proof(&env), &short));
    }

    fn match_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &mv::M_PI_A),
            pi_b: BytesN::from_array(env, &mv::M_PI_B),
            pi_c: BytesN::from_array(env, &mv::M_PI_C),
        }
    }

    fn match_signals(env: &Env) -> Vec<BytesN<32>> {
        let mut v: Vec<BytesN<32>> = Vec::new(env);
        for s in mv::M_SIGNALS.iter() {
            v.push_back(BytesN::from_array(env, s));
        }
        v
    }

    /// A genuine match proof must verify against the match VK.
    #[test]
    fn test_real_match_proof_verifies() {
        let env = Env::default();
        let client = setup(&env);
        assert!(client.verify_match_proof(&match_proof(&env), &match_signals(&env)));
    }

    /// Tampering with the public clearing price must break the match proof
    /// (proves the relayer cannot settle at a price the circuit didn't sanction).
    #[test]
    fn test_match_tampered_price_rejected() {
        let env = Env::default();
        let client = setup(&env);
        let mut bad = match_signals(&env);
        let mut price = mv::M_SIGNALS[2];
        price[31] ^= 0x01;
        bad.set(2, BytesN::from_array(&env, &price));
        assert!(!client.verify_match_proof(&match_proof(&env), &bad));
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let env = Env::default();
        let client = setup(&env);
        let admin = Address::generate(&env);
        let vk = order_vk(&env);
        client.initialize(&admin, &vk.clone(), &vk.clone(), &vk, &match_vk(&env));
    }
}
