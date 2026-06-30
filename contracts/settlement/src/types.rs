use soroban_sdk::contracttype;

#[contracttype]
pub enum DataKey {
    Admin,
    MatchingEngine,
    EscrowVault,
    XlmToken,
    UsdcToken,
    SettlementCount,
    TotalVolumeXlm,
    TotalVolumeUsdc,
}
