/**
 * Arweave address utilities.
 *
 * An Arweave address is the base64url-encoded SHA-256 of the RSA modulus (`n`) from the wallet's
 * JWK. That's the whole derivation — no library needed, just WebCrypto.
 */

/** Arweave addresses are always 43 base64url characters (32 bytes encoded). */
import { t } from '../i18n/translate';

const ADDRESS_RE = /^[A-Za-z0-9_-]{43}$/;

export function isValidAddress(value: string): boolean {
  return ADDRESS_RE.test(value.trim());
}

export function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface Jwk {
  kty?: string;
  n?: string;
  d?: string;
}

/** Derive the wallet address from a JWK's modulus. */
export async function jwkToAddress(jwk: Jwk): Promise<string> {
  if (!jwk.n) throw new Error(t('error.notKeyFile'));
  const digest = await crypto.subtle.digest('SHA-256', base64UrlDecode(jwk.n) as BufferSource);
  return base64UrlEncode(new Uint8Array(digest));
}

/** Shorten an address for display: `abcd1234…wxyz6789`. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
