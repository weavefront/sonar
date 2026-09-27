/**
 * Wallet signature acquisition for private-drive key derivation, and the v1/v2 bridge.
 *
 * Two distinct signature schemes feed the KDF (see `kdf.ts` and `crypto-spec.md`):
 *
 *   - **v1**: a raw RSA-PSS/SHA-256 signature over the signing key, saltLength 0.
 *   - **v2**: the signature on an ANS-104 DataItem wrapping the signing key, also saltLength 0.
 *     Building that DataItem correctly (tag encoding, signature-data hashing) is genuinely
 *     fiddly to hand-roll, so this reuses `@dha-team/arbundles` — already a resolved dependency
 *     via `@ardrive/turbo-sdk` from milestone 2 — dynamically imported so a read-only session
 *     never pays for it.
 *
 * Both must be **deterministic**: the same drive must always derive the same key. RSA-PSS is only
 * deterministic at saltLength 0, so every signing call below requests it explicitly rather than
 * trusting a default — confirmed necessary by reading Wander's own `signDataItem` docs, which
 * state a *default* salt length is used unless `options` are passed explicitly.
 */

import { t } from '../../i18n/translate';
import { deriveDriveKey, signingKeyFor, type Bytes, type DerivedKey } from './kdf';
import { decryptBytes } from './cipher';
import { ArweaveGql, RESILIENT_DATA_GATEWAYS, queryFirst } from '../gql';
import { fetchBinaryBody } from '../metadata';
import { parseStub, Tag, type DriveEntity } from '../types';
import type { WalletState } from '../../wallet/store';

export class SignatureUnavailableError extends Error {}

/**
 * Thrown when a v1 drive's `drive-signature` bridge entity exists (so we *know* the real
 * signature is wrapped inside it) but its body couldn't be fetched. This must never be treated as
 * "wrong password" — falling through to recompute a fresh `v1Signature()` here would derive a
 * different key than the one that actually encrypted the drive, since the whole reason the bridge
 * exists is that a freshly recomputed legacy signature isn't guaranteed to match the original
 * (see the module doc comment). A real-world case that surfaced this: `arweave.net` alone
 * (`DEFAULT_DATA_GATEWAYS`) returned a 404 for a bridge entity's data tx that `turbo-gateway.com`
 * served instantly — the tx was real and correct, just not (yet, or ever) mirrored to that one
 * gateway. The fetch below already tries both for exactly this reason.
 */
export class BridgeDataUnavailableError extends Error {}

type SigningWallet = Pick<WalletState, 'mode' | 'canSign' | 'jwk'>;

// The legacy `arconnect` ambient types (see wallet/store.ts) don't declare `signDataItem` at
// all — it postdates that package. Declared locally rather than fought into the global merge.
interface WanderDataItemSigner {
  signDataItem(
    dataItem: {
      owner: string;
      target: string;
      anchor: string;
      data: Uint8Array;
      tags: { name: string; value: string }[];
    },
    options?: { saltLength: number },
  ): Promise<ArrayBuffer | Uint8Array>;
  getActivePublicKey(): Promise<string>;
}

/** An Arweave (RSA-4096) signature is exactly 512 bytes — an ANS-104 sigType-1 constant. */
const ARWEAVE_SIGNATURE_BYTES = 512;

/**
 * The single tag ArDrive puts on the drive-signature DataItem. Verified verbatim against
 * `ardrive-web`'s `lib/core/crypto/crypto.dart`:
 *
 *     final dataItem = DataItem.withBlobData(data: message, owner: owner);
 *     dataItem.addTag('Action', 'Drive-Signature-V2');
 *
 * The tag is part of the DataItem's signed deep-hash, so it is key material in effect: change it
 * and every derived drive key changes with it.
 */
const V2_SIGNATURE_TAGS = [{ name: 'Action', value: 'Drive-Signature-V2' }] as const;

/**
 * Bump on any change to what gets sent to `signDataItem`. Reported in `SignatureTrace.v` purely so
 * a bug report proves which build produced it — a stale cached bundle and a genuine failure look
 * identical otherwise, and that ambiguity has already cost a debugging round on this feature.
 */
const SIGNATURE_REQUEST_VERSION = 3;

