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
}
