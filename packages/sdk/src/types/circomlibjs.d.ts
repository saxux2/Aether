declare module 'circomlibjs' {
  interface PoseidonInstance {
    (inputs: bigint[]): Uint8Array;
    F: {
      toString(x: Uint8Array): string;
      toObject(x: Uint8Array): bigint;
    };
  }
  export function buildPoseidon(): Promise<PoseidonInstance>;
  export function buildMimc7(): Promise<unknown>;
  export function buildMimcSponge(): Promise<unknown>;
}
