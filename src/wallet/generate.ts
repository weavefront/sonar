/**
 * Generating a brand-new Arweave wallet in the browser — the ArDrive-style "new user" path, for
 * someone who has never touched Arweave before rather than someone connecting an existing wallet.
 *
 * Deterministic RSA-4096 generation from a BIP39 mnemonic, converted to an Arweave-shaped JWK.
 * `human-crypto-keys` + `libp2p-crypto` for the RSA/JWK part isn't a fringe choice: Wander (the
 * real wallet extension, formerly ArConnect) depends on the same libraries for its own
 * wallet-creation flow (confirmed by reading Wander's own package.json). Deterministic RSA
 * generation from a seed is inherently slow — 30 seconds to 2 minutes per `human-crypto-keys`'
 * own docs — which is the real cost of "recoverable from 12 words," not something to engineer
 * around.
 *
 * **Does not use `human-crypto-keys`'s own `generateKeyPair()`/`getKeyPairFromMnemonic()`, and
 * does not use the `arweave-mnemonic-keys` wrapper package that calls them.** Both have a real,
 * reproducible bug: internally they do
 * `new Uint8Array((await bip39.mnemonicToSeed(mnemonic)).buffer)` — but a Node `Buffer`'s
 * `.buffer` is a view into a shared, rotating allocation pool (`Buffer.poolSize`, 8KB by
 * default), not a buffer sized to just that value. Reading `.buffer` directly (instead of
 * wrapping the `Buffer` itself) pulls in whatever else happens to be sitting in the rest of that
 * pool at that moment — which depends on unrelated allocations elsewhere in the program, not just
 * the mnemonic. Confirmed directly: generating a wallet and then recovering it from its own
 * mnemonic via that code path produced two *different* addresses, and a minimal repro showed the
 * "seed" bytes differing between two calls with the identical mnemonic once other allocations
 * happened in between. This defeats the entire point of a recovery phrase, silently.
 *
 * The fix is to do the mnemonic→seed step ourselves, correctly (`new Uint8Array(seedBuffer)`,
 * passing the `Buffer` directly rather than its raw `.buffer` — verified deterministic across
 * repeated calls with intervening allocations), and call `getKeyPairFromSeed(seed, ...)` directly
 * — the one entry point in `human-crypto-keys` that never touches the buggy code path, since the
 * caller already supplies a correctly-sized `seed`.
 *
 * Dynamically imported at the one call site that needs it (`CreateWalletDialog.tsx`), never from a
 * static top-level import — this pulls in real bignum/crypto code that the vast majority of
 * sessions (anyone who already has a wallet) should never pay to parse or execute, same reasoning
 * as this app's existing lazy-loaded Turbo SDK/arbundles write path.
 */

import type { FullJwk } from './store';

export interface GeneratedWallet {
  mnemonic: string;
  jwk: FullJwk;
}

/** Shared by `generateWallet` and its own test's independent recovery check. */
export async function mnemonicToSeed(mnemonic: string): Promise<Uint8Array> {
  const bip39 = await import('bip39');
  const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
  // Pass the Buffer itself, NOT `.buffer` — see the module doc comment above for why that
  // distinction is the entire bug this file exists to route around.
  return new Uint8Array(seedBuffer);
}

/** Exported alongside `mnemonicToSeed` so a test (or a future "restore from phrase" flow) can
    independently reconstruct a wallet from just its mnemonic, calling the same pieces
    `generateWallet` does — not the whole function, which always mints a *fresh* mnemonic. */
export async function rsaKeyPairFromSeed(seed: Uint8Array): Promise<{ privateKey: string }> {
  const { getKeyPairFromSeed } = await import('human-crypto-keys');
  return getKeyPairFromSeed(seed, { id: 'rsa', modulusLength: 4096 }, { privateKeyFormat: 'pkcs1-pem' });
}

/** PEM private key -> Arweave-shaped JWK, matching what `arweave-mnemonic-keys` does for the
    same conversion (minus the buggy seed step this file replaces). */
export async function pemToJwk(privateKeyPem: string): Promise<FullJwk> {
  const { default: libp2pCrypto } = await import('libp2p-crypto');
  // `libp2p-crypto`'s typed `keys.import` returns its own key-wrapper class, not a plain JWK —
  // the raw JWK sits on an untyped internal `_key` field.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imported = (await (libp2pCrypto as any).keys.import(privateKeyPem, '')) as { _key: FullJwk };
  const jwk = imported._key;
  delete jwk.alg;
  delete jwk.key_ops;
  return jwk;
}

export async function generateWallet(): Promise<GeneratedWallet> {
  const { generateMnemonic } = await import('bip39');
  const mnemonic = generateMnemonic();
  const seed = await mnemonicToSeed(mnemonic);
  const { privateKey } = await rsaKeyPairFromSeed(seed);
  const jwk = await pemToJwk(privateKey);
  return { mnemonic, jwk };
}
