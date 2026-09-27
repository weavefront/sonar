/**
 * Independent re-derivation check against `ardrive-core-js`'s actual key derivation.
 *
 * No fixed known-answer test vector exists upstream for ArFS private-drive keys, so this is the
 * strongest verification available: reimplement `ardrive-core-js/src/utils/crypto.ts`'s
 * `deriveDriveKey`/`deriveFileKey`/`generateWalletSignatureV1` using Node's built-in `crypto`
 * directly (not this app's code), run a fresh throwaway wallet through both implementations, and
 * assert byte-identical output. If this app's WebCrypto implementation and ardrive-core-js's
 * Node implementation ever disagree, this is where it would surface.
 *
 * Deliberately self-contained rather than a checked-in fixture: a fresh random key and drive/file
 * ID are generated on every run, so nothing here could be an accidental cherry-pick.
 */

import { createPrivateKey, createSign, generateKeyPairSync, hkdfSync, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deriveDriveKey, deriveFileKey, uuidToBytes } from './kdf';
import { v1Signature } from './signature';

function referenceUuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

/** ardrive-core-js's generateWalletSignatureV1, reimplemented directly against Node's crypto. */
function referenceV1Signature(jwk: JsonWebKey, message: Buffer): Buffer {
  const pem = createPrivateKey({ key: jwk as never, format: 'jwk' }).export({ type: 'pkcs1', format: 'pem' });
  const sign = createSign('sha256');
  sign.update(message);
  return sign.sign({ key: pem as string, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: 0 });
}

/** ardrive-core-js's deriveDriveKey/deriveFileKey — futoin-hkdf with no explicit salt defaults to 32 zero bytes. */
function referenceHkdf(ikm: Buffer, info: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(32), info, 32));
}

describe('KDF cross-check against an independent reference implementation', () => {
  it('derives byte-identical drive and file keys for a fresh throwaway wallet', async () => {
    const { privateKey: nodeKey } = generateKeyPairSync('rsa', { modulusLength: 4096, publicExponent: 0x10001 });
    const jwk = nodeKey.export({ format: 'jwk' }) as JsonWebKey & { kty: string };
    jwk.kty = jwk.kty || 'RSA';

    const driveId = randomUUID();
    const fileId = randomUUID();
    const password = 'correct horse battery staple';
    const signingKey = Buffer.concat([Buffer.from('drive', 'utf8'), referenceUuidBytes(driveId)]);

    // --- Reference path: Node crypto only, no code from this app ---
    const refSignature = referenceV1Signature(jwk, signingKey);
    const refDriveKey = referenceHkdf(refSignature, Buffer.from(password, 'utf8'));
    const refFileKey = referenceHkdf(refDriveKey, referenceUuidBytes(fileId));

    // --- This app's path: WebCrypto, exercised through the real production functions ---
    const appSignature = await v1Signature({ mode: 'keyfile', canSign: true, jwk: jwk as never }, driveId);
    expect(new Uint8Array(appSignature)).toEqual(new Uint8Array(refSignature));

    const appDriveKey = await deriveDriveKey(appSignature, password);
    expect(new Uint8Array(appDriveKey.raw)).toEqual(new Uint8Array(refDriveKey));

    const appFileKey = await deriveFileKey(appDriveKey, fileId);
    expect(new Uint8Array(appFileKey.raw)).toEqual(new Uint8Array(refFileKey));
  });

  it('uuidToBytes matches the reference hex-decode exactly', () => {
    const uuid = randomUUID();
    expect(new Uint8Array(uuidToBytes(uuid))).toEqual(new Uint8Array(referenceUuidBytes(uuid)));
  });
});
