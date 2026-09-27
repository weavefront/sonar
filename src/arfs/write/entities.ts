/**
 * Optimistic local entities.
 *
 * After a write succeeds (Turbo has accepted and signed the data item), the transaction is
 * *pending* — not yet mined, and invisible to GraphQL for a while. Rather than show a spinner
 * until the next sync notices it, we build the same `ResolvedEntity` shape the read path produces
 * and splice it straight into state.
 *
 * This works with zero changes to `tree.ts`: `isNewerRevision` already treats a `height: null`
 * revision as newer than any mined one, which is exactly true here — a pending write to a File-Id
 * is definitionally the user's most recent intent for that entity. When the real sync eventually
 * ingests the mined transaction (same entity ID, same metadataTxId), it doesn't duplicate the
 * entry — `latestByEntityId` and `revisionsByEntityId` both dedupe by entity ID and transaction ID.
 */

import { unixTimeNow, WRITE_ARFS_VERSION } from './tags';
import { PRIVATE_CONTENT_TYPE } from './tags';
import type { DriveEntity, FileEntity, FolderEntity, Privacy } from '../types';

interface CommonParams {
  /** The data item id Turbo/the wallet returned after signing — this becomes the entity's identity. */
  metadataTxId: string;
  driveId: string;
  owner: string;
  /** Defaults to 'public' — every M2 call site is unaffected by this M4 addition. */
  privacy?: Privacy;
}

function contentTypeFor(privacy: Privacy): string {
  return privacy === 'private' ? PRIVATE_CONTENT_TYPE : 'application/json';
}

export function buildDriveEntity(
  params: CommonParams & { driveId: string; name: string; rootFolderId: string; signatureType?: string },
): DriveEntity {
  const unixTime = unixTimeNow();
  const privacy = params.privacy ?? 'public';
  return {
    metadataTxId: params.metadataTxId,
    entityType: 'drive',
    entityId: params.driveId,
    driveId: params.driveId,
    privacy,
    unixTime,
    height: null,
    minedAt: null,
    owner: params.owner,
    arFsVersion: WRITE_ARFS_VERSION,
    contentType: contentTypeFor(privacy),
    name: params.name,
    isHidden: false,
    rootFolderId: params.rootFolderId,
    ...(params.signatureType ? { signatureType: params.signatureType } : {}),
  };
}

export function buildFolderEntity(
  params: CommonParams & { folderId: string; name: string; parentFolderId?: string; isHidden?: boolean },
): FolderEntity {
  const unixTime = unixTimeNow();
  const privacy = params.privacy ?? 'public';
  return {
    metadataTxId: params.metadataTxId,
    entityType: 'folder',
    entityId: params.folderId,
    driveId: params.driveId,
    ...(params.parentFolderId ? { parentFolderId: params.parentFolderId } : {}),
    privacy,
    unixTime,
    height: null,
    minedAt: null,
    owner: params.owner,
    arFsVersion: WRITE_ARFS_VERSION,
    contentType: contentTypeFor(privacy),
    name: params.name,
    isHidden: params.isHidden ?? false,
  };
}

export function buildFileEntity(
  params: CommonParams & {
    fileId: string;
    name: string;
    parentFolderId: string;
    size: number;
    lastModifiedDate: number;
    dataTxId: string;
    dataContentType: string;
    isHidden?: boolean;
    thumbnail?: FileEntity['thumbnail'];
  },
): FileEntity {
  const unixTime = unixTimeNow();
  const privacy = params.privacy ?? 'public';
  return {
    metadataTxId: params.metadataTxId,
    entityType: 'file',
    entityId: params.fileId,
    driveId: params.driveId,
    parentFolderId: params.parentFolderId,
    privacy,
    unixTime,
    height: null,
    minedAt: null,
    owner: params.owner,
    arFsVersion: WRITE_ARFS_VERSION,
    contentType: contentTypeFor(privacy),
    name: params.name,
    isHidden: params.isHidden ?? false,
    size: params.size,
    lastModifiedDate: params.lastModifiedDate,
    dataTxId: params.dataTxId,
    dataContentType: params.dataContentType,
    ...(params.thumbnail ? { thumbnail: params.thumbnail } : {}),
  };
}

/** A fresh v4 UUID for a new Drive-Id/Folder-Id/File-Id. Native, no dependency needed. */
export function newEntityId(): string {
  return crypto.randomUUID();
}