/**
 * Byte length of an `ArrayBuffer` or a typed array, whichever `signDataItem` returned.
 *
 * Wander hands back an `ArrayBuffer`, which has `byteLength` but **no** `length` — reading
 * `.length` there yields `undefined`, which is exactly how the first diagnostic trace of this bug
 * gave itself away (the field was silently missing from the report rather than showing a number).
 */
function byteLengthOf(buf: ArrayBuffer | Uint8Array): number {
  return buf instanceof Uint8Array ? buf.length : buf.byteLength;
}

/**
 * Take the raw 512-byte RSA signature out of a signed DataItem, exactly as ArDrive does:
 *
 *     // Signature stored after first two bytes, and arweave sig length is 512
 *     var signature = signed.slice(2, 514);
 *     return new Uint8Array(signature);
 *
 * (`ardrive-web/web/js/arconnect.js`.) Deliberately a plain slice rather than an arbundles
 * `DataItem` parse: it is what the reference implementation does, it works identically on an
 * `ArrayBuffer` or a `Uint8Array`, and it cannot fail for any reason unrelated to the bytes we
 * actually need.
 */
function rawSignatureFromSignedDataItem(signed: ArrayBuffer | Uint8Array): Bytes {
  const signature = new Uint8Array(signed.slice(2, 2 + ARWEAVE_SIGNATURE_BYTES)) as Bytes;
  if (signature.length !== ARWEAVE_SIGNATURE_BYTES) {
    throw new SignatureUnavailableError(
      `Wallet returned ${byteLengthOf(signed)} bytes from signDataItem — too short to contain a signature.`,
    );
  }
  return signature;
}

/**
 * Step-by-step record of what the unlock actually did, filled in as it goes.
 *
 * Every failure mode below — a wrong password, a wallet returning an unexpected signature shape, a
 * gateway 404, the bridge entity not being found — collapses into the same single symptom for the
 * user ("that password doesn't match this drive"), because a wrong key is indistinguishable from a
 * wrong password by design: AES-GCM's auth tag only says "no". This trace is what makes those
 * cases tellable apart afterwards, and it is deliberately made of facts (byte counts, ids, which
 * branch ran) rather than conclusions.
 */
export interface SignatureTrace {
  /** Bumped whenever this file's signing request changes — proves which build a report came from. */
  v?: number;
  walletMode?: string;
  /** The *connected* wallet. Must equal `owner` below, or we're signing with the wrong key. */
  walletAddress?: string;
  driveId?: string;
  /** The drive transaction's owner — whose key the drive was actually encrypted against. */
  owner?: string;
  /**
   * Only probed after a failed unwrap: whether signing the same request twice returns the same
   * bytes. RSA-PSS is deterministic only at salt length 0, so `false` here would mean no password
   * could ever work and the fault is entirely in how the wallet is being asked to sign.
   */
  v2SignatureStable?: boolean;
  /** The drive's `Signature-Type` tag, or 'absent' — decides v2-native vs the v1/bridge path. */
  signatureTypeTag?: string;
  /** Length of the wallet's public key string — 0/absent means `owner` never reached the wallet. */
  ownerKeyChars?: number;
  signDataItemReturnedBytes?: number;
  v2SignatureBytes?: number;
  bridgeFound?: boolean;
  bridgeTxId?: string;
  bridgeFetchedBytes?: number;
  bridgeDecrypted?: boolean;
  recoveredSignatureBytes?: number;
  scheme?: SignatureScheme;
  metadataFetchedBytes?: number;
  metadataDecrypted?: boolean;
}

/** Compact single-line rendering, for pasting into a bug report. */
export function formatTrace(trace: SignatureTrace): string {
  return Object.entries(trace)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
}

async function importJwkPrivateKey(jwk: object): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
}

