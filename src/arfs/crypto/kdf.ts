/**
 * ArFS private-drive key derivation — WebCrypto only, no crypto library needed.
 *
 * Verified against `ardrive-core-js`'s `deriveDriveKey`/`deriveFileKey` (see
 * `src/arfs/crypto-spec.md` and the milestone 3 plan for the full derivation trace, including the
 * v1/v2 bridge). The one non-obvious implementation detail: WebCrypto keys are algorithm-scoped,
 * so a single opaque `CryptoKey` can't serve as both "the AES-GCM key that decrypts this entity's
 * metadata" and "the HKDF input for deriving the next key down." Both derivations below produce
 * raw bytes first, then import those bytes twice — once per role.
 */

// TS's DOM lib types WebCrypto's BufferSource as ArrayBufferView<ArrayBuffer> specifically (not
// the wider ArrayBufferLike a bare `Uint8Array` return type infers as), so byte-producing helpers
// here are pinned to this concrete type — every one of them is backed by a fresh `new
// ArrayBuffer`/`new Uint8Array(n)`, never a SharedArrayBuffer, so this is just narrowing, not a
// behavior change.
export type Bytes = Uint8Array<ArrayBuffer>;

const HKDF_SALT: Bytes = new Uint8Array(32); // ArFS's HKDF salt is always 32 zero bytes.
const KEY_BYTE_LENGTH = 32;

const utf8 = (s: string): Bytes => new TextEncoder().encode(s);

/** Parse a hyphenated UUID string into its 16 raw bytes — the KDF uses raw bytes, not the string. */
export function uuidToBytes(uuid: string): Bytes {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`Not a UUID: "${uuid}"`);
  const bytes: Bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** The message that gets signed to produce a drive's wallet signature: utf8("drive") || driveId bytes. */
export function signingKeyFor(driveId: string): Bytes {
  const prefix = utf8('drive');
  const idBytes = uuidToBytes(driveId);
  const out: Bytes = new Uint8Array(prefix.length + idBytes.length);
  out.set(prefix, 0);
  out.set(idBytes, prefix.length);
  return out;
}

/**
 * A derived key in both roles it might be needed for: decrypting this entity's own ciphertext,
 * and (for a drive key only) deriving the next key down via HKDF.
 */
export interface DerivedKey {
  raw: ArrayBuffer;
  /** Non-extractable, encrypt+decrypt. */
  aesKey: CryptoKey;
  /** Non-extractable, deriveBits-only — undefined for file keys, which derive nothing further. */
  hkdfKey?: CryptoKey;
}

async function hkdfDeriveBits(ikm: BufferSource, info: BufferSource): Promise<ArrayBuffer> {
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info },
    baseKey,
    KEY_BYTE_LENGTH * 8,
  );
}

async function toDerivedKey(raw: ArrayBuffer, needsHkdfRole: boolean): Promise<DerivedKey> {
  // ['encrypt', 'decrypt']: M3 only ever read, but M4's writes need to encrypt with this same key.
  const aesKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  if (!needsHkdfRole) return { raw, aesKey };
  const hkdfKey = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveBits']);
  return { raw, aesKey, hkdfKey };
}

/**
 * `driveKey = HKDF-SHA256(ikm=signature, salt=zeros(32), info=utf8(password), 32 bytes)`
 *
 * `signature` is whatever `resolveDriveSignature` (signature.ts) produced — a v1 signature for a
 * v1 or bridged drive, a v2 signature for a v2-native drive. This function doesn't know or care
 * which; the bridge's "wrapper key" is just another call to this same function with the v2
 * signature, per the reference implementation.
 */
export async function deriveDriveKey(signature: BufferSource, password: string): Promise<DerivedKey> {
  const raw = await hkdfDeriveBits(signature, utf8(password));
  return toDerivedKey(raw, true);
}

/** `fileKey = HKDF-SHA256(ikm=driveKey, salt=zeros(32), info=uuidBytes(fileId), 32 bytes)` */
export async function deriveFileKey(driveKey: DerivedKey, fileId: string): Promise<DerivedKey> {
  if (!driveKey.hkdfKey) throw new Error('deriveFileKey needs a drive key derived with HKDF capability');
  const raw = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: uuidToBytes(fileId) },
    driveKey.hkdfKey,
    KEY_BYTE_LENGTH * 8,
  );
  return toDerivedKey(raw, false);
}
