/**
 * Write orchestration: cost estimation and the actual Turbo uploads.
 *
 * Every mutation here — new file, new folder, rename, move, hide — is "sign and upload one JSON
 * or byte blob with the right ArFS tags," so the primitives (`uploadJson`/`uploadFileData`) are
 * shared by all of them. What differs per operation is only the tag set and JSON shape, which
 * live in `arfs/write/tags.ts` and are assembled here.
 */

import { t } from '../i18n/translate';
import type { TurboClient } from './client';
import {
  driveMetadataTags,
  fileDataTags,
  fileMetadataTags,
  folderMetadataTags,
  privateDriveMetadataTags,
  privateFileDataTags,
  privateFileMetadataTags,
  privateFolderMetadataTags,
  unixTimeNow,
} from '../arfs/write/tags';
import { buildDriveEntity, buildFileEntity, buildFolderEntity, newEntityId } from '../arfs/write/entities';
import { v2Signature } from '../arfs/crypto/signature';
import { deriveDriveKey, type DerivedKey } from '../arfs/crypto/kdf';
import { encryptBytes, encryptJson } from '../arfs/crypto/cipher';
import type { GeneratedThumbnail } from '../arfs/write/thumbnail';
import type { DriveEntity, FileEntity, FolderEntity, GqlTag, ThumbnailVariant } from '../arfs/types';
import type { WalletState } from '../wallet/store';

/** Every thumbnail this app writes uses this variant name — matches ArDrive's own convention. */
const THUMBNAIL_VARIANT_NAME = 'small';

function thumbnailVariants(thumbnailTxId: string, thumbnail: GeneratedThumbnail): { variants: ThumbnailVariant[] } {
  return {
    variants: [
      {
        name: THUMBNAIL_VARIANT_NAME,
        txId: thumbnailTxId,
        size: thumbnail.blob.size,
        width: thumbnail.width,
        height: thumbnail.height,
      },
    ],
  };
}

/**
 * The subset of wallet state signing needs — same shape `arfs/crypto/signature.ts` takes, so a
 * caller with a `WalletState` can pass it straight through to either.
 */
type SigningWallet = Pick<WalletState, 'mode' | 'canSign' | 'jwk'>;

export class UploadError extends Error {}

/** Turns a raw SDK rejection into something worth showing a user, without hiding what happened. */
function explainUploadError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/insufficient|balance/i.test(message)) {
    throw new UploadError(t('error.insufficientCredits'));
  }
  if (/reject|denied|cancel/i.test(message)) {
    throw new UploadError(t('error.signingRejected'));
  }
  if (/signature|sign/i.test(message)) {
    throw new UploadError(
      `Your wallet couldn't sign this request (${message}). If your wallet has removed legacy ` +
        'signing support, this needs an SDK update — it isn’t something retrying will fix.',
    );
  }
  throw new UploadError(message);
}

// ---------------------------------------------------------------------------
// Cost & balance
// ---------------------------------------------------------------------------

export interface CostEstimate {
  /** Winston Credits, as a decimal string — Turbo's native unit. */
  winc: string;
}

export async function estimateCost(turbo: TurboClient, totalBytes: number): Promise<CostEstimate> {
  // Turbo prices whole bytes; a metadata-only write (rename/move/hide/new folder) is a few
  // hundred bytes and often free under Turbo's small-file allowance, but we still ask rather than
  // assume — "free" is a pricing fact, not something this app should guess at.
  const [cost] = await turbo.getUploadCosts({ bytes: [Math.max(1, totalBytes)] });
  return { winc: cost?.winc ?? '0' };
}

export interface Balance {
  winc: string;
}

