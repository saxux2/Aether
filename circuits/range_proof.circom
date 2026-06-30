pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Proves the hidden price lies within the protocol's accepted price band
// [price_min, price_max] without revealing the actual price.
template RangeProof() {
    // Private inputs
    signal input price;       // actual limit price in micro-USDC per XLM
    signal input price_salt;  // salt for the price commitment

    // Public inputs — safe to share
    signal input price_min;         // protocol minimum (1,000 = $0.001/XLM)
    signal input price_max;         // protocol maximum (10,000,000 = $10.00/XLM)
    signal input price_commitment;  // Poseidon(price, price_salt)

    // Price must be >= price_min
    component lowerCheck = GreaterEqThan(64);
    lowerCheck.in[0] <== price;
    lowerCheck.in[1] <== price_min;
    lowerCheck.out === 1;

    // Price must be <= price_max
    component upperCheck = LessEqThan(64);
    upperCheck.in[0] <== price;
    upperCheck.in[1] <== price_max;
    upperCheck.out === 1;

    // Prove the price_commitment is the correct Poseidon hash of the price
    component priceHasher = Poseidon(2);
    priceHasher.inputs[0] <== price;
    priceHasher.inputs[1] <== price_salt;
    price_commitment === priceHasher.out;
}

component main {public [price_min, price_max, price_commitment]} = RangeProof();
