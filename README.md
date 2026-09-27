# Swiftdrive

A fast, lightweight browser for files stored on Arweave via **ArFS** — the same protocol ArDrive
uses. Connect the wallet you already use with ArDrive and your drives appear, because Swiftdrive
reads the same on-chain data rather than any private index.

**Status: milestone 4 (full read + write for public and private drives) plus image thumbnails.**
See [Scope](#scope) for what is and isn't implemented yet.

```bash
npm install
npm run dev
```

## Why it's faster

ArDrive's web app is a Flutter build with a heavy startup cost. But the deeper problem is in the
protocol, and it's where all the engineering here went.

ArFS stores an entity's identifying data in Arweave transaction *tags*, and its **name, size and
data pointer in the transaction body**. GraphQL returns tags cheaply and in bulk; bodies need one
HTTP fetch each. So listing a drive costs one fetch per file, and that dominates everything.

Measured against mainnet:

| | |
|---|---|
| Serial body fetches | 4.56 s/item → 500 files ≈ **38 minutes** |
| Warm cache (revisit) | **0 fetches**, 11 ms to first row painted |

Five things exploit that, cheapest first:

1. **Immutable content cache.** A metadata body is addressed by transaction ID and can never
   change, so it's cached in IndexedDB forever with no invalidation. Revisiting a drive costs zero
   body fetches — asserted by a test, not assumed.
2. **Incremental sync.** The last synced block height is recorded per drive; later syncs query
   only above it. Steady state is one cheap query returning nothing.
3. **One query for many entity types.** The gateway ORs values within a tag filter, so drives,
   folders and files come back in a single paginated query instead of three.
4. **Block-sharded cold sync.** Cursor pagination is a serial chain of ~2 s round-trips, so a
   first sync splits the drive's block range into six chunks walked concurrently.
5. **Root priming.** The drive entity and the root folder's direct children are fetched up front,
   so the first screen appears quickly however large the drive is.

Plus a **rate-limit-aware fetch pool** (below), progressive rendering, and a virtualized list.

Bundle: **98 KB gzipped JS + 6 KB CSS** for the read path — unaffected by milestone 2's Turbo SDK,
milestone 3's crypto/arbundles work, or milestone 4's encrypted-write orchestration, all lazy (or,
for encrypted writes, statically imported but weightless until called — see below) and verified
(via the browser's own resource timing, not assumed) to load zero bytes during a pure read-only
session. Thumbnail generation (`createImageBitmap`/canvas) is a native browser API, not a
dependency, so it added no measurable bundle weight either. No
`ardrive-core-js` in the browser —
it's Node-oriented and pulls in `jwk-to-pem`, `futoin-hkdf` and `arbundles`. ArFS is a tag-and-JSON
convention, so reading it directly is both smaller and byte-compatible.

### The gateway is the real constraint

Public gateways rate-limit hard. Measured from a browser against `arweave.net`, sustained:

| Concurrency | Throughput | Success rate |
|---|---|---|
| 8 | 2.1 items/s | 87% |
| 16 | 4.5 items/s | 55% |
| 32 | 8.8 items/s | 53% |
| 48 | 11.5 items/s | 53% |

The failures are HTTP **429**, not network errors. A short burst at 48-way looks great in
isolation (0.163 s/item, 100/100 successful) and is completely misleading — that measurement is
what an earlier version of this code was tuned on, and it was wrong.

**Data gateways are not GraphQL gateways.** `permagate.io` answers GraphQL fine but times out on
`/{txId}`, so the two lists are kept separate (`DEFAULT_GATEWAYS` vs `DEFAULT_DATA_GATEWAYS`).
Round-robining data fetches across a gateway that cannot serve them made every other request burn
the full fetch timeout before failing over — measured at **~0.3 entities/s**, versus **~13/s**
once data fetches were pinned to gateways that actually serve data. If you add gateways, verify
they serve `/{txId}` before putting them in the data list.

So body fetches go through an **adaptive gate** using AIMD, the control law TCP uses: add a slot
after a run of successes, halve on a 429, with jittered backoff and a global cooldown. It converges
on whatever the gateway will currently serve instead of assuming a number. The gate is global —
shared across the six cold-sync shards — because six pools of 48 means ~288 concurrent requests to
one host, which exhausts the browser's connection pool and wedges the sync.

**Consequence, stated plainly:** the first sync of a very large drive (thousands of files) is
bounded by the gateway's rate limit, not by this client. It is slow, and no amount of client
concurrency fixes it. Subsequent visits are instant.

## Correctness notes

ArFS is **append-only**: renaming or moving a file writes a *new* metadata transaction reusing the
same File-Id. Current state is the newest revision per entity ID — block height first, `Unix-Time`
to break ties, transaction ID as a final deterministic tiebreak, and a pending transaction counts
as newer than anything mined. Getting this wrong is the classic ArFS client bug: stale filenames,
or a file reappearing in the folder it was moved out of.

Two deliberate choices about not losing data:

- **An unreadable body never deletes a file.** If a metadata body can't be fetched, the entity is
  still listed and marked *"Metadata not retrievable from gateway"*, and unresolved entities are
  retried at the start of each sync. Dropping them would make files silently vanish whenever a
  gateway got busy.

  This is not hypothetical. Rate limiting causes it transiently — but some drives are worse: in
  one real drive tested (`e0307ae3…`), **572 of 576** metadata transactions return HTTP **404**
  from arweave.net despite existing in the index. Those files are genuinely unretrievable there,
  and showing them as unavailable is the honest result; silently hiding them would misreport the
  drive as nearly empty.
- **Entities are only trusted from the drive owner's address.** Anyone can post a transaction
  carrying someone else's Drive-Id, so every query filters by `owners`.

The app also tolerates old data: live mainnet still serves `ArFS 0.11` drives alongside `0.15`,
often without the `Drive-Privacy` tag.

## Writing: uploads, drives, folders, renames, moves

Every mutation — a new file, a new folder or drive, a rename, a move, a hide — is the same
operation underneath: sign a JSON body (or file bytes) with the right ArFS tags and upload it via
Turbo. ArFS is append-only, so "rename" and "move" aren't special cases; they're just a new
metadata transaction reusing the same File-Id/Folder-Id. That meant the entire write path needed
**zero changes** to `tree.ts`'s revision reduction from milestone 1 — a pending write's `height:
null` already outranks a mined one in `isNewerRevision`, so a just-created file shows up
immediately, and a later real sync of the same transaction converges without duplicating it.

Tags were verified byte-for-byte against ArDrive's own tag assembler
(`ardrive-core-js/src/arfs/tags/tag_assembler.ts` + `arfs_tag_settings.ts` +
`tx/arfs_prototypes.ts`), including a detail that's easy to get backwards: a file's **data** item
carries no `ArFS`/`Entity-Type` tag at all, only `Content-Type` and the app tags — only the
**metadata** item is an ArFS entity.

**No ArDrive community tip.** Uploads cost only actual Turbo storage — the tip is ArDrive's own
courtesy payment to their team, not an ArFS validity requirement.

**Signing changes what the wallet layer holds.** A read-only session needs nothing but an address.
Writing needs a key: for Wander, `ArconnectSigner` wraps the extension directly and this app never
sees key material. For a key file, the parsed JWK is now held **in memory only** — never written to
`localStorage` or IndexedDB — so a page reload keeps the address (read-only) but drops the key;
signing requires re-selecting the file. Worth flagging plainly: `ArconnectSigner` (the only browser
wallet signer Turbo SDK ships, from `@dha-team/arbundles`) calls Wander's **deprecated**
`signature()` API — the same deprecation-window API from milestone 1's private-drive research.
That's an upstream constraint, not a shortcut taken here.

**Verified against Turbo's real production API**, with a throwaway zero-balance wallet (no funds
at risk): created a drive, uploaded two files, and independently confirmed all four transactions
via Turbo's own status endpoint —

```
$ curl https://upload.ardrive.io/tx/<metadata-tx-id>/status
{"status":"CONFIRMED","info":"new","winc":"0"}
```

Every write came back `CONFIRMED` at `winc: 0` — genuinely free under Turbo's small-file tier, with
correct ArFS tags, correct two-transaction file model, and the optimistic entity appearing in the
UI before any confirmation. GraphQL indexing (and therefore visibility in ArDrive's own app) lags
Turbo's own confirmation by some minutes, which is normal bundle-finalization time, not a defect.

**The lazy Turbo chunk is large — 1.18 MB gzipped — and that's an upstream packaging fact, not a
tuning problem.** `@dha-team/arbundles`'s browser entry unconditionally pulls in the full Ethereum
(`@ethersproject/*`) and Solana/Bitcoin (`secp256k1`, `keccak`, `bs58`) signer stacks even though
this app only uses the Arweave signer; they're re-exported from one barrel module, so tree-shaking
can't remove them without upstream restructuring the package. What actually matters — confirmed by
inspecting the browser's own resource timing — is that it costs **nothing** for anyone who only
browses: the chunk loads on first write interaction and never before, verified with zero
Turbo/arbundles bytes downloaded during a pure read-only session.

## Private drives

Enter a drive's password and its folders, filenames, and file contents decrypt in your browser via
native WebCrypto — no crypto library needed. The derivation (`src/arfs/crypto/kdf.ts`) is the exact
one `crypto-spec.md` recorded from `ardrive-core-js`, including the v1/v2 signature bridge for
drives created before ArFS 0.15: `Signature-Type` tag → `drive-signature` bridge entity → legacy
`signature()` fallback, matching ArDrive's own resolution order.

**Verified two ways, since no official test vectors exist for this:**

1. **Independent cross-implementation check.** `kdf.cross-check.test.ts` reimplements
   `ardrive-core-js`'s actual `deriveDriveKey`/`generateWalletSignatureV1` using Node's built-in
   `crypto` directly — not this app's code — runs a fresh throwaway wallet through both
   implementations, and asserts byte-identical output. Passes on every run, with a new random key
   each time (nothing here could be a cherry-picked fixture).
2. **Live, against a real mainnet private drive.** Queried a real ArDrive user's actual private
   drive (owner `E5dKUal1…`, `Signature-Type: 2`) and ran this app's full unlock pipeline against
   it — real GraphQL lookup, real ciphertext fetch, real RSA-PSS signing, real AES-GCM decrypt
   attempt — using a wallet that (correctly) isn't the real owner's. Result: `wrong-password` in
   1.5 real seconds, not a crash or a false positive. Also confirmed against 10 real private drives
   and 10 real `drive-signature` bridge entities on mainnet that every tag this code depends on
   (`Signature-Type`, `Cipher`, `Cipher-IV`, `Drive-Auth-Mode`) matches exactly what real ArDrive
   writes.

**A real bug this surfaced, worth recording:** a throwaway test JWK — corrupted by repeated
copy-paste of a ~700-character base64 field across many manual browser commands — had an internally
inconsistent `dq` CRT parameter (`d mod (q−1) ≠ dq`). Chrome's `crypto.subtle.importKey` correctly
rejected it; Node's PEM-based signing path (used by Turbo/arbundles in milestone 2) does not
cross-validate CRT parameters and had silently tolerated it. Confirmed as a test-fixture artifact,
not an app bug, by regenerating the key cleanly in-browser via `crypto.subtle.generateKey` (zero
copy-paste) and rerunning the exact same real-drive test successfully.

**A write-safety fix that mattered:** milestone 2's write path has no encryption story — it writes
plaintext ArFS metadata. Milestone 3 makes private drives newly *browsable* with real row content
(not a locked placeholder), which meant the existing "can this session sign" check for showing
upload/rename/move/hide controls was no longer sufficient — it said nothing about whether the
*currently open drive* was private. Fixed by gating every write affordance on the drive's own
privacy, not just signing capability, with a second check at the row level as well: renaming a
decrypted private file through milestone 2's plaintext writer would have silently leaked its real
name (or, for a new upload, its actual bytes) onto a permanent public chain, inside what the user
believes is a private drive. Milestone 4 closes that gap for real, below.

Private drive password is remembered **in memory only** for the session — same treatment as the
milestone 2 key-file JWK — cleared on disconnect or reload, never written to `localStorage` or
IndexedDB.

## Encrypted writes

Milestone 4 gives private drives the same write feature set public drives already had: create a
new private drive, upload encrypted files (including whole folder structures), and rename, move,
and hide/unhide entities inside an unlocked private drive — all AES-256-GCM, all built on the exact
same `deriveDriveKey`/`deriveFileKey`/`decryptJson` primitives milestone 3 already had verified for
reading. A new drive always signs `Signature-Type: 2` — there's no reason to create a new v1 drive
today, so drive creation never touches the v1/v2 bridge at all; that stays a pure read-side concern
for opening *other* people's older drives.

**Tag shapes verified against `ardrive-core-js`'s actual prototypes**
(`ArFSPrivateDriveMetaDataPrototype`/`ArFSPrivateFolderMetaDataPrototype`/
`ArFSPrivateFileMetaDataPrototype`/`ArFSPrivateFileDataPrototype`, `src/arfs/tx/arfs_prototypes.ts`)
rather than assumed: every private transaction — metadata *and* data — carries `Content-Type:
application/octet-stream` (never `application/json`, since the body is ciphertext), and a file's
*data* transaction is always tagged octet-stream regardless of the file's real MIME type, since
that's only knowable after decrypting the (also encrypted) metadata. `Drive-Privacy`,
`Drive-Auth-Mode`, and `Signature-Type` are drive-only tags; a folder or file's privacy is inferred
purely from the presence of a `Cipher` tag, exactly as the read path has relied on since milestone 1.

**Whole-file buffering, deliberately.** WebCrypto has no browser streaming AES-GCM API, so
encrypting a file for upload buffers the whole thing in memory first (unlike a public upload, which
streams straight off disk). Every encrypted file uses AES-256-GCM regardless of size — ArDrive's
own client switches to AES-256-CTR above 100 MiB, but the read path here never implemented CTR
(nothing needed it), and the `Cipher` tag on each transaction says exactly which algorithm was
used, so ArDrive still decrypts a large file from this app correctly either way. Adding CTR now
would be a second cipher mode with manual counter/chunk management for zero read-path benefit.

**Verified live against Turbo's production API**, throwaway zero-balance wallet, no funds at risk:
created a real private drive (root folder + drive metadata, `Signature-Type: 2`, real v2 ANS-104
signing via `@dha-team/arbundles`), then uploaded a real encrypted file into it. Every transaction
came back `CONFIRMED` at `winc: 0`, same free small-file tier as milestone 2. Reopening the file's
details — a genuine fresh fetch from a live gateway, not local cache — decrypted its real name,
size, and content type correctly, proving the exact write-then-read loop end-to-end against mainnet
data rather than only against unit tests. The file's encrypted *data* transaction was independently
confirmed retrievable too (fetched directly from `permagate.io` and decrypted via an out-of-band
Node script that re-derives the same keys from scratch — see below); it just hadn't propagated to
`arweave.net` (the app's only configured data gateway) or been GraphQL-indexed on either gateway by
the time of testing, which is Arweave/Turbo propagation latency, not an app defect — the same
"GraphQL lags Turbo confirmation" fact already noted in milestone 2, extended here to sometimes
apply to raw body availability per-gateway too.

**Independent re-derivation, again.** Beyond the in-process unit tests (which exercise the real
`v2Signature`/`deriveDriveKey`/`deriveFileKey`/`encryptJson` functions against a freshly generated
throwaway RSA-4096 key on every run), the live-uploaded file was decrypted a second time entirely
outside the app: a standalone Node script reconstructed the same ANS-104 DataItem signature via
`@dha-team/arbundles` and Node's `webcrypto`, re-derived the drive and file keys via the same
HKDF steps, and fetched the real ciphertext from `permagate.io` directly — the same
cross-implementation discipline as milestone 3's KDF check, just pointed at genuinely new data this
milestone produced rather than a pre-existing fixture.

## Image thumbnails

Image rows show a real thumbnail instead of a generic icon, preferring ArDrive's own thumbnail
format when a file already has one — a real ArDrive user's existing photos show their real
thumbnails immediately, not something this app invents.

**The format, verified against `ardriveapp/ardrive-web`'s actual Dart source**
(`lib/entities/file_entity.dart`'s `Thumbnail`/`Variant` classes,
`lib/drive_explorer/thumbnail/repository/thumbnail_repository.dart`) rather than guessed: a file's
metadata JSON gains an optional `thumbnail: { variants: [{ name, txId, size, width, height }] }`
field, and the thumbnail's bytes live in their own separate data transaction — the same
two-transaction shape as a normal file, just a second, smaller one. Private drives encrypt the
thumbnail transaction with the **same file key** as the main data (not a separate key) — confirmed
from ArDrive's own `getFileKey` call in that repository file.

**Reading:** a file with a real thumbnail uses it (decrypted with the file key for private drives,
same shape as the existing `fetchAndDecryptFileData`). A public image with no thumbnail falls back
to the full image itself — cheap, the browser just renders it small. A private image with no
thumbnail stays icon-only rather than decrypting the whole file just to paint a row: a folder of
private photos would otherwise mean decrypting every one of them just to scroll past them, the
exact kind of unbounded-cost-on-scroll problem the rest of this app has always avoided.

**Writing:** every image this app uploads gets a real thumbnail generated client-side
(`createImageBitmap` + canvas, max dimension 480px, JPEG quality ~0.82 — reasonable defaults, not
part of ArDrive's interop contract, which only specifies the JSON shape) and uploaded as its own
transaction using the exact same tag builders as a normal file's data — no new tag shape needed.
Generation or upload failures are caught and skipped; a thumbnail is a nice-to-have; it never
blocks the real upload.

**Verified live against Turbo's production API.** Uploaded a real (canvas-generated) image to a
real public drive with a throwaway wallet; independently fetched the resulting thumbnail
transaction directly from a gateway and confirmed it decodes as a real 24×24 JPEG — the exact
dimensions of the source image, since `computeThumbnailDimensions` never upscales. The private path
(same code, an extra encryption step) is covered by real-crypto unit tests exercising the same
`uploadNewPrivateFile` thumbnail path end-to-end (generate → encrypt with the real file key →
decrypt → assert the plaintext matches); the live private upload succeeded and priced identically
to the public one, but confirming its ciphertext independently ran into the same GraphQL-indexing
lag already documented above, not a new issue.

## Scope

**Working now:** wallet connect (Wander/ArConnect, key file, watch-only address), drive listing,
folder browsing with deep-linkable URLs, drive-wide search, sort, file details with full version
history, inline preview (image/video/audio/PDF/text/markdown/code), image thumbnails (preferring
ArDrive's own format, generated automatically on upload), download, share links, responsive
desktop/mobile layouts, light and dark themes, drag-and-drop upload (files and, via a
`webkitdirectory` picker, whole folder structures), create drive/folder, rename, move, hide/unhide,
Turbo balance display, cost preview before every signed write, private drive decryption (browse,
preview, download), and encrypted writes — create a private drive, upload encrypted files and
folder structures, and rename/move/hide inside an unlocked private drive, full parity with the
public-drive write path.

**Not yet:** buying Turbo credits in-app (top up on Turbo's own site if balance is short),
drag-and-drop folder structure preservation (use the folder picker button for that), AES-256-CTR
for private files over 100 MiB (every encrypted file uses AES-256-GCM regardless of size — see
[Encrypted writes](#encrypted-writes) for why that's still fully ArDrive-compatible), retroactive
thumbnail creation for files already uploaded without one (thumbnails are generated at upload time
only, matching this pass's scope).

## Architecture

The protocol layer is plain TypeScript with no React imports — independently testable, and
reusable by a CLI.

```
src/
  arfs/         types · gql · metadata · tree · sync · pool    read-path protocol, no React
  arfs/write/   tags · entities                                write-path protocol (public + private), no React
  arfs/crypto/  kdf · signature · cipher · fileData             private-drive encrypt/decrypt, no React
  turbo/        client (lazy Turbo SDK) · upload orchestration
  cache/        IndexedDB (txBodies | entities | syncState)
  wallet/       connection, signing, address derivation
  state/        zustand stores + the useWriteAction hook
  ui/           components
```

`@dha-team/arbundles` (needed for ANS-104 DataItem construction in the v2 signature scheme) is
dynamically imported only when a private drive is actually being unlocked — same lazy-loading
discipline as Turbo SDK, and it lands in its own separate chunk from Turbo's, so unlocking a
private drive doesn't pull in the Turbo SDK weight either.

The cache can never hang the app: `openDB` blocks indefinitely if another tab holds the database
or a delete is pending, so opening is bounded by a timeout and falls back to in-memory maps.

## Tests

```bash
npm test          # unit tests, no network — includes the KDF cross-implementation check
npm run test:live # golden test against a real mainnet drive
```

The live test runs against drive `bd55904b…`, chosen because it is genuinely nasty and typical: it
is ArFS 0.11, one folder was written parentless and later re-parented into the root, and one file
has three revisions pointing at three different data transactions. A client that mishandles
revision ordering fails it visibly.

`npm test` also runs `kdf.cross-check.test.ts` (see [Private drives](#private-drives)), which
regenerates a fresh throwaway RSA key and re-derives a drive key through two independent
implementations on every run — the closest thing available to a known-answer test when no official
one exists upstream.
