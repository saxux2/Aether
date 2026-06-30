pragma circom 2.0.0;

include "node_modules/circomlib/circuits/poseidon.circom";
include "node_modules/circomlib/circuits/comparators.circom";
include "node_modules/circomlib/circuits/bitify.circom";

// Proves a matched pair is legitimate WITHOUT the contract trusting the relayer's
// revealed prices. Given the two public order commitments and the public settlement
// figures, it proves in zero knowledge that:
//   1. buyer_commitment  = Poseidon(buyer_price,  buyer_quantity,  0, buyer_salt)
//   2. seller_commitment = Poseidon(seller_price, seller_quantity, 1, seller_salt)
//   3. seller_price <= clearing_price <= buyer_price   (no one trades past their limit)
//   4. 0 < xlm_amount <= min(buyer_quantity, seller_quantity)
//   5. usdc_amount = floor(xlm_amount * clearing_price / 1e6)   (exact pricing)
//
// Prices/quantities/salts stay private; only the commitments and settlement
// figures (already public on settlement) are revealed. The relayer still chooses
// WHICH eligible pairs to match and the clearing price within the overlap, but it
// can no longer fabricate orders, misreport an order's terms, cross a limit, or
// miscompute the amounts.
template MatchProof() {
    // Private — revealed order preimages (relayer knows these from submission).
    signal input buyer_price;
    signal input buyer_quantity;
    signal input buyer_salt;
    signal input seller_price;
    signal input seller_quantity;
    signal input seller_salt;

    // Public — exactly the values the contract settles on.
    signal input buyer_commitment;
    signal input seller_commitment;
    signal input clearing_price;
    signal input xlm_amount;
    signal input usdc_amount;

    // 1. Buyer commitment opens (direction 0 = buy).
    component hb = Poseidon(4);
    hb.inputs[0] <== buyer_price;
    hb.inputs[1] <== buyer_quantity;
    hb.inputs[2] <== 0;
    hb.inputs[3] <== buyer_salt;
    buyer_commitment === hb.out;

    // 2. Seller commitment opens (direction 1 = sell).
    component hs = Poseidon(4);
    hs.inputs[0] <== seller_price;
    hs.inputs[1] <== seller_quantity;
    hs.inputs[2] <== 1;
    hs.inputs[3] <== seller_salt;
    seller_commitment === hs.out;

    // Bound every magnitude to 64 bits so the products below cannot wrap the field.
    component bP = Num2Bits(64); bP.in <== buyer_price;
    component sP = Num2Bits(64); sP.in <== seller_price;
    component cP = Num2Bits(64); cP.in <== clearing_price;
    component bQ = Num2Bits(64); bQ.in <== buyer_quantity;
    component sQ = Num2Bits(64); sQ.in <== seller_quantity;
    component xA = Num2Bits(64); xA.in <== xlm_amount;
    component uA = Num2Bits(64); uA.in <== usdc_amount;

    // 3. seller_price <= clearing_price <= buyer_price
    component geBuyer = GreaterEqThan(64);
    geBuyer.in[0] <== buyer_price;
    geBuyer.in[1] <== clearing_price;
    geBuyer.out === 1;

    component geClear = GreaterEqThan(64);
    geClear.in[0] <== clearing_price;
    geClear.in[1] <== seller_price;
    geClear.out === 1;

    // 4. 0 < xlm_amount <= min(buyer_quantity, seller_quantity)
    component xlmPos = GreaterThan(64);
    xlmPos.in[0] <== xlm_amount;
    xlmPos.in[1] <== 0;
    xlmPos.out === 1;

    component leBuyerQty = LessEqThan(64);
    leBuyerQty.in[0] <== xlm_amount;
    leBuyerQty.in[1] <== buyer_quantity;
    leBuyerQty.out === 1;

    component leSellerQty = LessEqThan(64);
    leSellerQty.in[0] <== xlm_amount;
    leSellerQty.in[1] <== seller_quantity;
    leSellerQty.out === 1;

    // 5. usdc_amount = floor(xlm_amount * clearing_price / 1e6)
    //    i.e. 0 <= xlm_amount*clearing_price - usdc_amount*1e6 < 1e6
    signal gross;
    gross <== xlm_amount * clearing_price;   // < 2^128
    signal scaled;
    scaled <== usdc_amount * 1000000;
    signal rem;
    rem <== gross - scaled;
    component remLt = LessThan(128);
    remLt.in[0] <== rem;          // wraps huge (and fails) if usdc_amount too large
    remLt.in[1] <== 1000000;
    remLt.out === 1;
}

component main {public [buyer_commitment, seller_commitment, clearing_price, xlm_amount, usdc_amount]} = MatchProof();
