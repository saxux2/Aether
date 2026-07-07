#![no_std]

mod types;
pub use types::{DataKey, DepositRecord, DepositStatus};

use soroban_sdk::{contract, contractimpl, token, Address, BytesN, Env};

#[contract]
pub struct EscrowVault;

#[contractimpl]
impl EscrowVault {
    /// One-time initialization.
    /// matching_engine and settlement are the only addresses allowed to
    /// call lock_for_settlement() and release() respectively.
    pub fn initialize(env: Env, admin: Address, matching_engine: Address, settlement: Address) {
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

        env.storage().persistent().set(
            &DataKey::Deposit(nullifier.clone()),
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

        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Deposit(nullifier.clone()))
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.status != DepositStatus::Active {
            panic!("deposit not active");
        }

        record.status = DepositStatus::Matched;
        env.storage()
            .persistent()
            .set(&DataKey::Deposit(nullifier), &record);
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

        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Deposit(nullifier.clone()))
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.status != DepositStatus::Matched {
            panic!("deposit not matched");
        }
        if amount < 0 || amount > record.amount {
            panic!("release amount exceeds deposit");
        }

        let tok = token::Client::new(&env, &record.asset);
        tok.transfer(&env.current_contract_address(), &recipient, &amount);

        // Refund the unspent remainder (price improvement) to the depositor.
        let refund = record.amount - amount;
        if refund > 0 {
            tok.transfer(&env.current_contract_address(), &record.trader, &refund);
        }

        record.status = DepositStatus::Settled;
        env.storage()
            .persistent()
            .set(&DataKey::Deposit(nullifier), &record);
    }

    /// Trader cancels their own active order and reclaims funds.
    pub fn cancel(env: Env, trader: Address, nullifier: BytesN<32>) {
        trader.require_auth();

        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Deposit(nullifier.clone()))
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.trader != trader {
            panic!("not your deposit");
        }
        if record.status != DepositStatus::Active {
            panic!("cannot cancel — not active");
        }

        let tok = token::Client::new(&env, &record.asset);
        tok.transfer(&env.current_contract_address(), &trader, &record.amount);

        record.status = DepositStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&DataKey::Deposit(nullifier), &record);
    }

    /// Anyone can expire an order that has passed its deadline, returning funds to trader.
    pub fn expire(env: Env, nullifier: BytesN<32>) {
        let mut record: DepositRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Deposit(nullifier.clone()))
            .unwrap_or_else(|| panic!("deposit not found"));

        if record.status != DepositStatus::Active {
            panic!("not active");
        }
        if env.ledger().timestamp() < record.expires_at {
            panic!("not expired yet");
        }

        let tok = token::Client::new(&env, &record.asset);
        tok.transfer(
            &env.current_contract_address(),
            record.trader.clone(),
            &record.amount,
        );

        record.status = DepositStatus::Expired;
        env.storage()
            .persistent()
            .set(&DataKey::Deposit(nullifier), &record);
    }

    pub fn get_deposit(env: Env, nullifier: BytesN<32>) -> Option<DepositRecord> {
        env.storage().persistent().get(&DataKey::Deposit(nullifier))
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
        client.initialize(&admin, &matching_engine, &settlement);

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
        client.initialize(&admin, &matching_engine, &settlement);

        // A real SAC token so the transfers actually move balances.
        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let token = soroban_sdk::token::TokenClient::new(&env, &token_addr);
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

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
        client.initialize(&admin, &matching_engine, &settlement);

        let token_admin = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(token_admin);
        let token_addr = sac.address();
        let minter = soroban_sdk::token::StellarAssetClient::new(&env, &token_addr);

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
        client.initialize(&admin, &me, &s);
        client.initialize(&admin, &me, &s);
    }
}