/** v1: a raw saltLength-0 RSA-PSS signature over the signing key. */
export async function v1Signature(wallet: SigningWallet, driveId: string): Promise<Bytes> {
  const message = signingKeyFor(driveId);

  if (wallet.mode === 'wander') {
    if (!window.arweaveWallet) throw new SignatureUnavailableError(t('error.extensionUnavailable'));
    // This is the API Wander deprecated in ArConnect 1.0.0 — see crypto-spec.md. Still the only
    // way to reach a v1 drive with no drive-signature bridge entity.
    return (await window.arweaveWallet.signature(message, { name: 'RSA-PSS', saltLength: 0 })) as Bytes;
  }
  if (wallet.mode === 'keyfile') {
    if (!wallet.jwk) throw new SignatureUnavailableError(t('error.keyFileNotInSession'));
    const privateKey = await importJwkPrivateKey(wallet.jwk);
    const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 0 }, privateKey, message);
    return new Uint8Array(sig) as Bytes;
  }
  throw new SignatureUnavailableError(t('error.sessionCannotSign'));
}

/** v2: the signature on an ANS-104 DataItem wrapping the signing key. */
export async function v2Signature(
  wallet: SigningWallet,
  driveId: string,
  trace?: SignatureTrace,
): Promise<Bytes> {
  const message = signingKeyFor(driveId);
  const tags = V2_SIGNATURE_TAGS.map((t) => ({ ...t }));
  const { createData, ArweaveSigner } = await import('@dha-team/arbundles');

  if (wallet.mode === 'wander') {
    if (!window.arweaveWallet) throw new SignatureUnavailableError(t('error.extensionUnavailable'));
    const api = window.arweaveWallet as unknown as WanderDataItemSigner;

    // Every field below is inside the ANS-104 deep hash that gets signed, so the request has to
    // match ArDrive's byte for byte or the signature — and therefore the drive key — comes out
    // different for the same wallet and password. Mirrors `ardrive-web/web/js/arconnect.js`:
    //
    //     const jsDataItem = { owner, target, anchor, data, tags };
    //     await window.arweaveWallet.signDataItem(jsDataItem, { saltLength: 0 });
    //
    // `owner` is the one that actually bit: omitting it (and letting the wallet fill in its own
    // public key) is *not* equivalent, because the wallet hashes the item as given. `target` and
    // `anchor` are empty strings rather than omitted for the same reason — a missing anchor is
    // conventionally randomised, which would make the key differ on every attempt.
    const owner = await api.getActivePublicKey();
    if (trace) trace.ownerKeyChars = owner?.length ?? 0;

    // `{ saltLength: 0 }` exactly — not `{ name: 'RSA-PSS', saltLength: 0 }`. RSA-PSS is only
    // deterministic at salt length 0, and this is the shape the reference implementation sends.
    const signedBytes = await api.signDataItem(
      { owner, target: '', anchor: '', data: message, tags },
      { saltLength: 0 },
    );
    if (trace) trace.signDataItemReturnedBytes = byteLengthOf(signedBytes);
    const sig = rawSignatureFromSignedDataItem(signedBytes);
    if (trace) trace.v2SignatureBytes = sig.length;
    return sig;
  }

  if (wallet.mode === 'keyfile') {
    if (!wallet.jwk) throw new SignatureUnavailableError(t('error.keyFileNotInSession'));
    const signer = new ArweaveSigner(wallet.jwk as never);
    // ArweaveSigner's default sign() doesn't pin saltLength (Node's OpenSSL default applies),
    // which is not deterministic. Override with the same fix ardrive-core-js uses, via native
    // WebCrypto rather than Node's polyfilled `crypto.createSign` — one less moving part.
    const privateKey = await importJwkPrivateKey(wallet.jwk);
    (signer as unknown as { sign: (msg: Uint8Array) => Promise<Uint8Array> }).sign = async (msg) => {
      const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 0 }, privateKey, msg as BufferSource);
      return new Uint8Array(sig);
    };
    const item = createData(message, signer, { tags });
    await item.sign(signer);
    return new Uint8Array(item.rawSignature) as Bytes;
  }

  throw new SignatureUnavailableError(t('error.sessionCannotSign'));
}

// ---------------------------------------------------------------------------
// Bridge resolution
// ---------------------------------------------------------------------------

export type SignatureScheme = 'v1' | 'v2';

export interface ResolvedSignature {
  signature: Bytes;
  scheme: SignatureScheme;
}

