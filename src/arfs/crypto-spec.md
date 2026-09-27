# ArFS private drive key derivation

**Implemented** in `src/arfs/crypto/` (`kdf.ts`, `signature.ts`, `cipher.ts`, `fileData.ts`) — both
reading/decrypting and writing/encrypting private drives, verified via an independent
cross-implementation check (`kdf.cross-check.test.ts`), live against a real mainnet private drive
(read), and live creation + upload against Turbo's production API (write). See the README's
[Private drives](../../README.md#private-drives) and [Encrypted writes](../../README.md#encrypted-writes)
sections for what that verification found, including two real things it surfaced along the way.

This file remains as the derivation reference it was written as before implementation, cross-checked
against ArDrive's own reference implementations, so the reasoning behind the code doesn't need to be
re-derived from source next time it's touched.

Sources cross-checked:

- `ardriveapp/ardrive-core-js` → `src/utils/crypto.ts` (TypeScript, canonical)
- `ardriveapp/ardrive-web` → `docs/private_drive_kdf_reference.dart` (Dart, the production web app)

## Derivation

```
signingKey = utf8("drive") || uuidBytes(driveId)     // 16 raw bytes, NOT the hyphenated string
driveKey   = HKDF-SHA256(ikm = walletSignature, salt = zeros, info = utf8(password), len = 32)
fileKey    = HKDF-SHA256(ikm = driveKey,        salt = zeros, info = uuidBytes(fileId), len = 32)
```

- **Drive key** decrypts drive and folder metadata.
- **File key** decrypts file metadata *and* file data.

### The signature must be deterministic

`walletSignature` is an RSA-PSS/SHA-256 signature over `signingKey` with **saltLength 0**. This is
not a detail — RSA-PSS with a random salt produces a different signature every call, which would
derive a different key every call. Zero salt is what makes the key stable.

Two schemes exist:

| | How the signature is produced |
|---|---|
| **v1** (pre-ArFS 0.15) | RSA-PSS / SHA-256 over `signingKey` directly, saltLength 0 |
| **v2** (ArFS 0.15+) | An ANS-104 DataItem whose data is `signingKey` and whose tags are `[{ Action: "Drive-Signature-V2" }]`; take the item's raw signature — bytes `2..514` of the serialised item |

### Salt equivalence

`ardrive-core-js` passes no salt to `futoin-hkdf`, which defaults to 32 zero bytes. The Dart
reference passes `Uint8List(1)` — a single zero byte. **These produce identical keys**: HMAC
zero-pads any key shorter than its 64-byte block size, so both become the same HMAC key. Either is
correct; WebCrypto requires an explicit salt, so pass 32 zero bytes.

## Encryption

AES-256-GCM, 12-byte IV taken from the `Cipher-IV` tag (base64), with the **16-byte auth tag
appended to the ciphertext**. That is exactly the layout WebCrypto expects, so
`crypto.subtle.decrypt` works on the raw blob with no surgery — the whole scheme is WebCrypto
native and needs no crypto library.

Files over 100 MiB use AES-256-CTR instead.

## The v1 problem in a browser

Wander deprecated `signature()` in ArConnect 1.0.0, and it is the only API that could produce a
raw saltLength-0 RSA-PSS signature. Without it, v1 drive keys cannot be derived in a browser at
all — which is precisely why ArFS 0.15 added the `drive-signature` entity, holding the v1
signature encrypted under the **v2** key.

Resolution order for opening a private drive:

1. Read the drive entity's `Signature-Type` tag.
2. If set, fetch the `drive-signature` entity, derive the v2 key, and decrypt it to recover the v1
   signature.
3. Otherwise fall back to the legacy `signature()` API if the wallet still offers it.
4. If neither is available, the drive must be upgraded in ArDrive first — say so explicitly rather
   than failing silently.

## Open question to verify before implementing

Whether Wander's `signDataItem()` signs with saltLength 0. `ardrive-core-js` explicitly overrides
`ArweaveSigner.sign` to force `saltLength: 0` and comments that this is "equivalent to Wander's
`signDataItem()`", which implies yes — and it must be true for v2 keys to be stable at all. It is
cheap to confirm empirically with a real wallet: derive the same drive key twice and check the
bytes match. Do this first; everything else depends on it.

## The v2 DataItem must match ArDrive's byte for byte

Read from `ardrive-web`'s `lib/core/crypto/crypto.dart` (`deriveDriveKey`) rather than inferred:

```dart
final message = Uint8List.fromList(utf8.encode('drive') + Uuid.parse(driveId));
final owner = await wallet.getOwner();
final dataItem = DataItem.withBlobData(data: message, owner: owner);
dataItem.addTag('Action', 'Drive-Signature-V2');
walletSignature = await wallet.signDataItem(dataItem);          // ArConnect/Wander path
...
final key = await hkdf.deriveKey(
  secretKey: SecretKey(walletSignature), info: utf8.encode(password), nonce: Uint8List(1));
```

and — the part that actually matters — its JS shim, `ardrive-web/web/js/arconnect.js`:

```js
const jsDataItem = { owner: owner, target: target, anchor: anchor, data: data, tags: jsTags };
var signed = await window.arweaveWallet.signDataItem(jsDataItem, { saltLength: 0 });
// Signature stored after first two bytes, and arweave sig length is 512
var signature = signed.slice(2, 514);
return new Uint8Array(signature);
```

Everything in that item — **owner**, target, anchor, tags, data — is inside the signed ANS-104 deep
hash, so all of it is key material in effect. Send the request in exactly this shape:

- **`owner` must be sent** (`getActivePublicKey()`). Omitting it and letting the wallet fill in its
  own key is *not* equivalent — the wallet hashes the item as given. This was the real cause of
  "that password doesn't match this drive" against genuinely correct passwords, and nothing else
  about it is observable: a wrong key and a wrong password are the same event to AES-GCM.
- **`target` and `anchor` are empty strings, never omitted** — a missing anchor is conventionally
  randomised, which would change the derived key on every attempt.
- **Options are `{ saltLength: 0 }`**, not `{ name: 'RSA-PSS', saltLength: 0 }`.
- **The signature is `signed.slice(2, 514)`.** Wander returns an `ArrayBuffer` — which has
  `byteLength` but no `length`, a difference that will silently read as `undefined` if you assume
  otherwise. A plain slice works on either shape and can't fail for unrelated reasons, so prefer it
  over an arbundles `DataItem` parse here.

See `signature.test.ts`, which pins all four.

## `Cipher-IV` is base64url, not base64

The real bug behind a long debugging chain, found only by decoding two *actual* `Cipher-IV`
values pulled from mainnet (`-wiGuOxWUWD-aoFo`, `5qRR5m7TPkE_wdX_`) and discovering plain `atob()`
throws on both. Confirmed against the reference implementation, `arweave-dart`'s `src/utils.dart`:

```dart
Uint8List decodeBase64ToBytes(String base64) =>
    base64Url.decode(base64Url.normalize(base64));
String encodeBytesToBase64(List<int> bytes) =>
    base64Url.encode(bytes).replaceAll('=', '');
```

Every `Cipher-IV` (and every other base64 tag value in ArFS) is base64**url** — `-`/`_`, no
padding — never standard base64. `ivFromTag` (`cipher.ts`) now normalizes `-`→`+`, `_`→`/` and pads
before calling `atob`, which correctly handles both flavors (normalization is a no-op on standard
base64, which never contains `-`/`_`). `ivToTag` now emits base64url too, matching what real ArFS
clients write.

**Why this was so hard to find**: the failure was two full layers removed from anything that looked
like the actual defect. `atob()`'s `DOMException` was caught by `decryptBytes`'s blanket `try/catch`
(there to correctly turn a *GCM auth-tag* failure into a clean `DecryptionFailedError`) and
re-thrown as the exact same error type a genuinely wrong password produces. A user saw "wrong
password"; the real event, three calls down, was a parse error on a tag value that never should
have reached that catch block's semantics at all. No amount of scrutinizing the *signature*
derivation (which was where three earlier debugging rounds looked, and where two real bugs
legitimately were) could ever have found this, because by the time it ran the signature was
already correct — this is a separate, later, unrelated step in the same function.

## Gateway availability is part of correctness here

`arweave.net` returns 404 for some transactions it has already indexed in GraphQL — confirmed live
against a real private drive whose *drive metadata* tx 404'd there while `turbo-gateway.com` (the
Turbo upload origin) served it instantly. A private drive's metadata and its `drive-signature`
bridge are each a single irreplaceable transaction, so one 404 makes the drive unopenable. Both
fetches use `RESILIENT_DATA_GATEWAYS` (see `gql.ts`) rather than the single default gateway. Note
this is deliberately *not* the default for bulk body fetches — `turbo-gateway.com` has been seen
taking 5–17s on transactions `arweave.net` serves instantly.

Relevant entity tags (see `types.ts`): `Cipher`, `Cipher-IV`, `Drive-Auth-Mode`,
`Signature-Type`, and `Entity-Type: drive-signature`.
