/**
 * English — the source of truth for every other locale.
 *
 * `types.ts` derives `MessageKey`/`Messages` from this object, and every other locale is typed as
 * `Messages`, so a missing or misspelled key in any translation is a **compile error**, not a
 * silent fallback at runtime. That's the main reason this is one flat literal rather than nested
 * objects or a lazily-loaded JSON file.
 *
 * Two conventions worth keeping:
 *
 *  1. **Never interpolate a translatable word into a translatable sentence.** `Hide ${kind}` looks
 *     harmless in English but breaks everywhere with grammatical gender or case — German and
 *     Russian decline the noun, French/Spanish gender the article. So there's a whole `hideFile` /
 *     `hideFolder` pair instead of one key plus a spliced noun. Interpolating *data* (a file name,
 *     a count, a date) is fine and expected.
 *  2. **Counts go in `enPlurals`, not here.** See the comment on that export.
 */

export const en = {
  // ── Shared ────────────────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.continue': 'Continue',
  'common.close': 'Close',
  'common.copied': 'Copied',
  'common.or': 'or',
  'common.creating': 'Creating…',
  'common.confirmCreate': 'Confirm & create',
  'common.decrypting': 'Decrypting…',
  'common.stillConfirming': 'Uploaded — still confirming on Arweave. This can take a few minutes.',

  // ── App shell ─────────────────────────────────────────────────────────────
  'app.notFound': 'Page not found.',
  'app.tagline': 'A fast file browser for Arweave',
  'shell.watching': 'watching',
  'shell.exit': 'Exit',
  'theme.switchToLight': 'Switch to light theme',
  'theme.switchToDark': 'Switch to dark theme',
  'language.label': 'Language',

  // ── Modal chrome ──────────────────────────────────────────────────────────
  'modal.estimatingCost': 'Estimating cost…',
  'modal.cost': 'Cost: {amount}',

  // ── Connect screen ────────────────────────────────────────────────────────
  'connect.newToArweave': 'New to Arweave?',
  'connect.newToArweaveBody':
    "Get a wallet in one step — no signup, no email. You'll get a recovery phrase and a key file; keep either one safe and you're a Sonar user.",
  'connect.createWallet': 'Create a new wallet',
  'connect.alreadyHaveWallet': 'Already have a wallet?',
  'connect.alreadyHaveWalletBody':
    'Your existing ArDrive files appear here — Sonar reads the same ArFS data.',
  'connect.connecting': 'Connecting…',
  'connect.connectExtension': 'Connect wallet extension',
  'connect.connectWander': 'Connect Wander',
  // `{link}` is replaced with the "Install Wander" anchor — one key rather than three JSX
  // fragments so translations control where the link falls in the sentence.
  'connect.noExtension': 'No extension detected. {link}, or use one of the options below.',
  'connect.installWander': 'Install Wander',
  'connect.useKeyFile': 'Use a key file',
  'connect.keyFileNote':
    'Read-only: the address is derived in your browser and the key is discarded immediately.',
  'connect.viewAnyAddress': 'Or view any address',
  'connect.addressPlaceholder': '43-character Arweave address',
  'connect.view': 'View',
  'connect.privateDrivesNote':
    "Private drives work too — enter a drive's password to browse, preview, and write to it for this session. Nothing is ever saved.",

  // ── Drive list ────────────────────────────────────────────────────────────
  'driveList.title': 'Your drives',
  'driveList.searching': 'searching…',
  'driveList.newDrive': 'New drive',
  'driveList.refresh': 'Refresh',
  'driveList.loading': 'Loading drives',
  'driveList.empty': 'No drives found',
  'driveList.emptyBody':
    "This address doesn't own any ArFS drives yet, or they haven't been indexed.",
  'driveList.createdWithVersion': 'Created {date} · ArFS {version}',
  'driveList.privateDrives': 'Private drives',
  'driveList.unlockedCreated': 'Unlocked this session · created {date}',
  'driveList.encryptedCreated': 'Encrypted · created {date}',
  'driveList.open': 'Open',
  'driveList.unlock': 'Unlock',
  'driveList.needsSigning': 'Needs signing',
  'driveList.privateHintCanSign':
    'Enter a drive’s password to decrypt and browse it for this session — nothing is ever saved.',
  'driveList.privateHintWatchOnly':
    'Connect a wallet that can sign (not watch-only) to unlock a private drive.',

  // ── Drive browser ─────────────────────────────────────────────────────────
  'driveBrowser.privateCantShare': "This drive is private and can't be shared.",
  'driveBrowser.notPartOfShare': "This folder isn't part of this shared link.",
  'driveBrowser.goToParent': 'Go to parent folder',
  'driveBrowser.sharedFolder': 'Shared folder',
  'driveBrowser.drive': 'Drive',
  'driveBrowser.folder': 'Folder',
  'driveBrowser.shareFolder': 'Share this folder',
  'driveBrowser.resync': 'Resync drive',
  'driveBrowser.resyncTitle': 'Resync from the network',
  'driveBrowser.search': 'Search this drive',
  'driveBrowser.sortBy': 'Sort by',
  'driveBrowser.sortName': 'Name',
  'driveBrowser.sortSize': 'Size',
  'driveBrowser.sortModified': 'Modified',
  'driveBrowser.sortAscending': 'Sort ascending',
  'driveBrowser.sortDescending': 'Sort descending',
  'driveBrowser.readOnlyBanner': 'Shared folder · read-only',
  'driveBrowser.noMatches': 'Nothing matches “{query}”.',
  'driveBrowser.emptyFolder': 'This folder is empty.',
  'driveBrowser.loadingDrive': 'Loading this drive…',
  'driveBrowser.breadcrumb': 'Breadcrumb',
  'driveBrowser.listView': 'List view',
  'driveBrowser.iconView': 'Icon view',
  'driveBrowser.denseView': 'Dense view',
  'driveBrowser.layout': 'Layout',
  'driveBrowser.tilesSmall': 'Small tiles',
  'driveBrowser.tilesMedium': 'Medium tiles',
  'driveBrowser.tilesLarge': 'Large tiles',
  'driveBrowser.tileSize': 'Tile size',
  'driveBrowser.checkingUpdates': 'checking for updates',
  'driveBrowser.syncing': 'syncing {resolved}/{found}',
  'driveBrowser.syncFailed': 'sync failed — showing cached data',
  'driveBrowser.orphanedTitle': 'Entities whose parent folder could not be found',
  'driveBrowser.showHidden': 'Show hidden',
  'driveBrowser.hideHidden': 'Hide hidden',
  'driveBrowser.unresolvedMeta': 'Metadata not retrievable from gateway',
  'driveBrowser.encrypted': 'encrypted',
  'driveBrowser.folderWithDate': 'Folder · {date}',
  'driveBrowser.processingTitle':
    'Uploaded, but not yet confirmed on Arweave — this can take a few minutes.',
  'driveBrowser.processing': 'Processing',
  'driveBrowser.details': 'Details',

  // ── Details panel ─────────────────────────────────────────────────────────
  'details.forFile': 'Details for {name}',
  'details.close': 'Close details',
  'details.viewExpanded': 'View expanded',
  'details.preparingDownload': 'Preparing download…',
  'details.download': 'Download',
  'details.copyLink': 'Copy link',
  'details.copyValue': 'Copy {label}',
  'details.downloadError': 'Could not download this file: {error}',
  'details.size': 'Size',
  'details.type': 'Type',
  'details.modified': 'Modified',
  'details.uploaded': 'Uploaded',
  'details.path': 'Path',
  'details.fileId': 'File ID',
  'details.dataTx': 'Data TX',
  'details.metadataTx': 'Metadata TX',
  'details.block': 'Block',
  'details.arfs': 'ArFS',
  'details.pinnedFrom': 'Pinned from',
  'details.versionHistory': 'Version history',
  'details.current': 'current',
  'details.encryptedTag': '(encrypted)',

  // ── Row menu ──────────────────────────────────────────────────────────────
  'rowMenu.moreActions': 'More actions',
  'rowMenu.rename': 'Rename',
  'rowMenu.move': 'Move',
  'rowMenu.hide': 'Hide',
  'rowMenu.unhide': 'Unhide',

  // ── Hide / unhide dialog ──────────────────────────────────────────────────
  'hide.hideFileTitle': 'Hide file',
  'hide.hideFolderTitle': 'Hide folder',
  'hide.unhideFileTitle': 'Unhide file',
  'hide.unhideFolderTitle': 'Unhide folder',
  'hide.willHide':
    '“{name}” will be hidden from normal browsing (still visible with “Show hidden” on, and always readable directly from its transaction).',
  'hide.willUnhide': '“{name}” will show up in normal browsing again.',
  'hide.saving': 'Saving…',
  'hide.confirmHide': 'Confirm & hide',
  'hide.confirmUnhide': 'Confirm & unhide',

  // ── Create drive ──────────────────────────────────────────────────────────
  'createDrive.title': 'New drive',
  'createDrive.name': 'Drive name',
  'createDrive.namePlaceholder': 'My Drive',
  'createDrive.makePrivate': 'Make this drive private',
  'createDrive.password': 'Password',
  'createDrive.confirmPassword': 'Confirm password',
  'createDrive.passwordMismatch': "Passwords don't match.",
  // Irreversible-action warning — see the note in the i18n README about review priority.
  'createDrive.noRecovery':
    "There is no password recovery. If you lose this password, this drive's contents are gone forever — no one, including us, can get them back.",

  // ── Create folder ─────────────────────────────────────────────────────────
  'createFolder.title': 'New folder',
  'createFolder.name': 'Folder name',
  'createFolder.namePlaceholder': 'New folder',

  // ── Create wallet ─────────────────────────────────────────────────────────
  'createWallet.title': 'Create a new wallet',
  'createWallet.generating': 'Creating your wallet…',
  'createWallet.generatingNote':
    'This can take up to two minutes — your browser is generating real Arweave-compatible key material. Please keep this tab open.',
  'createWallet.error': 'Could not create a wallet: {error}',
  'createWallet.phraseLabel': 'Your 12-word recovery phrase',
  'createWallet.copyPhrase': 'Copy phrase',
  'createWallet.downloadKeyfile': 'Download key file',
  // Irreversible-action warning — see the note in the i18n README about review priority.
  'createWallet.warning':
    'This is the only copy. If you lose it, this wallet and everything in it are gone forever — no one, including us, can get it back. Sonar never stores it.',
  'createWallet.confirmSaved': "I've saved my seed phrase or key file",
  'createWallet.continuing': 'Continuing…',
  'createWallet.continueToApp': 'Continue to Sonar',

  // ── Rename / move ─────────────────────────────────────────────────────────
  'rename.fileTitle': 'Rename file',
  'rename.folderTitle': 'Rename folder',
  'rename.renaming': 'Renaming…',
  'rename.confirm': 'Confirm & rename',
  'move.title': 'Move {name}',
  'move.destination': 'Destination folder',
  'move.moving': 'Moving…',
  'move.confirm': 'Confirm & move',

  // ── Private-drive password ────────────────────────────────────────────────
  'password.title': 'Unlock private drive',
  'password.prompt': 'Enter the password for {name}.',
  'password.placeholder': 'Drive password',
  'password.wrong': "That password doesn't match this drive.",
  'password.technicalDetails': 'Technical details',
  'password.unlocking': 'Unlocking…',
  'password.unlock': 'Unlock',

  // ── Share ─────────────────────────────────────────────────────────────────
  'share.title': 'Share “{name}”',
  'share.whatToInclude': 'What to include',
  'share.thisFolderAndSubfolders': 'This folder and its subfolders',
  'share.justThisFolder': 'Just this folder',
  'share.link': 'Link',
  'share.copy': 'Copy',
  // Two complete sentences rather than one with a spliced clause — the differing part sits
  // mid-sentence, which no inflected language can absorb by interpolation alone.
  'share.noteWithSubfolders':
    'Anyone with this link can view and download this folder and everything in it — no account or wallet needed. This data is already public on Arweave; the link just points someone straight to it.',
  'share.noteFolderOnly':
    'Anyone with this link can view and download the files directly in this folder — no account or wallet needed. This data is already public on Arweave; the link just points someone straight to it.',
  'shareRoute.invalid': 'This share link is invalid.',

  // ── Uploads ───────────────────────────────────────────────────────────────
  'upload.dropToUpload': 'Drop to upload',
  'upload.uploadFiles': 'Upload files',
  'upload.uploadFolder': 'Upload folder',
  'upload.newFolder': 'New folder',
  'upload.panelTitle': 'Uploads',
  'upload.clearFinished': 'Clear finished',
  'upload.estimating': 'Estimating…',
  'upload.uploading': 'Uploading…',
  'upload.done': 'Done',
  'upload.remove': 'Remove {name}',
  'upload.total': 'Total: {amount}',

  // ── Batch download ─────────────────────────────────────────────────────────
  'download.selectAll': 'Select all',
  'download.selectItem': 'Select {name}',
  'download.panelTitle': 'Downloads',
  'download.collecting': 'Preparing…',
  'download.fetchingProgress': 'Downloading {completed} of {total} files…',
  'download.saving': 'Saving…',
  'download.done': 'Done',
  'download.partialFailure': '{succeeded} of {total} files downloaded — the rest failed.',

  // ── Preview / lightbox ────────────────────────────────────────────────────
  'preview.locked': 'This drive is locked in this session.',
  'preview.noDataTx': "No data transaction — this file's metadata has no content pointer.",
  'preview.decryptError': 'Could not decrypt this file: {error}',
  'preview.noInlinePreview': 'No inline preview for this file type.',
  'preview.tooLarge': 'Too large to preview inline ({size}).',
  'preview.loadError': 'Could not load preview: {error}',
  'lightbox.close': 'Close expanded view',
  'lightbox.loadError': 'Could not load this image: {error}',

  // ── Turbo balance ─────────────────────────────────────────────────────────
  'turbo.balanceUnavailable': 'Balance unavailable',
  'turbo.loadingBalance': 'Loading balance…',
  'turbo.enableUploads': 'Enable uploads',
  'turbo.wrongKeyFile':
    'That key file is for a different address — select the original one to enable uploads here.',

  // ── User-actionable errors ────────────────────────────────────────────────
  // Only errors the user can actually *do* something about live here. Gateway/network/crypto
  // diagnostics stay in English at their throw sites on purpose, so they remain greppable and
  // readable in a screenshotted bug report.
  'error.watchOnlySession':
    'This is a watch-only session — connect a wallet that can sign to make changes.',
  'error.signingUnavailable':
    "Signing isn't available in this session. Reconnect your wallet to continue.",
  'error.extensionGone': 'Wallet extension is no longer available. Reconnect to continue.',
  'error.keyFileNotLoaded':
    "Your key file isn't loaded in this session — select it again to continue.",
  'error.cannotSign': "This session can't sign — connect a wallet that can.",
  'error.insufficientCredits':
    'Not enough Turbo credits for this upload. Top up your balance and try again.',
  'error.signingRejected': 'Signing was rejected in your wallet.',
  'error.noExtension': 'No Arweave wallet extension found. Install Wander to connect.',
  'error.badAddress': 'That does not look like an Arweave address (43 characters, A–Z a–z 0–9 _ -).',
  'error.notKeyFile': 'Not an Arweave key file: missing modulus "n".',
  'error.connectToUnlock': 'Connect a wallet that can sign to unlock a private drive.',
  'error.decryptionFailed': 'Decryption failed — check the drive password.',
  'error.sessionCannotSign': 'This session cannot sign — connect a wallet that can.',
  'error.extensionUnavailable': 'Wallet extension is not available.',
  'error.keyFileNotInSession': 'Key file is not loaded in this session.',
  'error.bridgeUnavailable':
    "Couldn't retrieve this drive's signature data from the network. This is a gateway/network issue, not a wrong password — please try again in a moment.",
  'error.estimateFailed': 'Could not estimate upload cost.',
  'error.readKeyFile': 'Could not read key file: {message}',
  'error.walletCantSign':
    "Your wallet couldn't sign this request ({message}). If your wallet has removed legacy signing support, this needs an SDK update — it isn't something retrying will fix.",
};

/**
 * Count-driven strings, kept separate from `en` above because they are the one place where locales
 * legitimately need *different key sets*: Russian needs `one`/`few`/`many`/`other` (1 файл /
 * 2 файла / 5 файлов), while Chinese, Japanese, Korean, Vietnamese and Indonesian need only
 * `other`. A strict `Record<MessageKey, string>` couldn't express that; `PluralForms` requires
 * `other` and makes every other CLDR category optional.
 *
 * Selection is `Intl.PluralRules` — the browser already ships correct CLDR rules for every locale
 * here, so there is nothing to hand-maintain.
 */
export const enPlurals = {
  items: { one: '{count} item', other: '{count} items' },
  matches: { one: '{count} match', other: '{count} matches' },
  revisions: { one: '{count} revision', other: '{count} revisions' },
  orphaned: { one: '{count} orphaned', other: '{count} orphaned' },
  confirmUpload: { one: 'Confirm & upload {count} file', other: 'Confirm & upload {count} files' },
  confirmDownload: { one: 'Download {count} item', other: 'Download {count} items' },
};
