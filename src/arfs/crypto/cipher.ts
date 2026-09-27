/**
 * AES-256-GCM decryption for ArFS private entities.
 *
 * Per the spec (see `crypto-spec.md`), ciphertext has the 16-byte GCM auth tag appended to the
 * end — exactly the layout `crypto.subtle.decrypt` expects for AES-GCM with the default
 * `tagLength: 128`, so no manual splitting is needed.
 */

import { t } from '../../i18n/translate';
import type { DerivedKey } from './kdf';

/** Thrown specifically for an auth-tag mismatch — the unambiguous "wrong password" signal. */
export class DecryptionFailedError extends Error {}

/**
 * Decode a `Cipher-IV` tag value into raw bytes.
 *
 * **The actual bug this project shipped with for weeks**: every real `Cipher-IV` value on chain is
 * base64**url** (`-`/`_`, no padding) — confirmed straight from the reference implementation,
 * `arweave-dart`'s `decodeBase64ToBytes`: `base64Url.decode(base64Url.normalize(base64))`. This
 * function used plain `atob()`, which only accepts the standard alphabet (`+`/`/`) and **throws**
 * on `-`/`_`. Two real IVs pulled from mainnet during debugging — `-wiGuOxWUWD-aoFo` and
 * `5qRR5m7TPkE_wdX_` — both reproduce the throw.
 *
 * The throw itself wasn't the visible symptom, though: `decryptBytes` below wraps this call in a
 * `try`, so the `atob` exception was caught and re-thrown as `DecryptionFailedError` — the exact
 * same error type a genuine wrong password produces. There is no way to tell "the IV didn't even
 * parse" apart from "the auth tag didn't match" from the outside; both look like "wrong password"
 * to a user, for two completely unrelated reasons. `-`/`_` normalization here first means the real
 * failure mode (a bad key) is the *only* one left that can reach that error path.
 *
 * Normalizing unconditionally is safe for standard base64 too (`-`/`_` never appear in it), so this
 * one function correctly decodes both flavors rather than needing to guess which was used.
 */
export function ivFromTag(cipherIv: string): Uint8Array<ArrayBuffer> {
  const normalized = cipherIv.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length) as Uint8Array<ArrayBuffer>;
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Decrypt a ciphertext blob with a derived key. Throws `DecryptionFailedError` on an auth-tag
 * mismatch — GCM authenticates on decrypt, so a wrong key/password fails loudly and specifically
 * rather than silently returning garbage plaintext.
 */
export async function decryptBytes(cipherIv: string, key: DerivedKey, ciphertext: BufferSource): Promise<ArrayBuffer> {
  try {
    return await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivFromTag(cipherIv) }, key.aesKey, ciphertext);
  } catch (err) {
    throw new DecryptionFailedError(
      err instanceof Error ? err.message : t('error.decryptionFailed'),
    );
  }
}

/** Decrypt and UTF-8-decode a JSON body — the common case for drive/folder/file metadata. */
export async function decryptJson<T>(cipherIv: string, key: DerivedKey, ciphertext: BufferSource): Promise<T> {
  const plaintext = await decryptBytes(cipherIv, key, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/**
 * Encode 12 raw IV bytes as the `Cipher-IV` tag expects: base64**url**, no padding — matching
 * `arweave-dart`'s `encodeBytesToBase64` (`base64Url.encode(bytes).replaceAll('=', '')`), the
 * actual convention every real ArFS entity on chain uses. `ivFromTag` above accepts either flavor
 * on read, but there's no reason for anything *we* write to be the odd one out.
 */
function ivToTag(iv: Uint8Array): string {
  return btoa(String.fromCharCode(...iv)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encrypt a plaintext blob with a derived key, generating a fresh random 12-byte IV per call —
 * GCM requires a unique IV per encryption under the same key, never reused. The direct inverse of
 * `decryptBytes`: same tag-ready base64 IV encoding, same "auth tag appended to ciphertext" layout
 * `crypto.subtle.encrypt` produces by default.
 */
export async function encryptBytes(
  key: DerivedKey,
  plaintext: BufferSource,
): Promise<{ ciphertext: ArrayBuffer; cipherIv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key.aesKey, plaintext);
  return { ciphertext, cipherIv: ivToTag(iv) };
}

/** Serialize a value to JSON and encrypt it — the common case for drive/folder/file metadata. */
export async function encryptJson(
  key: DerivedKey,
  value: unknown,
): Promise<{ ciphertext: ArrayBuffer; cipherIv: string }> {
  return encryptBytes(key, new TextEncoder().encode(JSON.stringify(value)));
}
