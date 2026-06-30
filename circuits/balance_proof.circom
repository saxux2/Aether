pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Proves the trader has sufficient escrow balance for the order
// and generates a nullifier to prevent double-spending the same balance.
template BalanceProof() {
    // Private inputs — known only to the trader
    signal input secret;     // trader's private secret, derived from wallet
    signal input balance;    // actual escrow balance in stroops
    signal input quantity;   // order quantity in stroops
    signal input nonce;      // per-order nonce makes each nullifier unique

    // Public inputs — safe to share
    signal input nullifier;        // Poseidon(secret, nonce) — unique per order
    signal input minimum_balance;  // must equal quantity (public floor check)

    // Nullifier = Poseidon(secret, nonce) — ties this proof to one specific order
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== secret;
    nullifierHasher.inputs[1] <== nonce;
    nullifier === nullifierHasher.out;

    // Balance must be >= quantity — proves funds exist without revealing balance
    component balanceCheck = GreaterEqThan(64);
    balanceCheck.in[0] <== balance;
    balanceCheck.in[1] <== quantity;
    balanceCheck.out === 1;

    // Quantity must equal the public minimum_balance floor
    quantity === minimum_balance;
}

component main {public [nullifier, minimum_balance]} = BalanceProof();
