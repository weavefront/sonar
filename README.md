# Sonar

A fast file browser for **Arweave**, built on **ArFS**, the same open protocol ArDrive uses.
Connect the wallet you already use with ArDrive and your drives show up. Sonar reads the same
on-chain data directly. It does not use a private index.

It all runs in your browser. There's no backend, no account, and no server that sees your files
or keys.

```bash
npm install
npm run dev
```

## Features

**Wallets**
- Connect with the **Wander** extension (formerly ArConnect) or an Arweave **key file**. You can
  also browse **watch-only** by pasting any address.
- **Create a new wallet** in the browser: a 12-word BIP39 recovery phrase deterministically
  derives an RSA-4096 Arweave key. The same phrase always recovers the same wallet.

**Drives and files**
- Public and **private drives**. Private drives unlock with the drive password and decrypt in the
  browser (AES-256-GCM via WebCrypto). Both v1 and v2 drive signatures are supported.
- Upload files and whole folder structures (drag and drop, or the folder picker) through
  **Turbo**. Every signed write shows a cost preview and your Turbo balance first.
- Create drives and folders. Rename, move, hide and unhide. All of these work in private drives
  too, fully encrypted.
- Full **version history** for every file, since ArFS is append-only.

**Browsing**
- **List**, **Icon** and **Dense** views, with adjustable tile sizes in Icon view.
- Drive-wide search, sorting, and deep-linkable folder URLs.
- Inline preview of images, video, audio, PDF, text, markdown and code, plus a full-screen
  lightbox.
- **Thumbnails.** Sonar uses ArDrive's own on-chain thumbnail variants when a file has them.
  Otherwise it generates a sharp local thumbnail once, sized to the tile, and caches it in
  IndexedDB. Every image you upload gets an ArDrive-compatible thumbnail automatically.
- Copy buttons for File ID, Data TX and Metadata TX in the details panel.

**Sharing and downloading**
- **Read-only share links** for public folders, scoped to one folder or the folder plus its
  subfolders. A share link needs no wallet, no signing and no cost.
- **Batch download** of a selection or a whole folder as a ZIP. In Chromium browsers it streams
  straight to disk, so it isn't limited by memory.

**Everywhere**
- 12 languages: English, Deutsch, Español, Français, Bahasa Indonesia, 日本語, 한국어, Português
  (Brasil), Русский, Türkçe, Tiếng Việt and 简体中文.
- Light and dark themes, a responsive desktop and mobile layout, and installable PWA metadata.

## Why it's fast

ArFS keeps an entity's IDs in transaction *tags*, but its **name, size and data pointer live in
the transaction body**. GraphQL returns tags cheaply in bulk, but each body is a separate HTTP
fetch. So listing a drive costs one fetch per file, and that dominates everything. Fetching bodies
one at a time against mainnet was measured at about 4.5 s per item. For 500 files, that's more
than half an hour.

Sonar attacks that from several directions:

1. **Immutable content cache.** A metadata body is addressed by its transaction ID and can never
   change, so it's cached in IndexedDB forever with no invalidation. Revisiting a drive makes
   **zero** body fetches, and a test asserts it.
2. **Incremental sync.** The last synced block height is stored per drive, and later syncs query
   only above it. In steady state, a sync is one cheap query that returns nothing.
3. **One query for many entity types.** Drives, folders and files come back in one paginated query,
   not three.
4. **Block-sharded cold sync.** Cursor pagination is a serial chain of round-trips, so a first sync
   splits the drive's block range into shards and walks them concurrently.
5. **Root priming.** The root folder's direct children are fetched first, so the first screen
   appears quickly however big the drive is.
6. **Rate-limit-aware fetching.** Public gateways rate-limit hard, and the failures are HTTP 429s,
   not network errors. Body fetches go through one global **adaptive gate** (AIMD, the control law
   TCP uses). It adds a slot after a run of successes, halves on a 429, and backs off with jitter.
   It settles at whatever the gateway will serve right now instead of guessing a number.

Add progressive rendering and a virtualized file list, and even large folders scroll smoothly.

**The honest limit:** the *first* sync of a very large drive is bound by the gateway's rate limit,
not by this client. No amount of client concurrency fixes that. Later visits are instant.

## Correctness

- **Newest revision wins.** Renaming or moving writes a new metadata transaction that reuses the
  same entity ID. Current state is the newest revision per ID: block height first, then
  `Unix-Time`, then transaction ID as a deterministic tiebreak. A pending write counts as newer
  than anything mined, so your own changes appear immediately and merge cleanly once mined.
- **Only the owner's entities are trusted.** Anyone can post a transaction carrying someone else's
  Drive-Id, so every query filters by the drive owner's address.
