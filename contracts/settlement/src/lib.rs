#![no_std]

mod types;
pub use types::DataKey;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, BytesN, Env};

// EscrowVault cross-contract client
mod escrow_vault {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/escrow_vault.wasm");
}

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

        let escrow_addr: Address = env.storage().instance().get(&DataKey::EscrowVault).unwrap();
        let escrow = escrow_vault::Client::new(&env, &escrow_addr);

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
