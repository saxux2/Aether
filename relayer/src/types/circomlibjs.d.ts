declare module 'circomlibjs' {
  interface PoseidonInstance {
    (inputs: bigint[]): Uint8Array;
    F: {
      toString(x: Uint8Array): string;
    };
  }

  export function buildPoseidon(): Promise<PoseidonInstance>;
}