export async function getBalance(turbo: TurboClient): Promise<Balance> {
  const res = await turbo.getBalance();
  return { winc: res.winc };
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

async function uploadJson(
  turbo: TurboClient,
  body: unknown,
  tags: GqlTag[],
): Promise<{ id: string }> {
  try {
    const result = await turbo.upload({
      data: JSON.stringify(body),
      dataItemOpts: { tags },
    });
    return { id: result.id };
  } catch (err) {
    explainUploadError(err);
  }
}

export interface UploadFileProgress {
  processedBytes: number;
  totalBytes: number;
}

async function uploadFileData(
  turbo: TurboClient,
  file: Blob,
  tags: GqlTag[],
  onProgress?: (p: UploadFileProgress) => void,
): Promise<{ id: string }> {
  try {
    const result = await turbo.uploadFile({
      fileStreamFactory: () => file.stream(),
      fileSizeFactory: () => file.size,
      dataItemOpts: { tags },
      events: {
        onProgress: onProgress
          ? ({ processedBytes, totalBytes }) => onProgress({ processedBytes, totalBytes })
          : undefined,
      },
    });
    return { id: result.id };
  } catch (err) {
    explainUploadError(err);
  }
}

/** Encrypt a JSON body and upload it — the private counterpart to `uploadJson`. */
async function uploadEncryptedJson(
  turbo: TurboClient,
  key: DerivedKey,
  body: unknown,
  tags: (cipherIv: string) => GqlTag[],
): Promise<{ id: string }> {
  const { ciphertext, cipherIv } = await encryptJson(key, body);
  try {
    const result = await turbo.upload({ data: ciphertext, dataItemOpts: { tags: tags(cipherIv) } });
    return { id: result.id };
  } catch (err) {
    explainUploadError(err);
  }
}

/**
 * Encrypt a file's bytes and upload them — the private counterpart to `uploadFileData`. WebCrypto
 * has no browser streaming AES-GCM API, so the whole file is buffered to encrypt it (unlike the
 * public path, which streams straight from disk) — see the M4 plan's Risks section. The resulting
 * ciphertext is re-wrapped in a `Blob` so `uploadFile`'s stream/size factories — and therefore
 * progress events — work exactly as they do for a public upload.
 */
async function uploadEncryptedFileData(
  turbo: TurboClient,
  key: DerivedKey,
  file: Blob,
  tags: (cipherIv: string) => GqlTag[],
  onProgress?: (p: UploadFileProgress) => void,
): Promise<{ id: string }> {
  const { ciphertext, cipherIv } = await encryptBytes(key, await file.arrayBuffer());
  const blob = new Blob([ciphertext]);
  try {
    const result = await turbo.uploadFile({
      fileStreamFactory: () => blob.stream(),
      fileSizeFactory: () => blob.size,
      dataItemOpts: { tags: tags(cipherIv) },
      events: {
        onProgress: onProgress
          ? ({ processedBytes, totalBytes }) => onProgress({ processedBytes, totalBytes })
          : undefined,
      },
    });
    return { id: result.id };
  } catch (err) {
    explainUploadError(err);
  }
}

// ---------------------------------------------------------------------------
// Drive / folder / file operations
// ---------------------------------------------------------------------------

export interface UploadNewFileParams {
  turbo: TurboClient;
  driveId: string;
  parentFolderId: string;
  file: File;
  owner: string;
  /** Pre-generated by the caller (`state/write.ts`) — see `arfs/write/thumbnail.ts`. */
  thumbnail?: GeneratedThumbnail;
  onProgress?: (p: UploadFileProgress) => void;
}

/** Uploads a file's bytes, then its metadata pointing back at them — the two-transaction model. */
export async function uploadNewFile({
  turbo,
  driveId,
  parentFolderId,
  file,
  owner,
  thumbnail,
  onProgress,
}: UploadNewFileParams): Promise<FileEntity> {
  const dataContentType = file.type || 'application/octet-stream';
  const dataResult = await uploadFileData(turbo, file, fileDataTags(dataContentType), onProgress);

  // Thumbnail is its own data item, same shape as a normal file's data — just smaller, and always
  // tagged image/jpeg regardless of the source format (matches ArDrive's own convention).
  const thumbnailResult = thumbnail
    ? await uploadFileData(turbo, thumbnail.blob, fileDataTags('image/jpeg'))
    : undefined;

  const fileId = newEntityId();
  const unixTime = unixTimeNow();
  const metaResult = await uploadJson(
    turbo,
    {
      name: file.name,
      size: file.size,
      lastModifiedDate: file.lastModified,
      dataTxId: dataResult.id,
      dataContentType,
      ...(thumbnailResult && thumbnail ? { thumbnail: thumbnailVariants(thumbnailResult.id, thumbnail) } : {}),
    },
    fileMetadataTags({ driveId, fileId, parentFolderId, unixTime }),
  );

  return buildFileEntity({
    metadataTxId: metaResult.id,
    driveId,
    owner,
    fileId,
    name: file.name,
    parentFolderId,
    size: file.size,
    lastModifiedDate: file.lastModified,
    dataTxId: dataResult.id,
    dataContentType,
    ...(thumbnailResult && thumbnail ? { thumbnail: thumbnailVariants(thumbnailResult.id, thumbnail) } : {}),
  });
}

export interface CreateDriveParams {
  turbo: TurboClient;
  name: string;
  owner: string;
}

/** A drive is really two writes: the root folder, then the drive entity pointing at it. */
export async function createDrive({ turbo, name, owner }: CreateDriveParams): Promise<{
  drive: DriveEntity;
  rootFolder: FolderEntity;
}> {
  const driveId = newEntityId();
  const rootFolderId = newEntityId();
  const unixTime = unixTimeNow();

  const rootResult = await uploadJson(
    turbo,
    { name },
    // Root folders carry no Parent-Folder-Id — they're the top of the tree.
    folderMetadataTags({ driveId, folderId: rootFolderId, unixTime }),
  );
  const driveResult = await uploadJson(turbo, { name, rootFolderId }, driveMetadataTags({ driveId, unixTime }));

  return {
    drive: buildDriveEntity({ metadataTxId: driveResult.id, driveId, owner, name, rootFolderId }),
    rootFolder: buildFolderEntity({ metadataTxId: rootResult.id, driveId, owner, folderId: rootFolderId, name }),
  };
}

export interface CreateFolderParams {
  turbo: TurboClient;
  driveId: string;
  parentFolderId: string;
  name: string;
  owner: string;
}

export async function createFolder({ turbo, driveId, parentFolderId, name, owner }: CreateFolderParams): Promise<FolderEntity> {
  const folderId = newEntityId();
  const unixTime = unixTimeNow();
  const result = await uploadJson(turbo, { name }, folderMetadataTags({ driveId, folderId, parentFolderId, unixTime }));
  return buildFolderEntity({ metadataTxId: result.id, driveId, owner, folderId, name, parentFolderId });
}

/**
 * Writes a new folder revision. Rename, move, and hide/unhide are all this same operation with
 * different fields changed — ArFS has no separate "rename" or "move" transaction type, only "the
 * current state of this Folder-Id is now this."
 */
export interface WriteFolderRevisionParams {
  turbo: TurboClient;
  folder: FolderEntity;
  name?: string;
  parentFolderId?: string;
  isHidden?: boolean;
}

export async function writeFolderRevision({
  turbo,
  folder,
  name = folder.name,
  parentFolderId = folder.parentFolderId,
  isHidden = folder.isHidden,
}: WriteFolderRevisionParams): Promise<FolderEntity> {
  const unixTime = unixTimeNow();
  const result = await uploadJson(
    turbo,
    { name, isHidden },
    folderMetadataTags({ driveId: folder.driveId, folderId: folder.entityId, parentFolderId, unixTime }),
  );
  return buildFolderEntity({
    metadataTxId: result.id,
    driveId: folder.driveId,
    owner: folder.owner,
    folderId: folder.entityId,
    name,
    ...(parentFolderId ? { parentFolderId } : {}),
    isHidden,
  });
}

/** The file equivalent of `writeFolderRevision` — same "new revision, changed fields" model. */
export interface WriteFileRevisionParams {
  turbo: TurboClient;
  file: FileEntity;
  name?: string;
  parentFolderId?: string;
  isHidden?: boolean;
}

export async function writeFileRevision({
  turbo,
  file,
  name = file.name,
  parentFolderId = file.parentFolderId,
  isHidden = file.isHidden,
}: WriteFileRevisionParams): Promise<FileEntity> {
  // Every file has a parent by ArFS invariant — unlike a folder, a file can never sit at a
  // drive's root. Typed as optional only because it's inherited from the same base as folders.
  if (!parentFolderId) throw new UploadError('A file must belong to a folder.');

  const unixTime = unixTimeNow();
  const result = await uploadJson(
    turbo,
    {
      name,
      size: file.size,
      lastModifiedDate: file.lastModifiedDate,
      dataTxId: file.dataTxId,
      dataContentType: file.dataContentType,
      isHidden,
    },
    fileMetadataTags({ driveId: file.driveId, fileId: file.entityId, parentFolderId, unixTime }),
  );
  return buildFileEntity({
    metadataTxId: result.id,
    driveId: file.driveId,
    owner: file.owner,
    fileId: file.entityId,
    name,
    parentFolderId,
    size: file.size,
    lastModifiedDate: file.lastModifiedDate,
    dataTxId: file.dataTxId,
    dataContentType: file.dataContentType,
    isHidden,
  });
}

// ---------------------------------------------------------------------------
// Private (encrypted) drive / folder / file operations
//
// One-for-one private counterparts to the public operations above — same shapes, same optimistic-
// entity splice, the only difference is the body gets encrypted before it's uploaded and the tag
// set gains Cipher/Cipher-IV (see arfs/write/tags.ts). See the M4 plan for the full write flow.
// ---------------------------------------------------------------------------

/** Every drive this app creates goes straight to v2 — no reason to create a new v1 drive today. */
const NEW_DRIVE_SIGNATURE_TYPE = '2';

export interface CreatePrivateDriveParams {
  turbo: TurboClient;
  wallet: SigningWallet;
  name: string;
  password: string;
  owner: string;
}

/**
 * A private drive is really three things: derive its key (signing `driveId` with the wallet, then
 * HKDF with the password — see `arfs/crypto/kdf.ts`), then the same two writes `createDrive` does,
 * just encrypted. Returns `driveKey` so the caller can register the session as unlocked
 * (`usePrivateDrives.adoptUnlocked`) — there's nothing to "unlock" for a drive just created with
 * this password.
 */
export async function createPrivateDrive({ turbo, wallet, name, password, owner }: CreatePrivateDriveParams): Promise<{
  drive: DriveEntity;
  rootFolder: FolderEntity;
  driveKey: DerivedKey;
}> {
  const driveId = newEntityId();
  const rootFolderId = newEntityId();
  const unixTime = unixTimeNow();

  let driveKey: DerivedKey;
  try {
    const signature = await v2Signature(wallet, driveId);
    driveKey = await deriveDriveKey(signature, password);
  } catch (err) {
    // No v1 fallback for creation — see the M4 plan's Risks. If v2 signing fails outright, say so
    // rather than silently falling back to something ArDrive's own client wouldn't produce either.
    throw new UploadError(err instanceof Error ? err.message : String(err));
  }

  const rootResult = await uploadEncryptedJson(turbo, driveKey, { name }, (cipherIv) =>
    privateFolderMetadataTags({ driveId, folderId: rootFolderId, unixTime, cipherIv }),
  );
  const driveResult = await uploadEncryptedJson(turbo, driveKey, { name, rootFolderId }, (cipherIv) =>
    privateDriveMetadataTags({ driveId, unixTime, cipherIv, signatureType: NEW_DRIVE_SIGNATURE_TYPE }),
  );

  return {
    drive: buildDriveEntity({
      metadataTxId: driveResult.id,
      driveId,
      owner,
      name,
      rootFolderId,
      privacy: 'private',
      signatureType: NEW_DRIVE_SIGNATURE_TYPE,
    }),
    rootFolder: buildFolderEntity({
      metadataTxId: rootResult.id,
      driveId,
      owner,
      folderId: rootFolderId,
      name,
      privacy: 'private',
    }),
    driveKey,
  };
}

export interface CreatePrivateFolderParams {
  turbo: TurboClient;
  driveId: string;
  parentFolderId: string;
  name: string;
  owner: string;
  driveKey: DerivedKey;
}

export async function createPrivateFolder({
  turbo,
  driveId,
  parentFolderId,
  name,
  owner,
  driveKey,
}: CreatePrivateFolderParams): Promise<FolderEntity> {
  const folderId = newEntityId();
  const unixTime = unixTimeNow();
  const result = await uploadEncryptedJson(turbo, driveKey, { name }, (cipherIv) =>
    privateFolderMetadataTags({ driveId, folderId, parentFolderId, unixTime, cipherIv }),
  );
  return buildFolderEntity({
    metadataTxId: result.id,
    driveId,
    owner,
    folderId,
    name,
    parentFolderId,
    privacy: 'private',
  });
}

export interface UploadNewPrivateFileParams {
  turbo: TurboClient;
  driveId: string;
  parentFolderId: string;
  file: File;
  owner: string;
  /** Generated by the caller (`state/write.ts`) so the same id can key `getDecryptContext`'s file-key cache. */
  fileId: string;
  fileKey: DerivedKey;
  /** Pre-generated by the caller — encrypted with the same `fileKey` as the main data, not a separate key. */
  thumbnail?: GeneratedThumbnail;
  onProgress?: (p: UploadFileProgress) => void;
}

/** The private counterpart to `uploadNewFile` — encrypts both the data and the metadata. */
export async function uploadNewPrivateFile({
  turbo,
  driveId,
  parentFolderId,
  file,
  owner,
  fileId,
  fileKey,
  thumbnail,
  onProgress,
}: UploadNewPrivateFileParams): Promise<FileEntity> {
  const dataContentType = file.type || 'application/octet-stream';
  const dataResult = await uploadEncryptedFileData(turbo, fileKey, file, privateFileDataTags, onProgress);

  const thumbnailResult = thumbnail
    ? await uploadEncryptedFileData(turbo, fileKey, thumbnail.blob, privateFileDataTags)
    : undefined;

  const unixTime = unixTimeNow();
  const metaResult = await uploadEncryptedJson(
    turbo,
    fileKey,
    {
      name: file.name,
      size: file.size,
      lastModifiedDate: file.lastModified,
      dataTxId: dataResult.id,
      dataContentType,
      ...(thumbnailResult && thumbnail ? { thumbnail: thumbnailVariants(thumbnailResult.id, thumbnail) } : {}),
    },
    (cipherIv) => privateFileMetadataTags({ driveId, fileId, parentFolderId, unixTime, cipherIv }),
  );

  return buildFileEntity({
    metadataTxId: metaResult.id,
    driveId,
    owner,
    fileId,
    name: file.name,
    parentFolderId,
    size: file.size,
    lastModifiedDate: file.lastModified,
    dataTxId: dataResult.id,
    dataContentType,
    privacy: 'private',
    ...(thumbnailResult && thumbnail ? { thumbnail: thumbnailVariants(thumbnailResult.id, thumbnail) } : {}),
  });
}

export interface WritePrivateFolderRevisionParams {
  turbo: TurboClient;
  folder: FolderEntity;
  name?: string;
  parentFolderId?: string;
  isHidden?: boolean;
  driveKey: DerivedKey;
}

export async function writePrivateFolderRevision({
  turbo,
  folder,
  name = folder.name,
  parentFolderId = folder.parentFolderId,
  isHidden = folder.isHidden,
  driveKey,
}: WritePrivateFolderRevisionParams): Promise<FolderEntity> {
  const unixTime = unixTimeNow();
  const result = await uploadEncryptedJson(turbo, driveKey, { name, isHidden }, (cipherIv) =>
    privateFolderMetadataTags({ driveId: folder.driveId, folderId: folder.entityId, parentFolderId, unixTime, cipherIv }),
  );
  return buildFolderEntity({
    metadataTxId: result.id,
    driveId: folder.driveId,
    owner: folder.owner,
    folderId: folder.entityId,
    name,
    ...(parentFolderId ? { parentFolderId } : {}),
    isHidden,
    privacy: 'private',
  });
}

export interface WritePrivateFileRevisionParams {
  turbo: TurboClient;
  file: FileEntity;
  name?: string;
  parentFolderId?: string;
  isHidden?: boolean;
  fileKey: DerivedKey;
}

export async function writePrivateFileRevision({
  turbo,
  file,
  name = file.name,
  parentFolderId = file.parentFolderId,
  isHidden = file.isHidden,
  fileKey,
}: WritePrivateFileRevisionParams): Promise<FileEntity> {
  if (!parentFolderId) throw new UploadError('A file must belong to a folder.');

  const unixTime = unixTimeNow();
  const result = await uploadEncryptedJson(
    turbo,
    fileKey,
    {
      name,
      size: file.size,
      lastModifiedDate: file.lastModifiedDate,
      dataTxId: file.dataTxId,
      dataContentType: file.dataContentType,
      isHidden,
    },
    (cipherIv) => privateFileMetadataTags({ driveId: file.driveId, fileId: file.entityId, parentFolderId, unixTime, cipherIv }),
  );
  return buildFileEntity({
    metadataTxId: result.id,
    driveId: file.driveId,
    owner: file.owner,
    fileId: file.entityId,
    name,
    parentFolderId,
    size: file.size,
    lastModifiedDate: file.lastModifiedDate,
    dataTxId: file.dataTxId,
    dataContentType: file.dataContentType,
    isHidden,
    privacy: 'private',
  });
}