/**
 * Get the signature that feeds `deriveDriveKey`, following ArDrive's own resolution order:
 * `Signature-Type` tag → `drive-signature` bridge entity → legacy `signature()` fallback.
 *
 * The bridge case derives a full v2 *drive key* purely to unwrap the stored v1 signature — the
 * drive's actual content stays encrypted under the v1-derived key throughout. See the milestone 3
 * plan for the full trace through `ardrive-core-js`'s `deriveDriveKey`.
 */
export async function resolveDriveSignature(
  drive: DriveEntity,
  wallet: SigningWallet,
  password: string,
  gql: ArweaveGql = new ArweaveGql(),
  fetchImpl?: typeof fetch,
  trace: SignatureTrace = {},
): Promise<ResolvedSignature> {
  trace.v = SIGNATURE_REQUEST_VERSION;
  trace.walletMode = wallet.mode ?? 'none';
  trace.driveId = drive.entityId;
  trace.owner = drive.owner;
  trace.signatureTypeTag = drive.signatureType ?? 'absent';

  if (drive.signatureType === '2') {
    trace.scheme = 'v2';
    return { signature: await v2Signature(wallet, drive.entityId, trace), scheme: 'v2' };
  }

  const bridgeEdge = await queryFirst(gql, {
    tags: [
      { name: Tag.driveId, values: [drive.entityId] },
      { name: Tag.entityType, values: ['drive-signature'] },
    ],
    owners: [drive.owner],
    sort: 'HEIGHT_DESC',
  }).catch(() => null);
  trace.bridgeFound = Boolean(bridgeEdge);

  if (bridgeEdge) {
    const stub = parseStub(bridgeEdge.node);
    trace.bridgeTxId = stub?.metadataTxId ?? bridgeEdge.node.id;
    if (stub?.cipherIv) {
      const v2 = await v2Signature(wallet, drive.entityId, trace);
      const wrapperKey = await deriveDriveKey(v2, password);
      // `turbo-gateway.com` as a fallback: it's the origin gateway for anything uploaded through
      // Turbo (which is how this bridge entity was almost certainly written), so it can have data
      // `arweave.net` hasn't mirrored yet — confirmed live against a real bridge entity that
      // `arweave.net` 404'd on but this gateway served without issue.
      const ciphertext = await fetchBinaryBody(stub.metadataTxId, {
        gateways: RESILIENT_DATA_GATEWAYS,
        ...(fetchImpl ? { fetchImpl } : {}),
      }).catch(() => null);
      trace.bridgeFetchedBytes = ciphertext?.length ?? 0;
      if (ciphertext) {
        // Recorded either way: whether the *bridge* unwrapped tells apart "the v2 signature and
        // password are both right, something later went wrong" from "the key was wrong all along".
        try {
          const recovered = await decryptBytes(stub.cipherIv, wrapperKey, ciphertext);
          trace.bridgeDecrypted = true;
          trace.recoveredSignatureBytes = recovered.byteLength;
          trace.scheme = 'v1';
          return { signature: new Uint8Array(recovered) as Bytes, scheme: 'v1' };
        } catch (err) {
          trace.bridgeDecrypted = false;
          // Only on failure, and only once: re-sign the identical request and compare. If the
          // wallet returns different bytes for the same input it is not signing deterministically
          // (RSA-PSS is stable only at salt length 0), which would mean no password could ever
          // unwrap this bridge and the fault is wholly in the signing request — worth one extra
          // wallet prompt to distinguish that from a genuinely mistyped password.
          try {
            const again = await v2Signature(wallet, drive.entityId);
            trace.v2SignatureStable = again.length === v2.length && again.every((b, i) => b === v2[i]);
          } catch {
            /* the probe is best-effort; never let it mask the real failure below */
          }
          throw err;
        }
      }
      // The bridge exists but we couldn't read it — do NOT fall through to v1Signature() below;
      // see BridgeDataUnavailableError's doc comment for why that would silently derive the wrong
      // key and misreport a network problem as "wrong password".
      throw new BridgeDataUnavailableError(
        t('error.bridgeUnavailable'),
      );
    }
  }

  trace.scheme = 'v1';
  return { signature: await v1Signature(wallet, drive.entityId), scheme: 'v1' };
}

export { importJwkPrivateKey };
export type { DerivedKey };