- **An unreadable body never hides a file.** If a metadata body can't be fetched, the file is still
  listed and marked unavailable. Each later sync retries it through a second gateway. Some real
  drives have metadata that gateways genuinely can't serve, and showing that is the honest result.
- **Old data is fine.** Mainnet still serves `ArFS 0.11` drives next to `0.15` ones, often without
  a `Drive-Privacy` tag, and Sonar reads both.
- **Tags match ArDrive byte for byte.** Write-path tags were checked against `ardrive-core-js`.
  Thumbnail metadata matches the shape ArDrive's web app reads.

## Security

- **Key material is never persisted.** A key file's JWK and a private drive's password are held in
  memory only. They're never written to `localStorage` or IndexedDB. After a reload you keep your
  address for browsing, but you need to re-select the key file to sign. With Wander, Sonar never
  sees the key at all.
- **Writes to private drives are always encrypted.** Every write action checks the privacy of the
  open drive, so a private file's name or bytes can't leak through the plaintext write path.
- **Decrypted content is sandboxed.** Decrypted private files are shown as `blob:` URLs. A private
  file only renders in a PDF viewer when it really is a PDF, never as arbitrary HTML.
- **ZIP downloads are sanitized.** Every path segment is cleaned, so a file named `../../.bashrc`
  can't escape the download folder (Zip Slip).
- **No tip, no tracking.** Uploads cost only the actual Turbo storage. There's no ArDrive community
  tip, no analytics and no third-party requests beyond Arweave gateways, Turbo and Google Fonts.

## Deployment

`npm run build` produces **one self-contained file**, `dist/index.html`, with all code, styles, the
icon and the byline font inlined. Routing uses the URL hash, so no server rewrites are needed.
Serve it from anywhere, including Arweave itself.

The trade-off: the upload stack (Turbo SDK and arbundles) is inlined too, so the file is about
6 MB (about 1.7 MB gzipped). It's still loaded lazily, though. That code doesn't *run* until you
first upload or unlock a private drive.

## Development

```bash
npm run dev              # dev server with HMR
npm test                 # unit tests, no network
npm run test:live        # golden test against a real mainnet drive
npm run test:wallet-gen  # slow: real deterministic RSA-4096 wallet generation
npm run typecheck
npm run build            # dist/index.html
```

A few tests are worth knowing about:

- `kdf.cross-check.test.ts` reimplements ArDrive's drive-key derivation using Node's own `crypto`.
  It runs a fresh random wallet through both implementations and asserts byte-identical output on
  every run. That's the closest thing to a known-answer test, since there are no official vectors.
- `live.test.ts` uses a deliberately messy real drive. It's `ArFS 0.11`, has a folder re-parented
  after creation, and has a file with three revisions pointing at three different data
  transactions. A client that gets revision ordering wrong fails it visibly.
- The i18n tests check that every locale has every key (also enforced by the type system) and
  keeps the same `{placeholders}` as English.

### Layout

The protocol layer is plain TypeScript with no React imports. You can test it on its own, and a
CLI could reuse it.

```
src/
  arfs/          gql · metadata · tree · sync · pool · download   read path, no React
  arfs/write/    tags · entities · thumbnail                      write path, public + private
  arfs/crypto/   kdf · signature · cipher · fileData              private-drive crypto
  turbo/         lazy Turbo SDK client · upload orchestration
  cache/         IndexedDB: bodies, entities, sync state, local thumbnails
  wallet/        connection, signing, wallet generation
  state/         zustand stores
  i18n/          translations for 12 locales
  ui/            React components
```

Stack: React 19, TypeScript, Vite, Tailwind CSS v4, zustand, wouter, TanStack Virtual and
client-zip.

## Not yet

- Buying Turbo credits in the app. Top up on Turbo's own site for now.
- Keeping folder structure on drag and drop. Use the folder picker button for that.
- AES-256-CTR for private files over 100 MiB. Sonar encrypts every file with AES-256-GCM, and each
  transaction's `Cipher` tag records which algorithm was used, so ArDrive still decrypts it.

## License

Sonar is dedicated to the **public domain** under [CC0 1.0 Universal](LICENSE). You can copy,
modify, distribute and use it for any purpose, including commercially, without asking permission
or giving credit.

**Exceptions.** Two fonts are embedded in the source and stay under their own license, the
[SIL Open Font License 1.1](https://openfontlicense.org). CC0 does not cover them:

- **Basteleur** by Keussel, embedded in `src/styles.css` for the "by arweave.eth" byline.
- **Protest Guerrilla** by Octavio Pardo, a subset embedded in the favicon in `index.html`. The
  logo loads the full font from Google Fonts.

Dependencies installed through npm are not part of this repository. Each keeps its own license.
