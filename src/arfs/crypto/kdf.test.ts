import { describe, expect, it } from 'vitest';
import { deriveDriveKey, deriveFileKey, signingKeyFor, uuidToBytes } from './kdf';

describe('uuidToBytes', () => {
  it('parses a hyphenated UUID into its 16 raw bytes', () => {
    const bytes = uuidToBytes('01020304-0506-0708-090a-0b0c0d0e0f10');
    expect(bytes).toHaveLength(16);
    expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('rejects a string that is not a UUID', () => {
    expect(() => uuidToBytes('not-a-uuid')).toThrow();
  });
});

describe('signingKeyFor', () => {
  it('is utf8("drive") followed by the 16 raw driveId bytes', () => {
    const driveId = '01020304-0506-0708-090a-0b0c0d0e0f10';
    const key = signingKeyFor(driveId);
    expect(key).toHaveLength(21); // "drive" (5) + 16
    expect(new TextDecoder().decode(key.slice(0, 5))).toBe('drive');
    expect([...key.slice(5)]).toEqual([...uuidToBytes(driveId)]);
  });
});

// A throwaway, meaningless "signature" for KDF math tests — this only exercises the HKDF/AES
// plumbing here, not real signature acquisition (that's covered by the cross-implementation check
// in the milestone 3 verification pass).
const fakeSignature = crypto.getRandomValues(new Uint8Array(512));

describe('deriveDriveKey', () => {
  it('is deterministic for the same signature and password', async () => {
    const a = await deriveDriveKey(fakeSignature, 'hunter2');
    const b = await deriveDriveKey(fakeSignature, 'hunter2');
    expect(new Uint8Array(a.raw)).toEqual(new Uint8Array(b.raw));
  });

  it('produces a different key for a different password', async () => {
    const a = await deriveDriveKey(fakeSignature, 'hunter2');
    const b = await deriveDriveKey(fakeSignature, 'different');
    expect(new Uint8Array(a.raw)).not.toEqual(new Uint8Array(b.raw));
  });

  it('produces a different key for a different signature', async () => {
    const other = crypto.getRandomValues(new Uint8Array(512));
    const a = await deriveDriveKey(fakeSignature, 'hunter2');
    const b = await deriveDriveKey(other, 'hunter2');
    expect(new Uint8Array(a.raw)).not.toEqual(new Uint8Array(b.raw));
  });

  it('returns a 32-byte key with both AES-GCM and HKDF capability', async () => {
    const key = await deriveDriveKey(fakeSignature, 'hunter2');
    expect(key.raw.byteLength).toBe(32);
    expect(key.aesKey.algorithm.name).toBe('AES-GCM');
    expect(key.hkdfKey?.algorithm.name).toBe('HKDF');
  });

  it('the same aesKey can both encrypt and decrypt — M4 writes need both roles from one key', async () => {
    const key = await deriveDriveKey(fakeSignature, 'hunter2');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('dual usage');

    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key.aesKey, plaintext);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key.aesKey, ciphertext);

    expect(new TextDecoder().decode(decrypted)).toBe('dual usage');
  });
});

describe('deriveFileKey', () => {
  it('is deterministic for the same drive key and file id', async () => {
    const driveKey = await deriveDriveKey(fakeSignature, 'hunter2');
    const fileId = '01020304-0506-0708-090a-0b0c0d0e0f10';
    const a = await deriveFileKey(driveKey, fileId);
    const b = await deriveFileKey(driveKey, fileId);
    expect(new Uint8Array(a.raw)).toEqual(new Uint8Array(b.raw));
  });

  it('produces a different key for a different file id', async () => {
    const driveKey = await deriveDriveKey(fakeSignature, 'hunter2');
    const a = await deriveFileKey(driveKey, '01020304-0506-0708-090a-0b0c0d0e0f10');
    const b = await deriveFileKey(driveKey, 'f0e0d0c0-0b0a-0908-0706-050403020100');
    expect(new Uint8Array(a.raw)).not.toEqual(new Uint8Array(b.raw));
  });

  it('produces a key with no further HKDF role — file keys derive nothing further', async () => {
    const driveKey = await deriveDriveKey(fakeSignature, 'hunter2');
    const fileKey = await deriveFileKey(driveKey, '01020304-0506-0708-090a-0b0c0d0e0f10');
    expect(fileKey.hkdfKey).toBeUndefined();
    expect(fileKey.aesKey.algorithm.name).toBe('AES-GCM');
  });

  it('rejects a drive key that was never given HKDF capability', async () => {
    // The bridge wrapper key case: deriveDriveKey always returns hkdfKey, so this guards a
    // programmer error (passing the wrong kind of key) rather than a real runtime path today.
    const driveKey = await deriveDriveKey(fakeSignature, 'hunter2');
    await expect(deriveFileKey({ ...driveKey, hkdfKey: undefined }, 'id')).rejects.toThrow();
  });
});
