use crate::types::{Groth16Proof, VerificationKey};
use soroban_sdk::crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine};
use soroban_sdk::{vec, BytesN, Env, Vec};

/// Verify a Groth16 proof on BN254 using Soroban's native host functions.
///
/// Checks the standard Groth16 pairing equation:
///   e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
/// where  vk_x = IC[0] + Σ_i (public_signals[i] · IC[i+1])
///
/// All points are expected in Stellar BN254 wire encoding:
///   G1 = be(x) || be(y)                              (64 bytes)
///   G2 = be(x.c1) || be(x.c0) || be(y.c1) || be(y.c0) (128 bytes, imaginary-first)
///   Fr = be(scalar)                                  (32 bytes)
///
/// Returns false (rather than panicking) on any structural mismatch so the
/// calling contract can treat it as a plain "invalid proof".
pub fn verify_groth16(
    env: &Env,
    proof: &Groth16Proof,
    public_signals: &Vec<BytesN<32>>,
    vk: &VerificationKey,
) -> bool {
    // gamma_abc (IC) must have exactly one more element than there are public signals.
    if public_signals.len() + 1 != vk.gamma_abc.len() {
        return false;
    }

    let bn = env.crypto().bn254();

    // vk_x = IC[0] + Σ_i signal_i · IC[i+1]
    let mut vk_x = Bn254G1Affine::from_bytes(vk.gamma_abc.get_unchecked(0));
    let mut i: u32 = 0;
    while i < public_signals.len() {
        let ic = Bn254G1Affine::from_bytes(vk.gamma_abc.get_unchecked(i + 1));
        let scalar = Bn254Fr::from_bytes(public_signals.get_unchecked(i));
        let term = bn.g1_mul(&ic, &scalar);
        vk_x = bn.g1_add(&vk_x, &term);
        i += 1;
    }

    // Proof points.
    let a = Bn254G1Affine::from_bytes(proof.pi_a.clone());
    let b = Bn254G2Affine::from_bytes(proof.pi_b.clone());
    let c = Bn254G1Affine::from_bytes(proof.pi_c.clone());

    // VK points.
    let alpha = Bn254G1Affine::from_bytes(vk.alpha.clone());
    let beta = Bn254G2Affine::from_bytes(vk.beta.clone());
    let gamma = Bn254G2Affine::from_bytes(vk.gamma.clone());
    let delta = Bn254G2Affine::from_bytes(vk.delta.clone());

    // e(-A, B) · e(alpha, beta) · e(vk_x, gamma) · e(C, delta) == 1
    let neg_a = -a;
    let g1: Vec<Bn254G1Affine> = vec![env, neg_a, alpha, vk_x, c];
    let g2: Vec<Bn254G2Affine> = vec![env, b, beta, gamma, delta];

    bn.pairing_check(g1, g2)
}
