#![no_std]

mod types;
pub use types::{DataKey, Groth16Proof, OrderRecord, OrderStatus};

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

// Cross-contract clients — WASMs compiled before this crate in the build order.
// See contracts/scripts/build.sh for the correct compilation sequence.
mod zk_verifier {
    soroban_sdk::contractimport!(
        file = "../target/wasm32v1-none/release/zk_verifier.wasm"
    );
}

mod escrow_vault {
    soroban_sdk::contractimport!(
        file = "../target/wasm32v1-none/release/escrow_vault.wasm"
    );
}

#[contract]
pub struct OrderBook;

#[contractimpl]
impl OrderBook {
    pub fn initialize(
        env: Env,
        admin: Address,
        zk_verifier: Address,
        escrow_vault: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::ZkVerifierAddr, &zk_verifier);
        env.storage()
            .instance()
            .set(&DataKey::EscrowVaultAddr, &escrow_vault);
        env.storage()
            .instance()
            .set(&DataKey::OrderCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::CurrentBatchId, &0u64);
        let empty: Vec<BytesN<32>> = Vec::new(&env);
        env.storage()
            .instance()
            .set(&DataKey::ActiveOrders, &empty);
    }

    /// Submit a sealed order with three ZK proofs.
    /// Verifies all proofs on-chain, then locks funds in EscrowVault.
    /// Returns the commitment hash as the order identifier.
    pub fn submit_order(
        env: Env,
        trader: Address,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
        asset_in: Address,
        asset_out: Address,
        amount_in: i128,
        order_proof: Groth16Proof,
        order_public_signals: Vec<BytesN<32>>,
        balance_proof: Groth16Proof,
        balance_public_signals: Vec<BytesN<32>>,
        range_proof: Groth16Proof,
        range_public_signals: Vec<BytesN<32>>,
        expires_at: u64,
    ) -> BytesN<32> {
        trader.require_auth();

        // Reject replayed nullifiers
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::NullifierUsed(nullifier.clone()))
            .unwrap_or(false)
        {
            panic!("nullifier already used");
        }

        // ── Bind the proofs' public signals to THIS order ────────────────────
        // A proof is only meaningful if its public inputs are the values we are
        // actually recording. Without this, a valid proof generated for some other
        // (commitment, nullifier, price-range) could be replayed against a
        // different order. Public-signal layout (snarkjs: outputs first, then
        // declared public inputs):
        //   order_commitment : [valid, commitment]
        //   balance_proof    : [nullifier, minimum_balance]
        //   range_proof      : [price_min, price_max, price_commitment]
        let to_b32 = |v: u64| -> BytesN<32> {
            let mut a = [0u8; 32];
            a[24..32].copy_from_slice(&v.to_be_bytes());
            BytesN::from_array(&env, &a)
        };
        let one = to_b32(1);

        // order proof: valid == 1 and the committed value is our commitment
        if order_public_signals.get(0) != Some(one.clone()) {
            panic!("order proof not valid");
        }
        if order_public_signals.get(1) != Some(commitment.clone()) {
            panic!("order commitment mismatch");
        }
        // balance proof: the nullifier proven is the one we are consuming
        if balance_public_signals.get(0) != Some(nullifier.clone()) {
            panic!("balance nullifier mismatch");
        }
        // range proof: price bounds must equal the protocol-wide accepted range
        // (PRICE_MIN = $0.001, PRICE_MAX = $10.00, in micro-USDC per XLM)
        if range_public_signals.get(0) != Some(to_b32(1000)) {
            panic!("range price_min mismatch");
        }
        if range_public_signals.get(1) != Some(to_b32(10_000_000)) {
            panic!("range price_max mismatch");
        }

        // Verify all three ZK proofs via ZKVerifier contract
        let zk_verifier_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::ZkVerifierAddr)
            .unwrap();
        let zk = zk_verifier::Client::new(&env, &zk_verifier_addr);

        // Convert local Groth16Proof to zk_verifier's generated type
        let to_vk_proof = |p: &Groth16Proof| zk_verifier::Groth16Proof {
            pi_a: p.pi_a.clone(),
            pi_b: p.pi_b.clone(),
            pi_c: p.pi_c.clone(),
        };

        if !zk.verify_order_proof(&to_vk_proof(&order_proof), &order_public_signals) {
            panic!("invalid order proof");
        }
        if !zk.verify_balance_proof(&to_vk_proof(&balance_proof), &balance_public_signals) {
            panic!("invalid balance proof");
        }
        if !zk.verify_range_proof(&to_vk_proof(&range_proof), &range_public_signals) {
            panic!("invalid range proof");
        }

        // Mark nullifier consumed
        env.storage()
            .persistent()
            .set(&DataKey::NullifierUsed(nullifier.clone()), &true);

        // Lock funds in EscrowVault
        let escrow_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowVaultAddr)
            .unwrap();
        let escrow = escrow_vault::Client::new(&env, &escrow_addr);
        escrow.deposit(
            &trader,
            &asset_in,
            &amount_in,
            &nullifier,
            &commitment,
            &expires_at,
        );

        let batch_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::CurrentBatchId)
            .unwrap_or(0);

        // Record the order — commitment hash only, no price/quantity/direction
        let record = OrderRecord {
            commitment: commitment.clone(),
            nullifier,
            trader,
            asset_in,
            asset_out,
            amount_in,
            status: OrderStatus::Active,
            submitted_at: env.ledger().timestamp(),
            expires_at,
            batch_id,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Order(commitment.clone()), &record);

        // Append to active orders list
        let mut active: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveOrders)
            .unwrap_or_else(|| Vec::new(&env));
        active.push_back(commitment.clone());
        env.storage()
            .instance()
            .set(&DataKey::ActiveOrders, &active);

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::OrderCount, &(count + 1));

        commitment
    }

    /// Called by MatchingEngine once a match is validated.
    pub fn mark_matched(env: Env, commitment: BytesN<32>) {
        let mut record: OrderRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Order(commitment.clone()))
            .unwrap_or_else(|| panic!("order not found"));
        record.status = OrderStatus::Matched;
        env.storage()
            .persistent()
            .set(&DataKey::Order(commitment), &record);
    }

    /// Called by Settlement after funds are released.
    pub fn mark_settled(env: Env, commitment: BytesN<32>) {
        let mut record: OrderRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Order(commitment.clone()))
            .unwrap_or_else(|| panic!("order not found"));
        record.status = OrderStatus::Settled;
        env.storage()
            .persistent()
            .set(&DataKey::Order(commitment), &record);
    }

    pub fn get_order(env: Env, commitment: BytesN<32>) -> Option<OrderRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Order(commitment))
    }

    pub fn get_active_commitments(env: Env) -> Vec<BytesN<32>> {
        env.storage()
            .instance()
            .get(&DataKey::ActiveOrders)
            .unwrap_or_else(|| Vec::new(&env))
    }

    pub fn is_nullifier_used(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::NullifierUsed(nullifier))
            .unwrap_or(false)
    }

    pub fn current_batch_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::CurrentBatchId)
            .unwrap_or(0)
    }

    pub fn get_order_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::OrderCount)
            .unwrap_or(0)
    }
}
