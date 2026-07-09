pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// Proves the hidden price of a specific order — identified by its public
// order_commitment.circom commitment — lies within the protocol's accepted
// price band [price_min, price_max], without revealing the actual price.
//
// This circuit re-derives the SAME Poseidon(price, quantity, direction, salt)
// commitment that order_commitment.circom proves, from the same private
// preimage, rather than committing to price separately. That's deliberate:
// an earlier version used an independent Poseidon(price, price_salt)
// "price_commitment" with no constraint tying it back to the real order, so
// a prover could submit a real order at an out-of-band price alongside a
// valid range proof for an unrelated, in-band dummy price — the two proofs
// were individually sound but mutually meaningless. Sharing the exact
// preimage (and the on-chain check in order_book that this proof's
// `commitment` public signal equals the order's real commitment) closes
// that gap: there is now only one price, and it's the order's actual price.
template RangeProof() {
    // Private inputs — identical preimage to OrderCommitment
    signal input price;      // actual limit price in micro-USDC per XLM
    signal input quantity;
    signal input direction;
    signal input salt;

    // Public inputs — safe to share
    signal input price_min;    // protocol minimum (1,000 = $0.001/XLM)
    signal input price_max;    // protocol maximum (10,000,000 = $10.00/XLM)
    signal input commitment;   // must equal the order's order_commitment output

    // The commitment being range-checked must be this exact order.
    component hasher = Poseidon(4);
    hasher.inputs[0] <== price;
    hasher.inputs[1] <== quantity;
    hasher.inputs[2] <== direction;
    hasher.inputs[3] <== salt;
    commitment === hasher.out;

    // Pre-range-check price before it feeds the comparators below — makes the
    // bound explicit rather than relying on price_min/price_max being fixed
    // protocol constants (see match_proof.circom for the same pattern).
    component priceBits = Num2Bits(64);
    priceBits.in <== price;

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
}

component main {public [price_min, price_max, commitment]} = RangeProof();
