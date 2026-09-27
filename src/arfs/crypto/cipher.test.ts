import { describe, expect, it } from 'vitest';
import { decryptBytes, decryptJson, DecryptionFailedError, encryptBytes, encryptJson, ivFromTag } from './cipher';
import { deriveDriveKey } from './kdf';
import type { DerivedKey } from './kdf';

describe('ivFromTag', () => {
  it('decodes a standard base64 Cipher-IV tag into 12 raw bytes', () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const b64 = btoa(String.fromCharCode(...iv));
    expect([...ivFromTag(b64)]).toEqual([...iv]);
  });

  it('decodes a base64url Cipher-IV tag — the actual on-chain convention', () => {
    // The regression this guards: every real Cipher-IV tag is base64url (arweave-dart's
    // `decodeBase64ToBytes` is `base64Url.decode(base64Url.normalize(base64))`), and plain
    // `atob()` throws on `-`/`_`. These are two real values pulled from mainnet — an ArDrive
    // drive's own metadata IV and its drive-signature bridge entity's IV — that reproduced the
    // throw during debugging. The throw wasn't the visible symptom: it was caught by
    // `decryptBytes`'s try/catch and relabeled `DecryptionFailedError`, indistinguishable from a
    // genuine wrong password, for a drive whose password was correct the entire time.
    for (const b64url of ['-wiGuOxWUWD-aoFo', '5qRR5m7TPkE_wdX_']) {
      expect(() => atob(b64url)).toThrow(); // proves this case is real, not hypothetical
      expect(ivFromTag(b64url)).toHaveLength(12);
    }
  });

  it('round-trips a base64url IV to the exact bytes it encodes', () => {
    // -wiGuOxWUWD-aoFo, byte-for-byte, computed independently via Node's Buffer (base64url mode)
    // rather than by reusing this module's own encode side.
    const expected = [...Buffer.from('-wiGuOxWUWD-aoFo', 'base64url')];
    expect([...ivFromTag('-wiGuOxWUWD-aoFo')]).toEqual(expected);
  });
});

/** Encrypts via raw WebCrypto directly — bypassing this module — to produce a real ArFS-shaped blob. */
async function encryptLikeArFS(
  key: DerivedKey,
  plaintext: Uint8Array<ArrayBuffer>,
): Promise<{ cipherIv: string; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key.aesKey, plaintext);
  return { cipherIv: btoa(String.fromCharCode(...iv)), ciphertext };
}

describe('decryptBytes', () => {
  it('round-trips plaintext encrypted independently of this module', async () => {
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    // aesKey is decrypt-only per kdf.ts's design; encrypt with an equivalent key derived from the
    // same raw bytes so this test can produce ciphertext without widening the real key's usages.
    const encryptKey = await crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['encrypt']);
    const plaintext = new TextEncoder().encode('hello private drive');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptKey, plaintext);
    const cipherIv = btoa(String.fromCharCode(...iv));

    const result = await decryptBytes(cipherIv, key, ciphertext);
    expect(new TextDecoder().decode(result)).toBe('hello private drive');
  });

  it('throws DecryptionFailedError — not a generic error — on a wrong key', async () => {
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'right-password');
    const wrongKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'wrong-password');
    const encryptKey = await crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['encrypt']);
    const { cipherIv, ciphertext } = await (async () => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptKey, new TextEncoder().encode('secret'));
      return { cipherIv: btoa(String.fromCharCode(...iv)), ciphertext: ct };
    })();

    await expect(decryptBytes(cipherIv, wrongKey, ciphertext)).rejects.toThrow(DecryptionFailedError);
  });

  it('this is the correct, unambiguous "wrong password" signal — not a heuristic', async () => {
    // Restated as its own test: a truncated/corrupted ciphertext (simulating a bit-flip, not just
    // a wrong key) must also fail loudly via the auth tag, never silently return garbage.
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const encryptKey = await crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['encrypt']);
    const { cipherIv, ciphertext } = await encryptLikeArFS({ ...key, aesKey: encryptKey }, new TextEncoder().encode('x'));
    const corrupted = new Uint8Array(ciphertext);
    corrupted[0] = corrupted[0]! ^ 0xff;

    await expect(decryptBytes(cipherIv, key, corrupted)).rejects.toThrow(DecryptionFailedError);
  });
});

describe('decryptJson', () => {
  it('decrypts and parses a JSON body', async () => {
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const encryptKey = await crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['encrypt']);
    const body = JSON.stringify({ name: 'secret-folder.txt', isHidden: false });
    const { cipherIv, ciphertext } = await encryptLikeArFS(
      { ...key, aesKey: encryptKey },
      new TextEncoder().encode(body),
    );

    const parsed = await decryptJson<{ name: string; isHidden: boolean }>(cipherIv, key, ciphertext);
    expect(parsed).toEqual({ name: 'secret-folder.txt', isHidden: false });
  });
});

describe('encryptBytes', () => {
  it('round-trips through this module\'s own decryptBytes using the key\'s dual-usage aesKey directly', async () => {
    // Unlike the tests above, this doesn't build a separate encrypt-only key — since M4, a
    // DerivedKey's aesKey supports both roles, which is exactly what write call sites rely on.
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const plaintext = new TextEncoder().encode('round trip me');

    const { ciphertext, cipherIv } = await encryptBytes(key, plaintext);
    const decrypted = await decryptBytes(cipherIv, key, ciphertext);

    expect(new TextDecoder().decode(decrypted)).toBe('round trip me');
  });

  it('decrypts correctly with raw WebCrypto too — not just this module\'s own decryptBytes', async () => {
    // Cross-check bypassing this module on the read side, mirroring the discipline in
    // kdf.cross-check.test.ts: proves encryptBytes produces a real ArFS-shaped blob (12-byte IV,
    // auth tag appended), not something only this module's own decrypt happens to accept back.
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const plaintext = new TextEncoder().encode('cross-checked');

    const { ciphertext, cipherIv } = await encryptBytes(key, plaintext);
    const iv = ivFromTag(cipherIv);
    expect(iv).toHaveLength(12);

    const decryptKey = await crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, decryptKey, ciphertext);
    expect(new TextDecoder().decode(decrypted)).toBe('cross-checked');
  });

  it('never reuses an IV across calls with the same key', async () => {
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const a = await encryptBytes(key, new TextEncoder().encode('x'));
    const b = await encryptBytes(key, new TextEncoder().encode('x'));
    expect(a.cipherIv).not.toBe(b.cipherIv);
  });

  it('writes cipherIv as base64url with no padding — the real ArFS convention, not just standard base64', async () => {
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const { cipherIv } = await encryptBytes(key, new TextEncoder().encode('x'));
    expect(cipherIv).not.toContain('+');
    expect(cipherIv).not.toContain('/');
    expect(cipherIv).not.toContain('=');
  });
});

describe('encryptJson', () => {
  it('is the direct inverse of decryptJson', async () => {
    const key = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const value = { name: 'top-secret.pdf', size: 4096, isHidden: true };

    const { ciphertext, cipherIv } = await encryptJson(key, value);
    const parsed = await decryptJson<typeof value>(cipherIv, key, ciphertext);

    expect(parsed).toEqual(value);
  });
});
