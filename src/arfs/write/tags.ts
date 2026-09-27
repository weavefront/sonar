/**
 * ArFS write-path tag assembly.
 *
 * Verified against ArDrive's own tag assembler (`ardrive-core-js/src/arfs/tags/tag_assembler.ts`
 * + `arfs_tag_settings.ts` + `tx/arfs_prototypes.ts`) so what we write is byte-compatible with
 * what ArDrive reads — tag names and values must match exactly, or ArDrive's client silently
 * treats the entity as malformed.
 *
 * One detail worth flagging because it's easy to get backwards: a file's **data** item carries no
 * `ArFS`/`Entity-Type` tag at all — only `Content-Type` plus the app tags. Only the **metadata**
 * item (the one whose JSON body points at the data item's tx id) carries the ArFS entity tags.
 * Getting this wrong doesn't break upload, but the file simply won't appear as an ArFS entity.
 */

import type { GqlTag } from '../types';

/** Our own identity in the App-Name/App-Version tags — distinct from ArDrive's, same convention. */
const APP_NAME = 'Sonar';
const APP_VERSION = '0.1.0';

/** The ArFS spec version new writes declare themselves as conforming to. */
export const WRITE_ARFS_VERSION = '0.15';

export const baseAppTags: readonly GqlTag[] = [
  { name: 'App-Name', value: APP_NAME },
  { name: 'App-Version', value: APP_VERSION },
];

export const baseArFsTags: readonly GqlTag[] = [
  ...baseAppTags,
  { name: 'ArFS', value: WRITE_ARFS_VERSION },
];

/** Seconds since epoch — the unit ArFS's Unix-Time tag uses (not milliseconds). */
export function unixTimeNow(): number {
  return Math.floor(Date.now() / 1000);
}

export interface DriveTagsParams {
  driveId: string;
  unixTime: number;
}

export function driveMetadataTags({ driveId, unixTime }: DriveTagsParams): GqlTag[] {
  return [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Entity-Type', value: 'drive' },
    { name: 'Unix-Time', value: String(unixTime) },
    { name: 'Drive-Id', value: driveId },
    { name: 'Drive-Privacy', value: 'public' },
    ...baseArFsTags,
  ];
}

export interface FolderTagsParams {
  driveId: string;
  folderId: string;
  /** Omitted for a drive's root folder — root folders have no parent. */
  parentFolderId?: string;
  unixTime: number;
}

export function folderMetadataTags({ driveId, folderId, parentFolderId, unixTime }: FolderTagsParams): GqlTag[] {
  return [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Entity-Type', value: 'folder' },
    { name: 'Unix-Time', value: String(unixTime) },
    { name: 'Drive-Id', value: driveId },
    { name: 'Folder-Id', value: folderId },
    ...(parentFolderId ? [{ name: 'Parent-Folder-Id', value: parentFolderId }] : []),
    ...baseArFsTags,
  ];
}

export interface FileMetaTagsParams {
  driveId: string;
  fileId: string;
  parentFolderId: string;
  unixTime: number;
}

export function fileMetadataTags({ driveId, fileId, parentFolderId, unixTime }: FileMetaTagsParams): GqlTag[] {
  return [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'Entity-Type', value: 'file' },
    { name: 'Unix-Time', value: String(unixTime) },
    { name: 'Drive-Id', value: driveId },
    { name: 'File-Id', value: fileId },
    { name: 'Parent-Folder-Id', value: parentFolderId },
    ...baseArFsTags,
  ];
}

/**
 * Tags for a file's raw-bytes data item. Deliberately just Content-Type + app tags — no ArFS
 * version or Entity-Type here, matching the reference implementation exactly.
 */
export function fileDataTags(dataContentType: string): GqlTag[] {
  return [{ name: 'Content-Type', value: dataContentType || 'application/octet-stream' }, ...baseAppTags];
}

