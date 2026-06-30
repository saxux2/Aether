declare module 'snarkjs' {
  interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
  }
  interface PublicSignals {
    [index: number]: string;
  }
  namespace groth16 {
    function fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string
    ): Promise<{ proof: Groth16Proof; publicSignals: string[] }>;
    function verify(
      vKey: Record<string, unknown>,
      publicSignals: string[],
      proof: Groth16Proof
    ): Promise<boolean>;
  }
}
