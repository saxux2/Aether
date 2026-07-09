#![no_std]
// submit_match's argument count mirrors the match-proof public-signal schema
// (two commitments, two amounts, proof, signals) — bundling into a struct
// would change the on-chain ABI the relayer already invokes against.
#![allow(clippy::too_many_arguments)]

mod types;
pub use types::{DataKey, Groth16Proof};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

// Cross-contract clients — all must be compiled before this crate.
mod zk_verifier {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/zk_verifier.wasm");
}

mod order_book {
    // order_book.wasm now defines its own Groth16Proof — no re-export needed.
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/order_book.wasm");
}

mod escrow_vault {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/escrow_vault.wasm");
}

mod settlement {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/settlement.wasm");
}

// TTL bookkeeping — see escrow_vault/src/lib.rs's constants for the full
// rationale (same values, same ~5s ledger close time assumption).
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const INSTANCE_EXTEND_TO: u32 = DAY_IN_LEDGERS * 60;

#[contract]
pub struct MatchingEngine;

#[contractimpl]
impl MatchingEngine {
    pub fn initialize(
        env: Env,
        admin: Address,
        order_book: Address,
        escrow_vault: Address,
        settlement: Address,
        zk_verifier: Address,
        relayer_1: Address,
        relayer_2: Address,
        relayer_3: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::OrderBook, &order_book);
        env.storage()
            .instance()
            .set(&DataKey::EscrowVault, &escrow_vault);
        env.storage()
            .instance()
            .set(&DataKey::Settlement, &settlement);
        env.storage()
            .instance()
            .set(&DataKey::ZkVerifier, &zk_verifier);
        env.storage().instance().set(&DataKey::Relayer1, &relayer_1);
        env.storage().instance().set(&DataKey::Relayer2, &relayer_2);
        env.storage().instance().set(&DataKey::Relayer3, &relayer_3);
        env.storage().instance().set(&DataKey::MatchCount, &0u64);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    /// Validate and settle a matched order pair — trustlessly.
    ///
    /// Instead of trusting the relayer's revealed prices, the relayer supplies a
    /// Groth16 `match_proof`. The MatchProof circuit proves, in zero knowledge, that
    /// both commitments open to real orders, the clearing price lies within both
    /// limit prices, the fill is within both committed quantities, and
    /// `usdc_amount = floor(xlm_amount * clearing_price / 1e6)`.
    ///
    /// Public signals (verified against the on-chain MatchVk):
    ///   [buyer_commitment, seller_commitment, clearing_price, xlm_amount, usdc_amount]
    /// This contract binds those signals to the orders it settles, so a valid proof
    /// cannot be replayed against different orders or amounts.
    ///
    /// v1: requires relayer_1 auth (chooses WHICH crossing pairs to match).
    /// v2: upgrade to 2-of-3 threshold multisig.
    pub fn submit_match(
        env: Env,
        buyer_commitment: BytesN<32>,
        seller_commitment: BytesN<32>,
        xlm_amount: i128,
        usdc_amount: i128,
        match_proof: Groth16Proof,
        match_public_signals: Vec<BytesN<32>>,
    ) {
        let relayer_1: Address = env.storage().instance().get(&DataKey::Relayer1).unwrap();
        relayer_1.require_auth();

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic!("matching paused");
        }

        // A pair can never legitimately match itself. This is currently also
        // prevented as a side effect of EscrowVault rejecting a second
        // lock_for_settlement() call on an already-Matched deposit, but that
        // guard lives two contracts away — assert it explicitly here too so
        // this contract's own correctness doesn't depend on that side effect.
        if buyer_commitment == seller_commitment {
            panic!("buyer and seller commitment must differ");
        }

        // 1. Verify the match proof on-chain via the ZKVerifier (real BN254 Groth16).
        let zk_addr: Address = env.storage().instance().get(&DataKey::ZkVerifier).unwrap();
        let zk = zk_verifier::Client::new(&env, &zk_addr);
        let vk_proof = zk_verifier::Groth16Proof {
            pi_a: match_proof.pi_a.clone(),
            pi_b: match_proof.pi_b.clone(),
            pi_c: match_proof.pi_c.clone(),
        };
        if !zk.verify_match_proof(&vk_proof, &match_public_signals) {
            panic!("invalid match proof");
        }

        // 2. Bind the proof's public signals to exactly what we are settling.
        //    Layout: [buyer_commitment, seller_commitment, clearing_price, xlm, usdc]
        if match_public_signals.get(0) != Some(buyer_commitment.clone()) {
            panic!("buyer commitment not proven");
        }
        if match_public_signals.get(1) != Some(seller_commitment.clone()) {
            panic!("seller commitment not proven");
        }
        if match_public_signals.get(3) != Some(Self::amount_to_b32(&env, xlm_amount)) {
            panic!("xlm amount not proven");
        }
        if match_public_signals.get(4) != Some(Self::amount_to_b32(&env, usdc_amount)) {
            panic!("usdc amount not proven");
        }
        // The circuit already proved seller_price <= clearing_price <= buyer_price,
        // so no separate cross check is needed.

        // 4. Fetch orders from OrderBook and verify both are Active
        let ob_addr: Address = env.storage().instance().get(&DataKey::OrderBook).unwrap();
        let ob = order_book::Client::new(&env, &ob_addr);

        let buyer_order = ob
            .get_order(&buyer_commitment)
            .unwrap_or_else(|| panic!("buyer order not found"));
        let seller_order = ob
            .get_order(&seller_commitment)
            .unwrap_or_else(|| panic!("seller order not found"));

