#![no_std]

mod types;
pub use types::{DataKey, DepositRecord, DepositStatus};

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};

// TTL bookkeeping. Soroban entries (both the contract instance and each
// persistent key) get archived once their time-to-live runs out, after
// which reading them requires an off-chain RestoreFootprint operation
// before any contract call can touch them again. For a fund-custody
// contract, an *archived* Deposit is not lost — but it's *stuck* until
// someone notices and restores it, which is a real operational gap for a
// contract nobody had wired this up for. ~5s average ledger close time.
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_THRESHOLD: u32 = DAY_IN_LEDGERS * 30; // extend once <30 days remain
const INSTANCE_EXTEND_TO: u32 = DAY_IN_LEDGERS * 60; // extend out to 60 days
const PERSISTENT_EXTEND_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const PERSISTENT_EXTEND_TO: u32 = DAY_IN_LEDGERS * 60;

#[contract]
pub struct EscrowVault;

#[contractimpl]
impl EscrowVault {
    /// One-time initialization.
    /// matching_engine and settlement are the only addresses allowed to
    /// call lock_for_settlement() and release() respectively. xlm_token/
    /// usdc_token are the only assets deposit() will accept — see deposit()
    /// for why.
    pub fn initialize(
        env: Env,
        admin: Address,
        matching_engine: Address,
        settlement: Address,
        xlm_token: Address,
        usdc_token: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::MatchingEngineAddr, &matching_engine);
        env.storage()
            .instance()
            .set(&DataKey::SettlementAddr, &settlement);
        env.storage().instance().set(&DataKey::XlmToken, &xlm_token);
        env.storage()
            .instance()
            .set(&DataKey::UsdcToken, &usdc_token);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    /// Lock trader funds alongside order submission.
    /// Called by OrderBook (which the trader authorizes as part of their Soroban tx).
    /// Transfers `amount` of `asset` from the trader's wallet into this vault.
    pub fn deposit(
        env: Env,
        trader: Address,
        asset: Address,
        amount: i128,
        nullifier: BytesN<32>,
        commitment: BytesN<32>,
        expires_at: u64,
    ) {
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
            panic!("deposits paused");
        }

        // Only the two tokens this pool actually trades may be escrowed.
        // Without this, deposit() would pull funds using whatever token
        // contract the caller names — for a legitimate trader that's just
        // their own funds under an unexpected asset, but it also means
        // nothing here previously enforced the "buyer escrows USDC / seller
        // escrows XLM" invariant at the point of deposit (settlement.settle()
        // independently checks this before release — see settlement's own
        // asset-binding check — but defense in depth belongs at both ends).
        let xlm_token: Address = env.storage().instance().get(&DataKey::XlmToken).unwrap();
        let usdc_token: Address = env.storage().instance().get(&DataKey::UsdcToken).unwrap();
        if asset != xlm_token && asset != usdc_token {
            panic!("asset not allowed");
        }

        // Reject duplicate nullifiers — prevents double-spending the same escrow slot
        if env
            .storage()
            .persistent()
            .has(&DataKey::Deposit(nullifier.clone()))
        {
            panic!("nullifier already used");
        }

        // Pull funds from trader into this vault contract
        let tok = token::Client::new(&env, &asset);
        tok.transfer(&trader, env.current_contract_address(), &amount);

