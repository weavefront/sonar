/**
 * `human-crypto-keys` ships no types of its own. Declares only what `generate.ts` actually calls
 * — not the package's full surface.
 */
declare module 'human-crypto-keys' {
  export function getKeyPairFromSeed(
    seed: Uint8Array,
    algorithm: { id: string; modulusLength: number },
    options: { privateKeyFormat: string },
  ): Promise<{ privateKey: string; publicKey: string }>;
}