// ---------------------------------------------------------------------------
// Private (encrypted) entities
//
// Verified against ardrive-core-js's ArFSPrivateDriveMetaDataPrototype / ArFSPrivateFolder-
// MetaDataPrototype / ArFSPrivateFileMetaDataPrototype / ArFSPrivateFileDataPrototype
// (src/arfs/tx/arfs_prototypes.ts) and PRIVATE_CONTENT_TYPE (src/utils/constants.ts). Every
// private transaction — metadata *and* data — carries Content-Type: application/octet-stream,
// since the body is ciphertext, not JSON (and for a file's data item, the real MIME type is only
// knowable after decrypting its metadata, so the public tag deliberately doesn't leak it either).
// `Drive-Privacy`, `Drive-Auth-Mode`, and `Signature-Type` are drive-only tags — a private folder
// or file's privacy is inferred purely from the presence of a `Cipher` tag (see `parseStub`),
// never re-declared on every entity.
// ---------------------------------------------------------------------------

export const PRIVATE_CONTENT_TYPE = 'application/octet-stream';
export const CIPHER = 'AES256-GCM';

function cipherTags(cipherIv: string): GqlTag[] {
  return [
    { name: 'Cipher', value: CIPHER },
    { name: 'Cipher-IV', value: cipherIv },
  ];
}

export interface PrivateDriveTagsParams extends DriveTagsParams {
  cipherIv: string;
  /** Stringified Signature-Type — '2' for every drive this app creates; see the M4 plan. */
  signatureType: string;
}

export function privateDriveMetadataTags({
  driveId,
  unixTime,
  cipherIv,
  signatureType,
}: PrivateDriveTagsParams): GqlTag[] {
  return [
    { name: 'Content-Type', value: PRIVATE_CONTENT_TYPE },
    { name: 'Entity-Type', value: 'drive' },
    { name: 'Unix-Time', value: String(unixTime) },
    { name: 'Drive-Id', value: driveId },
    { name: 'Drive-Privacy', value: 'private' },
    ...cipherTags(cipherIv),
    { name: 'Drive-Auth-Mode', value: 'password' },
    { name: 'Signature-Type', value: signatureType },
    ...baseArFsTags,
  ];
}

export interface PrivateFolderTagsParams extends FolderTagsParams {
  cipherIv: string;
}

export function privateFolderMetadataTags({
  driveId,
  folderId,
  parentFolderId,
  unixTime,
  cipherIv,
}: PrivateFolderTagsParams): GqlTag[] {
  return [
    { name: 'Content-Type', value: PRIVATE_CONTENT_TYPE },
    { name: 'Entity-Type', value: 'folder' },
    { name: 'Unix-Time', value: String(unixTime) },
    { name: 'Drive-Id', value: driveId },
    { name: 'Folder-Id', value: folderId },
    ...(parentFolderId ? [{ name: 'Parent-Folder-Id', value: parentFolderId }] : []),
    ...cipherTags(cipherIv),
    ...baseArFsTags,
  ];
}

export interface PrivateFileMetaTagsParams extends FileMetaTagsParams {
  cipherIv: string;
}

export function privateFileMetadataTags({
  driveId,
  fileId,
  parentFolderId,
  unixTime,
  cipherIv,
}: PrivateFileMetaTagsParams): GqlTag[] {
  return [
    { name: 'Content-Type', value: PRIVATE_CONTENT_TYPE },
    { name: 'Entity-Type', value: 'file' },
    { name: 'Unix-Time', value: String(unixTime) },
    { name: 'Drive-Id', value: driveId },
    { name: 'File-Id', value: fileId },
    { name: 'Parent-Folder-Id', value: parentFolderId },
    ...cipherTags(cipherIv),
    ...baseArFsTags,
  ];
}

/**
 * Tags for a private file's raw-bytes data item — its own independent Cipher-IV, separate from
 * the metadata transaction's (see `arfs/crypto/fileData.ts` on the read side). Content-Type is
 * always octet-stream here regardless of the real file type, matching `fileDataTags`'s shape
 * otherwise: just Content-Type + cipher tags + app tags, no ArFS/Entity-Type.
 */
export function privateFileDataTags(cipherIv: string): GqlTag[] {
  return [{ name: 'Content-Type', value: PRIVATE_CONTENT_TYPE }, ...cipherTags(cipherIv), ...baseAppTags];
}
