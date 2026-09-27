/**
 * Real round-trip against the actual RSA-4096-from-mnemonic derivation.
 *
 * Skipped unless SWIFTDRIVE_WALLET_GEN=1 — deterministic RSA generation from a seed is genuinely
 * slow (30 seconds to 2 minutes, per `human-crypto-keys`' own docs), so this must never run as
 * part of the default fast suite. Run with:
 *
 *     npm run test:wallet-gen
 *
 * No mocking: generates a real wallet, then independently reconstructs a wallet from *just* its
 * mnemonic — the same building blocks `generateWallet` itself uses, called fresh, exactly what a
 * real "restore from phrase" flow would do — and checks the two resolve to the identical Arweave
 * address. This is the actual property a recovery phrase promises, and the reason it's tested this
 * way rather than just asserting `generateWallet()` doesn't throw: this exact test caught a real
 * bug during development (see `generate.ts`'s module doc comment) where the address silently
 * failed to round-trip because of a Node `Buffer` pooling mistake in a dependency.
 */

import { describe, expect, it } from 'vitest';
import { generateWallet, mnemonicToSeed, pemToJwk, rsaKeyPairFromSeed } from './generate';
import { isValidAddress, jwkToAddress } from './address';

const GEN = process.env.SWIFTDRIVE_WALLET_GEN === '1';

describe.skipIf(!GEN)('wallet generation', () => {
  it(
    'derives the same address from a wallet and its own recovery phrase',
    async () => {
      const { mnemonic, jwk } = await generateWallet();

      expect(mnemonic.trim().split(/\s+/)).toHaveLength(12);
      expect(jwk.kty).toBe('RSA');

      const address = await jwkToAddress(jwk);
      expect(isValidAddress(address)).toBe(true);

      const recoveredSeed = await mnemonicToSeed(mnemonic);
      const { privateKey } = await rsaKeyPairFromSeed(recoveredSeed);
      const recoveredJwk = await pemToJwk(privateKey);
      const recoveredAddress = await jwkToAddress(recoveredJwk);

      expect(recoveredAddress).toBe(address);
    },
    180_000,
  );
});
