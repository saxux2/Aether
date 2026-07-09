#![no_std]

mod types;
pub use types::DataKey;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env};

// EscrowVault cross-contract client
mod escrow_vault {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/escrow_vault.wasm");
}

// TTL bookkeeping — see escrow_vault/src/lib.rs's constants for the full
// rationale (same values, same ~5s ledger close time assumption).
const DAY_IN_LEDGERS: u32 = 17_280;
const INSTANCE_EXTEND_THRESHOLD: u32 = DAY_IN_LEDGERS * 30;
const INSTANCE_EXTEND_TO: u32 = DAY_IN_LEDGERS * 60;

#[contract]
pub struct Settlement;

#[contractimpl]
impl Settlement {
    pub fn initialize(
        env: Env,
        admin: Address,
        matching_engine: Address,
        escrow_vault: Address,
        xlm_token: Address,
        usdc_token: Address,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::MatchingEngine, &matching_engine);
        env.storage()
            .instance()
            .set(&DataKey::EscrowVault, &escrow_vault);
        env.storage().instance().set(&DataKey::XlmToken, &xlm_token);
        env.storage()
            .instance()
            .set(&DataKey::UsdcToken, &usdc_token);
        env.storage()
            .instance()
            .set(&DataKey::SettlementCount, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::TotalVolumeXlm, &0i128);
        env.storage()
            .instance()
            .set(&DataKey::TotalVolumeUsdc, &0i128);
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);
    }

    /// Execute the atomic XLM/USDC swap for a matched pair.
    /// Called ONLY by MatchingEngine — no other caller can release escrow funds.
    ///
    /// Buyer deposited USDC to buy XLM → seller receives USDC.
    /// Seller deposited XLM to sell    → buyer receives XLM.
    pub fn settle(
        env: Env,
        buyer_nullifier: BytesN<32>,
        seller_nullifier: BytesN<32>,
        buyer_address: Address,
        seller_address: Address,
        xlm_amount: i128,
        usdc_amount: i128,
    ) {
        let matching_engine: Address = env
            .storage()
            .instance()
            .get(&DataKey::MatchingEngine)
            .unwrap();
        matching_engine.require_auth();

        env.storage()
            .instance()
            .extend_ttl(INSTANCE_EXTEND_THRESHOLD, INSTANCE_EXTEND_TO);

        let escrow_addr: Address = env.storage().instance().get(&DataKey::EscrowVault).unwrap();
        let escrow = escrow_vault::Client::new(&env, &escrow_addr);

        // Confirm each side actually escrowed the asset this settlement assumes
        // before releasing anything. Without this, fund-movement direction is
        // delegated entirely to the relayer's labeling + circuit correctness
        // with no on-chain backstop — an under-constrained circuit or a relayer
        // bug could otherwise settle a buyer/seller pair whose deposits don't
        // actually hold the USDC/XLM sides this function assumes they do.
        let xlm_token: Address = env.storage().instance().get(&DataKey::XlmToken).unwrap();
        let usdc_token: Address = env.storage().instance().get(&DataKey::UsdcToken).unwrap();
        let buyer_deposit = escrow
            .get_deposit(&buyer_nullifier)
            .unwrap_or_else(|| panic!("buyer deposit not found"));
        let seller_deposit = escrow
            .get_deposit(&seller_nullifier)
            .unwrap_or_else(|| panic!("seller deposit not found"));
        if buyer_deposit.asset != usdc_token {
            panic!("buyer deposit is not the USDC side");
        }
        if seller_deposit.asset != xlm_token {
            panic!("seller deposit is not the XLM side");
        }

        // Release buyer's USDC → seller receives `usdc_amount` (the cleared cost);
        // any surplus the buyer escrowed at their limit price is refunded to the buyer.
        escrow.release(&buyer_nullifier, &seller_address, &usdc_amount);

        // Release seller's XLM → buyer receives `xlm_amount`; any unsold remainder
        // (partial fill) is refunded to the seller.
        escrow.release(&seller_nullifier, &buyer_address, &xlm_amount);

        // Update cumulative volume stats
        let vol_xlm: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalVolumeXlm)
            .unwrap_or(0);
        let vol_usdc: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalVolumeUsdc)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::TotalVolumeXlm, &(vol_xlm + xlm_amount));
        env.storage()
            .instance()
            .set(&DataKey::TotalVolumeUsdc, &(vol_usdc + usdc_amount));

        let count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::SettlementCount)
            .unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::SettlementCount, &(count + 1));

        // Emit public event — amounts only, no trader addresses
        #[allow(deprecated)]
        env.events()
            .publish((symbol_short!("settle"),), (xlm_amount, usdc_amount));
    }

    pub fn get_settlement_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::SettlementCount)
            .unwrap_or(0)
    }

    pub fn get_total_volume_xlm(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalVolumeXlm)
            .unwrap_or(0)
    }

    pub fn get_total_volume_usdc(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalVolumeUsdc)
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    struct Fixture {
        env: Env,
        settlement: SettlementClient<'static>,
        escrow: escrow_vault::Client<'static>,
        xlm_token: soroban_sdk::token::TokenClient<'static>,
        usdc_token: soroban_sdk::token::TokenClient<'static>,
        buyer: Address,
        seller: Address,
    }

    /// Wires up real EscrowVault + Settlement contracts with real SAC tokens,
    /// and deposits + locks one buyer (USDC) and one seller (XLM) leg —
    /// everything settle() needs, short of calling settle() itself.
    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let matching_engine = Address::generate(&env);

        let escrow_id = env.register(escrow_vault::WASM, ());
        let escrow = escrow_vault::Client::new(&env, &escrow_id);

        let settlement_id = env.register(Settlement, ());
        let settlement = SettlementClient::new(&env, &settlement_id);

        let xlm_admin = Address::generate(&env);
        let xlm_sac = env.register_stellar_asset_contract_v2(xlm_admin);
        let xlm_token_addr = xlm_sac.address();
        let xlm_token = soroban_sdk::token::TokenClient::new(&env, &xlm_token_addr);
        let xlm_minter = soroban_sdk::token::StellarAssetClient::new(&env, &xlm_token_addr);

        let usdc_admin = Address::generate(&env);
        let usdc_sac = env.register_stellar_asset_contract_v2(usdc_admin);
        let usdc_token_addr = usdc_sac.address();
        let usdc_token = soroban_sdk::token::TokenClient::new(&env, &usdc_token_addr);
        let usdc_minter = soroban_sdk::token::StellarAssetClient::new(&env, &usdc_token_addr);

        escrow.initialize(
            &admin,
            &matching_engine,
            &settlement_id,
            &xlm_token_addr,
            &usdc_token_addr,
        );
        settlement.initialize(
            &admin,
            &matching_engine,
            &escrow_id,
            &xlm_token_addr,
            &usdc_token_addr,
        );

        let buyer = Address::generate(&env);
        let seller = Address::generate(&env);
        usdc_minter.mint(&buyer, &100i128);
        xlm_minter.mint(&seller, &100i128);

        let buyer_nullifier = BytesN::from_array(&env, &[1u8; 32]);
        let seller_nullifier = BytesN::from_array(&env, &[2u8; 32]);
        escrow.deposit(
            &buyer,
            &usdc_token_addr,
            &100i128,
            &buyer_nullifier,
            &BytesN::from_array(&env, &[11u8; 32]),
            &u64::MAX,
        );
        escrow.deposit(
            &seller,
            &xlm_token_addr,
            &100i128,
            &seller_nullifier,
            &BytesN::from_array(&env, &[12u8; 32]),
            &u64::MAX,
        );

        // matching_engine is the only address allowed to call this — under
        // mock_all_auths() any address's require_auth() succeeds, so calling
        // as the env directly (no client identity) is sufficient here.
        escrow.lock_for_settlement(&buyer_nullifier);
        escrow.lock_for_settlement(&seller_nullifier);

        Fixture {
            env,
            settlement,
            escrow,
            xlm_token,
            usdc_token,
            buyer,
            seller,
        }
    }

    #[test]
    fn test_settle_releases_correct_assets_and_updates_stats() {
        let f = setup();
        let buyer_nullifier = BytesN::from_array(&f.env, &[1u8; 32]);
        let seller_nullifier = BytesN::from_array(&f.env, &[2u8; 32]);

        f.settlement.settle(
            &buyer_nullifier,
            &seller_nullifier,
            &f.buyer,
            &f.seller,
            &100i128,
            &100i128,
        );

        assert_eq!(f.xlm_token.balance(&f.buyer), 100, "buyer receives XLM");
        assert_eq!(f.usdc_token.balance(&f.seller), 100, "seller receives USDC");
        assert_eq!(f.settlement.get_settlement_count(), 1);
        assert_eq!(f.settlement.get_total_volume_xlm(), 100);
        assert_eq!(f.settlement.get_total_volume_usdc(), 100);
        let _ = &f.escrow; // fixture field used for setup only past this point
    }

    #[test]
    #[should_panic(expected = "buyer deposit is not the USDC side")]
    fn test_settle_rejects_buyer_deposit_in_wrong_asset() {
        let f = setup();
        let seller_nullifier = BytesN::from_array(&f.env, &[2u8; 32]);
        // Pass the SELLER's (XLM) nullifier where a USDC-side buyer deposit
        // is expected — this is exactly the "wrong asset settles" scenario
        // the asset-binding check exists to catch.
        f.settlement.settle(
            &seller_nullifier,
            &seller_nullifier,
            &f.buyer,
            &f.seller,
            &100i128,
            &100i128,
        );
    }

    #[test]
    #[should_panic(expected = "already initialized")]
    fn test_double_initialize_rejected() {
        let f = setup();
        let admin = Address::generate(&f.env);
        let me = Address::generate(&f.env);
        let ev = Address::generate(&f.env);
        let xlm = Address::generate(&f.env);
        let usdc = Address::generate(&f.env);
        f.settlement.initialize(&admin, &me, &ev, &xlm, &usdc);
    }
}