        let key = DataKey::Deposit(nullifier.clone());
        env.storage().persistent().set(
            &key,
            &DepositRecord {
                trader,
                asset,
                amount,
                nullifier,
                commitment,
                status: DepositStatus::Active,
                created_at: env.ledger().timestamp(),
                expires_at,
            },
        );
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
    }

    /// Called by MatchingEngine when a match is found.
    /// Transitions deposit from Active → Matched so it cannot be cancelled.
    pub fn lock_for_settlement(env: Env, nullifier: BytesN<32>) -> DepositRecord {
        let matching_engine: Address = env
            .storage()
            .instance()
            .get(&DataKey::MatchingEngineAddr)
            .unwrap();
        matching_engine.require_auth();

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Deposit(nullifier);
        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.status != DepositStatus::Active {
            panic!("deposit not active");
        }

        record.status = DepositStatus::Matched;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );
        record
    }

    /// Called ONLY by the Settlement contract.
    /// Releases `amount` of the matched deposit to `recipient` (the counterparty)
    /// and refunds any surplus (`deposit − amount`) to the original depositor.
    ///
    /// The surplus arises in a uniform-price batch auction: a buyer escrows USDC
    /// at their *limit* price but the batch clears at a (better) uniform price, so
    /// only `amount` is owed to the seller — the price-improvement difference must
    /// return to the buyer, not leak to the counterparty.
    /// The Settlement auth check is non-negotiable — no other caller can release funds.
    pub fn release(env: Env, nullifier: BytesN<32>, recipient: Address, amount: i128) {
        let settlement: Address = env
            .storage()
            .instance()
            .get(&DataKey::SettlementAddr)
            .unwrap();
        settlement.require_auth();

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Deposit(nullifier);
        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.status != DepositStatus::Matched {
            panic!("deposit not matched");
        }
        if amount < 0 || amount > record.amount {
            panic!("release amount exceeds deposit");
        }

        // Write status before making any external token calls (checks-effects-
        // interactions). deposit() places no restriction on which token
        // contract `asset` is, so a malicious token's transfer implementation
        // could otherwise reenter release()/cancel()/expire() while status was
        // still readable as Matched/Active.
        record.status = DepositStatus::Settled;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

        let tok = token::Client::new(&env, &record.asset);
        tok.transfer(&env.current_contract_address(), &recipient, &amount);

        // Refund the unspent remainder (price improvement) to the depositor.
        let refund = record.amount - amount;
        if refund > 0 {
            tok.transfer(&env.current_contract_address(), &record.trader, &refund);
        }
    }

    /// Trader cancels their own active order and reclaims funds.
    pub fn cancel(env: Env, trader: Address, nullifier: BytesN<32>) {
        trader.require_auth();

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Deposit(nullifier);
        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.trader != trader {
            panic!("not your deposit");
        }
        if record.status != DepositStatus::Active {
            panic!("cannot cancel — not active");
        }

        // Status write before transfer — see release() for why.
        record.status = DepositStatus::Cancelled;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

        let tok = token::Client::new(&env, &record.asset);
        tok.transfer(&env.current_contract_address(), &trader, &record.amount);
    }

    /// Anyone can expire an order that has passed its deadline, returning funds to trader.
    pub fn expire(env: Env, nullifier: BytesN<32>) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let key = DataKey::Deposit(nullifier);
        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.status != DepositStatus::Active {
            panic!("not active");
        }
        if env.ledger().timestamp() < record.expires_at {
            panic!("not expired yet");
        }

        // Status write before transfer — see release() for why.
        record.status = DepositStatus::Expired;
        env.storage().persistent().set(&key, &record);
        env.storage().persistent().extend_ttl(
            &key,
            PERSISTENT_EXTEND_THRESHOLD,
            PERSISTENT_EXTEND_TO,
        );

        let tok = token::Client::new(&env, &record.asset);
        tok.transfer(
            &env.current_contract_address(),
            record.trader.clone(),
            &record.amount,
        );
    }

    pub fn get_deposit(env: Env, nullifier: BytesN<32>) -> Option<DepositRecord> {
        env.storage().persistent().get(&DataKey::Deposit(nullifier))
    }

    /// Admin-only emergency switch. Pausing blocks new deposits only —
    /// cancel/expire/release always remain callable so traders can never be
    /// locked out of funds already in the vault.
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
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    fn setup_env() -> (Env, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(EscrowVault, ());
        (env, contract_id)
    }

    #[test]
    #[should_panic(expected = "deposit not matched")]
    fn test_release_requires_matched_status() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);
        let xlm_token = Address::generate(&env);
        let usdc_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &xlm_token,
            &usdc_token,
        );

        // Calling release on a nullifier with no deposit record panics with "deposit not found".
        // To test the "not matched" guard, we would need to deposit first, then call release.
        // This test exercises the "not matched" path: deposit is Active, release must fail.
        // We skip the actual token transfer by not registering a token contract,
        // so we test that the status guard fires before any token call.
        let nullifier = BytesN::from_array(&env, &[1u8; 32]);
        let recipient = Address::generate(&env);
        // Injecting a synthetic Active record directly via storage:
        env.as_contract(&contract_id, || {
            env.storage().persistent().set(
                &DataKey::Deposit(nullifier.clone()),
                &DepositRecord {
                    trader: recipient.clone(),
                    asset: recipient.clone(), // placeholder
                    amount: 1000,
                    nullifier: nullifier.clone(),
                    commitment: BytesN::from_array(&env, &[2u8; 32]),
                    status: DepositStatus::Active,
                    created_at: 0,
                    expires_at: u64::MAX,
                },
            );
        });
        client.release(&nullifier, &recipient, &1000i128);
    }

    /// Bug A regression: release(amount) must pay the counterparty exactly `amount`
    /// and refund the surplus (deposit − amount) to the original depositor — never
    /// hand the price-improvement difference to the counterparty.
    #[test]
    fn test_release_pays_amount_and_refunds_surplus() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);

        // A real SAC token so the transfers actually move balances. Created
        // before initialize() so it can be registered as an allowed asset.
        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        let other_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &token_addr,
            &other_token,
        );

        let trader = Address::generate(&env); // depositor (e.g. buyer escrowing USDC)
        let counterparty = Address::generate(&env); // recipient (e.g. seller)

        // Buyer escrows 100 at their limit price.
        minter.mint(&trader, &100i128);
        let nullifier = BytesN::from_array(&env, &[7u8; 32]);
        let commitment = BytesN::from_array(&env, &[8u8; 32]);
        client.deposit(
            &trader,
            &token_addr,
            &100i128,
            &nullifier,
            &commitment,
            &u64::MAX,
        );
        assert_eq!(token.balance(&trader), 0);
        assert_eq!(token.balance(&contract_id), 100);

        client.lock_for_settlement(&nullifier);

        // Batch clears cheaper: only 70 owed to the counterparty, 30 refunded.
        client.release(&nullifier, &counterparty, &70i128);
        assert_eq!(
            token.balance(&counterparty),
            70,
            "counterparty gets cleared amount"
        );
        assert_eq!(
            token.balance(&trader),
            30,
            "depositor refunded the price-improvement surplus"
        );
        assert_eq!(token.balance(&contract_id), 0, "vault fully drained");
    }

    #[test]
    #[should_panic(expected = "release amount exceeds deposit")]
    fn test_release_rejects_amount_over_deposit() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        let other_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &token_addr,
            &other_token,
        );

        let trader = Address::generate(&env);
        let counterparty = Address::generate(&env);
        minter.mint(&trader, &100i128);
        let nullifier = BytesN::from_array(&env, &[9u8; 32]);
        let commitment = BytesN::from_array(&env, &[10u8; 32]);
        client.deposit(
            &trader,
            &token_addr,
            &100i128,
            &nullifier,
            &commitment,
            &u64::MAX,
        );
        client.lock_for_settlement(&nullifier);

        // Attempt to release more than was deposited — must panic.
        client.release(&nullifier, &counterparty, &150i128);
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let me = Address::generate(&env);
        let s = Address::generate(&env);
        let xlm_token = Address::generate(&env);
        let usdc_token = Address::generate(&env);
        client.initialize(&admin, &me, &s, &xlm_token, &usdc_token);
        client.initialize(&admin, &me, &s, &xlm_token, &usdc_token);
    }

    #[test]
    #[should_panic(expected = "deposits paused")]
    fn test_deposit_rejected_while_paused() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        let other_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &token_addr,
            &other_token,
        );

        client.set_paused(&admin, &true);
        assert!(client.is_paused());

        let trader = Address::generate(&env);
        minter.mint(&trader, &100i128);

        client.deposit(
            &trader,
            &token_addr,
            &100i128,
            &BytesN::from_array(&env, &[42u8; 32]),
            &BytesN::from_array(&env, &[43u8; 32]),
            &u64::MAX,
        );
    }

    #[test]
    #[should_panic(expected = "not admin")]
    fn test_set_paused_rejects_non_admin() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);
        let xlm_token = Address::generate(&env);
        let usdc_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &xlm_token,
            &usdc_token,
        );

        let attacker = Address::generate(&env);
        client.set_paused(&attacker, &true);
    }

    /// Pausing must not block a trader from cancelling and reclaiming an
    /// already-active deposit — the pause switch stops NEW exposure, never exit.
    #[test]
    fn test_cancel_still_works_while_paused() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);
        let other_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &token_addr,
            &other_token,
        );

        let trader = Address::generate(&env);
        minter.mint(&trader, &100i128);
        let nullifier = BytesN::from_array(&env, &[55u8; 32]);

        client.deposit(
            &trader,
            &token_addr,
            &100i128,
            &nullifier,
            &BytesN::from_array(&env, &[56u8; 32]),
            &u64::MAX,
        );

        client.set_paused(&admin, &true);
        client.cancel(&trader, &nullifier);
        assert_eq!(token.balance(&trader), 100);
    }

    /// deposit() must reject any asset that isn't the configured XLM/USDC
    /// pair — the actual security property is at settle() (which
    /// independently checks each leg's asset before releasing), but this is
    /// the defense-in-depth half: nothing should ever get escrowed as a
    /// third asset in the first place.
    #[test]
    #[should_panic(expected = "asset not allowed")]
    fn test_deposit_rejects_unlisted_asset() {
        let (env, contract_id) = setup_env();
        let client = EscrowVaultClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);
        let settlement = Address::generate(&env);
        let xlm_token = Address::generate(&env);
        let usdc_token = Address::generate(&env);
        client.initialize(
            &admin,
            &matching_engine,
            &settlement,
            &xlm_token,
            &usdc_token,
        );

        // A real, freshly-minted SAC token that is NOT xlm_token or usdc_token.
        let rogue_admin = Address::generate(&env);
        let rogue_sac = env.register_stellar_asset_contract_v2(rogue_admin);
        let rogue_token = rogue_sac.address();
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &rogue_token);

        let trader = Address::generate(&env);
        minter.mint(&trader, &100i128);

        client.deposit(
            &trader,
            &rogue_token,
            &100i128,
            &BytesN::from_array(&env, &[77u8; 32]),
            &BytesN::from_array(&env, &[78u8; 32]),
            &u64::MAX,
        );
    }
}
