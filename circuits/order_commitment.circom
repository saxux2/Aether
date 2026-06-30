pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";

// Proves that commitment = Poseidon(price, quantity, direction, salt)
// without revealing any of the private inputs.
template OrderCommitment() {
    // Private inputs — never leave the browser
    signal input price;
    signal input quantity;
    signal input direction;
    signal input salt;

    // Public inputs — safe to share on-chain
    signal input commitment;

    // Internal
    signal output valid;

    // Compute Poseidon hash of order parameters
    component hasher = Poseidon(4);
    hasher.inputs[0] <== price;
    hasher.inputs[1] <== quantity;
    hasher.inputs[2] <== direction;
    hasher.inputs[3] <== salt;

    // The provided commitment must match the hash
    commitment === hasher.out;

    // Direction must be binary (0=buy, 1=sell)
    signal dirSquared;
    dirSquared <== direction * direction;
    dirSquared === direction;

    // Price must be strictly positive
    component priceGtZero = GreaterThan(64);
    priceGtZero.in[0] <== price;
    priceGtZero.in[1] <== 0;
    priceGtZero.out === 1;

    // Quantity must be strictly positive
    component qtyGtZero = GreaterThan(64);
    qtyGtZero.in[0] <== quantity;
    qtyGtZero.in[1] <== 0;
    qtyGtZero.out === 1;

    valid <== 1;
}

component main {public [commitment]} = OrderCommitment();
