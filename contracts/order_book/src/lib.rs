#![no_std]
// submit_order's argument count is dictated by the sealed-order + ZK proof
// schema (commitment/nullifier/proofs/public signals per contract type), not
// a refactorable design smell — bundling into a struct would change the
// on-chain ABI that the relayer and frontend SDK already invoke against.
#![allow(clippy::too_many_arguments)]

mod types;
pub use types::{DataKey, Groth16Proof, OrderRecord, OrderStatus};

#[cfg(test)]
mod test_vector;

use soroban_sdk::{contract, contractimpl, Address, BytesN, Env, Vec};

// Cross-contract clients — WASMs compiled before this crate in the build order.
// See contracts/scripts/build.sh for the correct compilation sequence.
mod zk_verifier {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/zk_verifier.wasm");
}

mod escrow_vault {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/escrow_vault.wasm");
}

// TTL bookkeeping — see escrow_vault/src/lib.rs's constants for the full
// rationale (same values, same ~5s ledger close time assumption).
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const INSTANCE_EXTEND_TO: u32 = DAY_IN_LEDGERS * 60;
const PERSISTENT_EXTEND_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const PERSISTENT_EXTEND_TO: u32 = DAY_IN_LEDGERS * 60;

#[contract]
pub struct OrderBook;

#[contractimpl]
impl OrderBook {
    pub fn initialize(env: Env, admin: Address, zk_verifier: Address, escrow_vault: Address) {
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
        env.storage().instance().set(&DataKey::OrderCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::CurrentBatchId, &0u64);
        let empty: Vec<BytesN<32>> = Vec::new(&env);
        env.storage().instance().set(&DataKey::ActiveOrders, &empty);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);
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

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            panic!("order submission paused");
        }

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
        //   range_proof      : [price_min, price_max, commitment]
        let to_b32 = |v: u64| -> BytesN<32> {
            let mut a = [0u8; 32];
            a[24..32].copy_from_slice(&v.to_be_bytes());
            BytesN::from_array(&env, &a)
        };
        // amount_in is an i128 escrow amount (always non-negative in practice —
        // deposit() would reject a negative transfer) encoded the same way
        // snarkjs serializes a field element, matching matching_engine's
        // amount_to_b32 convention: big-endian in the low 16 bytes.
        let amount_to_b32 = |v: i128| -> BytesN<32> {
            if v < 0 {
                panic!("amount_in must be non-negative");
            }
            let mut a = [0u8; 32];
            a[16..32].copy_from_slice(&v.to_be_bytes());
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
        // balance proof: the nullifier proven is the one we are consuming, AND
        // the balance floor the prover committed to (minimum_balance) must equal
        // the real amount being escrowed for this order. Without this check a
        // prover could submit a balance proof for a trivial minimum_balance
        // (e.g. 1) alongside an arbitrarily large real amount_in — the
        // sufficiency check would be internally consistent but decoupled from
        // reality. escrow_vault's real token transfer at deposit() below is
        // still what actually enforces the trader has the funds; this check
        // just makes sure the ZK proof is honestly describing that transfer.
        if balance_public_signals.get(0) != Some(nullifier.clone()) {
            panic!("balance nullifier mismatch");
        }
        if balance_public_signals.get(1) != Some(amount_to_b32(amount_in)) {
            panic!("balance minimum_balance does not match amount_in");
        }
        // range proof: price bounds must equal the protocol-wide accepted range
        // (PRICE_MIN = $0.001, PRICE_MAX = $10.00, in micro-USDC per XLM), AND
        // the commitment the range proof opened must be THIS order's commitment
        // — otherwise a trader could submit a real order at an out-of-band price
        // while attaching a valid range proof for an unrelated, in-band dummy
        // price (the two proofs would be individually sound but mutually
        // meaningless). See circuits/range_proof.circom for the circuit side.
        if range_public_signals.get(0) != Some(to_b32(1000)) {
            panic!("range price_min mismatch");
        }
        if range_public_signals.get(1) != Some(to_b32(10_000_000)) {
            panic!("range price_max mismatch");
        }
        if range_public_signals.get(2) != Some(commitment.clone()) {
            panic!("range proof commitment mismatch");
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
        let nullifier_key = DataKey::NullifierUsed(nullifier.clone());
        env.storage().persistent().set(&nullifier_key, &true);
        env.storage().persistent().extend_ttl(
            &nullifier_key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

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
        let order_key = DataKey::Order(commitment.clone());
        env.storage().persistent().set(&order_key, &record);
        env.storage().persistent().extend_ttl(
            &order_key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

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
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Order(commitment.clone());
        let mut record: OrderRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("order not found"));
        if record.status != OrderStatus::Active {
            panic!("order not active");
        }
        record.status = OrderStatus::Matched;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
        Self::remove_active(&env, &commitment);
    }

    /// Called by Settlement after funds are released.
    pub fn mark_settled(env: Env, commitment: BytesN<32>) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Order(commitment);
        let mut record: OrderRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("order not found"));
        if record.status != OrderStatus::Matched {
            panic!("order not matched");
        }
        record.status = OrderStatus::Settled;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
    }

    /// Trader cancels their own not-yet-matched order and reclaims escrowed
    /// funds. Routes through OrderBook (rather than the trader calling
    /// EscrowVault directly) so this contract's own status/ActiveOrders
    /// bookkeeping never desyncs from the vault's.
    pub fn cancel(env: Env, trader: Address, commitment: BytesN<32>) {
        trader.require_auth();

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Order(commitment.clone());
        let mut record: OrderRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("order not found"));

        if record.trader != trader {
            panic!("not your order");
        }
        if record.status != OrderStatus::Active {
            panic!("cannot cancel — not active");
        }

        let escrow_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowVaultAddr)
            .unwrap();
        let escrow = escrow_vault::Client::new(&env, &escrow_addr);
        escrow.cancel(&trader, &record.nullifier);

        record.status = OrderStatus::Cancelled;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
        Self::remove_active(&env, &commitment);
    }

    /// Anyone can expire an order past its deadline, returning funds to the
    /// trader. Mirrors EscrowVault.expire() — see `cancel` above for why this
    /// routes through OrderBook rather than calling EscrowVault directly.
    pub fn expire(env: Env, commitment: BytesN<32>) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Order(commitment.clone());
        let mut record: OrderRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("order not found"));

        if record.status != OrderStatus::Active {
            panic!("not active");
        }
        if env.ledger().timestamp() < record.expires_at {
            panic!("not expired yet");
        }

        let escrow_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::EscrowVaultAddr)
            .unwrap();
        let escrow = escrow_vault::Client::new(&env, &escrow_addr);
        escrow.expire(&record.nullifier);

        record.status = OrderStatus::Expired;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
        Self::remove_active(&env, &commitment);
    }

    /// Remove a commitment from the active-orders index. Called whenever an
    /// order leaves the Active state (matched, cancelled, expired) so the
    /// index reflects currently-open orders instead of growing forever —
    /// unbounded growth here would eventually make every future
    /// `submit_order` call exceed Soroban's per-entry resource limit and
    /// permanently halt new order intake.
    fn remove_active(env: &Env, commitment: &BytesN<32>) {
        let active: Vec<BytesN<32>> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveOrders)
            .unwrap_or_else(|| Vec::new(env));
        let mut next: Vec<BytesN<32>> = Vec::new(env);
        for c in active.iter() {
            if &c != commitment {
                next.push_back(c);
            }
        }
        env.storage().instance().set(&DataKey::ActiveOrders, &next);
    }

    pub fn get_order(env: Env, commitment: BytesN<32>) -> Option<OrderRecord> {
        env.storage().persistent().get(&DataKey::Order(commitment))
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

    /// Admin-only emergency switch. Pausing blocks new order submissions only.
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
    use crate::test_vector as tv;
    use soroban_sdk::testutils::Address as _;

    fn vk_from(
        env: &Env,
        alpha: &[u8; 64],
        beta: &[u8; 128],
        gamma: &[u8; 128],
        delta: &[u8; 128],
        ic: &[[u8; 64]],
    ) -> zk_verifier::VerificationKey {
        let mut v: Vec<BytesN<64>> = Vec::new(env);
        for raw in ic.iter() {
            v.push_back(BytesN::from_array(env, raw));
        }
        zk_verifier::VerificationKey {
            alpha: BytesN::from_array(env, alpha),
            beta: BytesN::from_array(env, beta),
            gamma: BytesN::from_array(env, gamma),
            delta: BytesN::from_array(env, delta),
            gamma_abc: v,
        }
    }

    fn order_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &tv::ORDER_PI_A),
            pi_b: BytesN::from_array(env, &tv::ORDER_PI_B),
            pi_c: BytesN::from_array(env, &tv::ORDER_PI_C),
        }
    }
    fn order_signals(env: &Env) -> Vec<BytesN<32>> {
        let mut v = Vec::new(env);
        for s in tv::ORDER_SIGNALS.iter() {
            v.push_back(BytesN::from_array(env, s));
        }
        v
    }
    fn balance_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &tv::BALANCE_PI_A),
            pi_b: BytesN::from_array(env, &tv::BALANCE_PI_B),
            pi_c: BytesN::from_array(env, &tv::BALANCE_PI_C),
        }
    }
    fn balance_signals(env: &Env) -> Vec<BytesN<32>> {
        let mut v = Vec::new(env);
        for s in tv::BALANCE_SIGNALS.iter() {
            v.push_back(BytesN::from_array(env, s));
        }
        v
    }
    fn range_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &tv::RANGE_PI_A),
            pi_b: BytesN::from_array(env, &tv::RANGE_PI_B),
            pi_c: BytesN::from_array(env, &tv::RANGE_PI_C),
        }
    }
    fn range_signals(env: &Env) -> Vec<BytesN<32>> {
        let mut v = Vec::new(env);
        for s in tv::RANGE_SIGNALS.iter() {
            v.push_back(BytesN::from_array(env, s));
        }
        v
    }

    struct Fixture {
        env: Env,
        order_book: OrderBookClient<'static>,
        escrow: escrow_vault::Client<'static>,
        token: soroban_sdk::token::TokenClient<'static>,
        trader: Address,
        commitment: BytesN<32>,
        nullifier: BytesN<32>,
    }

    /// Wires up real ZKVerifier (with the real order/balance/range VKs the
    /// fixture's proofs actually verify against) + real EscrowVault + real
    /// OrderBook, and mints the trader enough of a real SAC token to cover
    /// the fixture's AMOUNT_IN.
    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);

        let zk_id = env.register(zk_verifier::WASM, ());
        let zk = zk_verifier::Client::new(&env, &zk_id);
        let vk_order = vk_from(
            &env,
            &tv::ORDER_VK_ALPHA,
            &tv::ORDER_VK_BETA,
            &tv::ORDER_VK_GAMMA,
            &tv::ORDER_VK_DELTA,
            &tv::ORDER_VK_IC,
        );
        let vk_balance = vk_from(
            &env,
            &tv::BALANCE_VK_ALPHA,
            &tv::BALANCE_VK_BETA,
            &tv::BALANCE_VK_GAMMA,
            &tv::BALANCE_VK_DELTA,
            &tv::BALANCE_VK_IC,
        );
        let vk_range = vk_from(
            &env,
            &tv::RANGE_VK_ALPHA,
            &tv::RANGE_VK_BETA,
            &tv::RANGE_VK_GAMMA,
            &tv::RANGE_VK_DELTA,
            &tv::RANGE_VK_IC,
        );
        // OrderBook never calls verify_match_proof — reuse vk_order as a
        // structurally-valid placeholder for the required initialize() arg.
        zk.initialize(&admin, &vk_order, &vk_balance, &vk_range, &vk_order);

        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);

        // Created before escrow.initialize() so it can be registered as an
        // allowed asset — this fixture's sell order escrows this same token
        // as asset_in.
        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        let other_token = Address::generate(&env);

        let escrow_id = env.register(escrow_vault::WASM, ());
        let escrow = escrow_vault::Client::new(&env, &escrow_id);
        escrow.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &token_addr,
            &other_token,
        );

        let order_book_id = env.register(OrderBook, ());
        let order_book = OrderBookClient::new(&env, &order_book_id);
        order_book.initialize(&admin, &zk_id, &escrow_id);

        let trader = Address::generate(&env);
        minter.mint(&trader, &(tv::AMOUNT_IN * 2));

        let commitment = BytesN::from_array(&env, &tv::COMMITMENT);
        let nullifier = BytesN::from_array(&env, &tv::NULLIFIER);

        Fixture {
            env,
            order_book,
            escrow,
            token,
            trader,
            commitment,
            nullifier,
        }
    }

    /// Submits the fixture's real sell order with the given amount_in — lets
    /// tests pass a mismatched amount_in to exercise the balance-proof
    /// binding check without needing a whole new proof fixture.
    #[allow(clippy::too_many_arguments)]
    fn submit_with_amount(f: &Fixture, amount_in: i128) -> BytesN<32> {
        let asset = f.token.address.clone();
        f.order_book.submit_order(
            &f.trader,
            &f.commitment,
            &f.nullifier,
            &asset,
            &asset,
            &amount_in,
            &order_proof(&f.env),
            &order_signals(&f.env),
            &balance_proof(&f.env),
            &balance_signals(&f.env),
            &range_proof(&f.env),
            &range_signals(&f.env),
            &u64::MAX,
        )
    }

    #[test]
    fn test_submit_order_happy_path_with_real_proofs() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);

        let record = f
            .order_book
            .get_order(&f.commitment)
            .expect("order recorded");
        assert!(matches!(record.status, OrderStatus::Active));
        assert_eq!(record.amount_in, tv::AMOUNT_IN);
        assert_eq!(f.order_book.get_order_count(), 1);
        assert_eq!(f.order_book.get_active_commitments().len(), 1);
        assert_eq!(
            f.token.balance(&f.trader),
            tv::AMOUNT_IN,
            "half the mint escrowed, half left"
        );
    }

    #[test]
    #[should_panic(expected = "balance minimum_balance does not match amount_in")]
    fn test_submit_order_rejects_amount_in_not_matching_balance_proof() {
        let f = setup();
        // Real proofs prove minimum_balance == tv::AMOUNT_IN; claiming a
        // different on-chain amount_in must be rejected — this is exactly
        // the binding that closes the "decoupled balance proof" gap.
        submit_with_amount(&f, tv::AMOUNT_IN + 1);
    }

    #[test]
    #[should_panic(expected = "range proof commitment mismatch")]
    fn test_submit_order_rejects_range_proof_for_different_commitment() {
        let f = setup();
        let asset = f.token.address.clone();
        let mut tampered_range_signals = range_signals(&f.env);
        // Flip a byte of the range proof's public `commitment` signal so it
        // no longer matches the order being submitted — the exact "range
        // proof for an unrelated order" forgery this binding check exists
        // to close (the proof itself is still cryptographically valid, just
        // for a commitment nobody asked about).
        let mut tampered = tv::RANGE_SIGNALS[2];
        tampered[31] ^= 0x01;
        tampered_range_signals.set(2, BytesN::from_array(&f.env, &tampered));

        f.order_book.submit_order(
            &f.trader,
            &f.commitment,
            &f.nullifier,
            &asset,
            &asset,
            &tv::AMOUNT_IN,
            &order_proof(&f.env),
            &order_signals(&f.env),
            &balance_proof(&f.env),
            &balance_signals(&f.env),
            &range_proof(&f.env),
            &tampered_range_signals,
            &u64::MAX,
        );
    }

    #[test]
    #[should_panic(expected = "nullifier already used")]
    fn test_submit_order_rejects_replayed_nullifier() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);
        // Minted 2x AMOUNT_IN so a second attempt isn't blocked by balance —
        // it must be blocked by the nullifier-reuse guard specifically.
        submit_with_amount(&f, tv::AMOUNT_IN);
    }

    #[test]
    #[should_panic(expected = "order submission paused")]
    fn test_submit_order_rejected_while_paused() {
        let f = setup();
        let admin = f.env.as_contract(&f.order_book.address, || {
            f.env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::Admin)
                .unwrap()
        });
        f.order_book.set_paused(&admin, &true);
        submit_with_amount(&f, tv::AMOUNT_IN);
    }

    #[test]
    fn test_cancel_reclaims_funds_and_removes_from_active() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);
        assert_eq!(f.order_book.get_active_commitments().len(), 1);

        f.order_book.cancel(&f.trader, &f.commitment);

        let record = f.order_book.get_order(&f.commitment).unwrap();
        assert!(matches!(record.status, OrderStatus::Cancelled));
        assert_eq!(
            f.order_book.get_active_commitments().len(),
            0,
            "removed from active index"
        );
        assert_eq!(f.token.balance(&f.trader), tv::AMOUNT_IN * 2, "full refund");
        let _ = &f.escrow; // escrow field kept for setup symmetry / future assertions
    }

    #[test]
    #[should_panic(expected = "not your order")]
    fn test_cancel_rejects_non_owner() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);
        let attacker = Address::generate(&f.env);
        f.order_book.cancel(&attacker, &f.commitment);
    }

    #[test]
    #[should_panic(expected = "not expired yet")]
    fn test_expire_rejects_before_deadline() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);
        f.order_book.expire(&f.commitment);
    }

    #[test]
    #[should_panic(expected = "order not active")]
    fn test_mark_matched_requires_active_status() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);
        f.order_book.mark_matched(&f.commitment);
        f.order_book.mark_matched(&f.commitment); // second call: no longer Active
    }

    #[test]
    #[should_panic(expected = "order not matched")]
    fn test_mark_settled_requires_matched_status() {
        let f = setup();
        submit_with_amount(&f, tv::AMOUNT_IN);
        f.order_book.mark_settled(&f.commitment); // still Active, not Matched
    }
}
