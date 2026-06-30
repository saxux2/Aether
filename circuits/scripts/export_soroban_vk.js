/**
 * Convert snarkjs verification keys (circuits/build/*_vk.json) into the
 * Soroban `VerificationKey` JSON the stellar CLI expects at initialize() time.
 *
 * BytesN fields are hex-encoded (the stellar CLI parses BytesN args as hex).
 * Points use Stellar's BN254 encoding:
 *   alpha / IC[i] : G1 = be(x) || be(y)                                  (64 B)
 *   beta/gamma/delta : G2 = be(x.c1)||be(x.c0)||be(y.c1)||be(y.c0)       (128 B)
 *
 * Writes circuits/build/<name>_soroban_vk.json for each circuit, consumed by
 * contracts/scripts/initialize.sh.
 */
const path = require('path');
const fs = require('fs');

const BUILD = path.join(__dirname, '..', 'build');
const CIRCUITS = ['order_commitment', 'balance_proof', 'range_proof', 'match_proof'];

const be32 = (dec) => BigInt(dec).toString(16).padStart(64, '0');

const g1 = (p) => be32(p[0]) + be32(p[1]);
const g2 = (p) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]);

for (const name of CIRCUITS) {
  const vkPath = path.join(BUILD, `${name}_vk.json`);
  if (!fs.existsSync(vkPath)) {
    console.error(`SKIP ${name}: ${vkPath} not found`);
    continue;
  }
  const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
  const out = {
    alpha: g1(vk.vk_alpha_1),
    beta: g2(vk.vk_beta_2),
    gamma: g2(vk.vk_gamma_2),
    delta: g2(vk.vk_delta_2),
    gamma_abc: vk.IC.map(g1),
  };
  const outPath = path.join(BUILD, `${name}_soroban_vk.json`);
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log(`${name}: nPublic=${vk.nPublic} IC=${vk.IC.length} -> ${outPath}`);
}