        // 5. Mark both orders as matched in OrderBook
        ob.mark_matched(&buyer_commitment);
        ob.mark_matched(&seller_commitment);

        // 6. Lock both escrow deposits for settlement
        let escrow_addr: Address = env.storage().instance().get(&DataKey::EscrowVault).unwrap();
        let escrow = escrow_vault::Client::new(&env, &escrow_addr);
        escrow.lock_for_settlement(&buyer_order.nullifier);
        escrow.lock_for_settlement(&seller_order.nullifier);

        // 7. Execute atomic swap
        let settlement_addr: Address = env.storage().instance().get(&DataKey::Settlement).unwrap();
        let settlement_contract = settlement::Client::new(&env, &settlement_addr);
        settlement_contract.settle(
            &buyer_order.nullifier,
            &seller_order.nullifier,
            &buyer_order.trader,
            &seller_order.trader,
            &xlm_amount,
            &usdc_amount,
        );

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::MatchCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::MatchCount, &(count + 1));
    }

    /// Encode a non-negative i128 amount as a 32-byte big-endian value, matching
    /// how snarkjs serializes a field element as a public signal. Used to bind the
    /// settled amounts to the proof's public signals.
    fn amount_to_b32(env: &Env, amount: i128) -> BytesN<32> {
        if amount < 0 {
            panic!("amount must be non-negative");
        }
        let mut out = [0u8; 32];
        // i128 is 16 bytes; place big-endian in the low 16 bytes (indices 16..32).
        out[16..32].copy_from_slice(&amount.to_be_bytes());
        BytesN::from_array(env, &out)
    }

    pub fn get_match_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::MatchCount)
            .unwrap_or(0)
    }

    /// Admin-only emergency switch. Pausing blocks new match submissions only.
    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        let stored_admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("not admin");
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &paused);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, Vec};

    fn setup_env() -> (Env, Address, Address, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(MatchingEngine, ());

        let admin = Address::generate(&env);
        let relayer_1 = Address::generate(&env);
        let relayer_2 = Address::generate(&env);
        let relayer_3 = Address::generate(&env);
        // Placeholders — none of the tests below reach a cross-contract call
        // into these (they all panic at the pause/self-match/admin guard,
        // before submit_match ever touches OrderBook/EscrowVault/Settlement/
        // ZKVerifier), so these addresses are never dereferenced as real
        // contracts.
        let order_book = Address::generate(&env);
        let escrow_vault = Address::generate(&env);
        let settlement = Address::generate(&env);
        let zk_verifier = Address::generate(&env);

        let client = MatchingEngineClient::new(&env, &contract_id);
        client.initialize(
            &admin,
            &order_book,
            &escrow_vault,
            &settlement,
            &zk_verifier,
            &relayer_1,
            &relayer_2,
            &relayer_3,
        );

        (
            env,
            contract_id,
            admin,
            relayer_1,
            relayer_2,
            relayer_3,
            order_book,
        )
    }

    fn dummy_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &[0u8; 64]),
            pi_b: BytesN::from_array(env, &[0u8; 128]),
            pi_c: BytesN::from_array(env, &[0u8; 64]),
        }
    }

    #[test]
    #[should_panic(expected = "not admin")]
    fn test_set_paused_rejects_non_admin() {
        let (env, contract_id, _admin, _r1, _r2, _r3, _ob) = setup_env();
        let client = MatchingEngineClient::new(&env, &contract_id);
        let attacker = Address::generate(&env);
        client.set_paused(&attacker, &true);
    }

    #[test]
    fn test_set_paused_toggles_is_paused() {
        let (env, contract_id, admin, ..) = setup_env();
        let client = MatchingEngineClient::new(&env, &contract_id);
        assert!(!client.is_paused());
        client.set_paused(&admin, &true);
        assert!(client.is_paused());
        client.set_paused(&admin, &false);
        assert!(!client.is_paused());
    }

    #[test]
    #[should_panic(expected = "matching paused")]
    fn test_submit_match_rejected_while_paused() {
        let (env, contract_id, admin, ..) = setup_env();
        let client = MatchingEngineClient::new(&env, &contract_id);
        client.set_paused(&admin, &true);

        let commitment = BytesN::from_array(&env, &[1u8; 32]);
        let signals: Vec<BytesN<32>> = Vec::new(&env);
        client.submit_match(
            &commitment,
            &commitment,
            &0i128,
            &0i128,
            &dummy_proof(&env),
            &signals,
        );
    }

    #[test]
    #[should_panic(expected = "buyer and seller commitment must differ")]
    fn test_submit_match_rejects_self_match() {
        let (env, contract_id, ..) = setup_env();
        let client = MatchingEngineClient::new(&env, &contract_id);

        // Same commitment on both sides — must be rejected before any proof
        // verification or cross-contract call is attempted, regardless of
        // whether the (here, dummy) proof would otherwise be considered.
        let commitment = BytesN::from_array(&env, &[7u8; 32]);
        let signals: Vec<BytesN<32>> = Vec::new(&env);
        client.submit_match(
            &commitment,
            &commitment,
            &100i128,
            &100i128,
            &dummy_proof(&env),
            &signals,
        );
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let (env, contract_id, admin, r1, r2, r3, ob) = setup_env();
        let client = MatchingEngineClient::new(&env, &contract_id);
        let escrow_vault = Address::generate(&env);
        let settlement = Address::generate(&env);
        let zk_verifier = Address::generate(&env);
        client.initialize(
            &admin,
            &ob,
            &escrow_vault,
            &settlement,
            &zk_verifier,
            &r1,
            &r2,
            &r3,
        );
    }
}
