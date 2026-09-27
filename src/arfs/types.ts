/**
 * ArFS (Arweave File System) protocol types.
 *
 * ArFS is a convention layered on ordinary Arweave transactions: identifying data lives in
 * transaction *tags*, and the rest lives as JSON in the transaction *body*. That split is the
 * single most important fact about performance here — GraphQL returns tags cheaply and in bulk,
 * but every entity's name requires a separate HTTP fetch of its body.
 *
 * Spec: https://docs.ar.io/build/advanced/arfs/entity-types
 */

/** Tag names defined by the ArFS spec. */
export const Tag = {
  arFs: 'ArFS',
  entityType: 'Entity-Type',
  driveId: 'Drive-Id',
  folderId: 'Folder-Id',
  fileId: 'File-Id',
  parentFolderId: 'Parent-Folder-Id',
  drivePrivacy: 'Drive-Privacy',
  driveAuthMode: 'Drive-Auth-Mode',
  contentType: 'Content-Type',
  unixTime: 'Unix-Time',
  cipher: 'Cipher',
  cipherIv: 'Cipher-IV',
  signatureType: 'Signature-Type',
  snapshotId: 'Snapshot-Id',
  blockStart: 'Block-Start',
  blockEnd: 'Block-End',
} as const;

export type EntityType = 'drive' | 'folder' | 'file' | 'snapshot' | 'drive-signature';
export type Privacy = 'public' | 'private';

export interface GqlTag {
  name: string;
  value: string;
}

export interface GqlBlock {
  height: number;
  timestamp: number;
}

export interface GqlNode {
  id: string;
  owner: { address: string };
  block: GqlBlock | null;
  tags: GqlTag[];
}

export interface GqlEdge {
  cursor: string;
  node: GqlNode;
}

/**
 * What a single metadata transaction tells us from its tags alone, before its JSON body is
 * fetched. The whole tree structure is derivable from stubs, which is why the UI can paint a
 * skeleton hierarchy immediately.
 */
export interface EntityStub {
  /** Transaction ID of this metadata revision. */
  metadataTxId: string;
  entityType: EntityType;
  /** Drive-Id / Folder-Id / File-Id depending on entityType. */
  entityId: string;
  driveId: string;
  parentFolderId?: string;
  privacy: Privacy;
  cipher?: string;
  cipherIv?: string;
  /** Seconds since epoch, from the Unix-Time tag. */
  unixTime: number;
  /** Null while the transaction is still pending (not yet mined). */
  height: number | null;
  /** Seconds since epoch, from the block. Null while pending. */
  minedAt: number | null;
  owner: string;
  arFsVersion: string;
  contentType: string;
}

/** Fields shared by every resolved (body-fetched) entity. */
interface ResolvedBase extends EntityStub {
  name: string;
  isHidden: boolean;
  /**
   * The metadata body couldn't be read, so `name` and friends are placeholders. The entity is
   * still listed: the transaction proves the file exists, and hiding it would misrepresent the
   * user's drive as missing data it actually has.
   */
  unresolved?: boolean;
}

export interface DriveEntity extends ResolvedBase {
  entityType: 'drive';
  rootFolderId: string;
  /** Present on v0.15+ drives that have been upgraded; signals a drive-signature entity exists. */
  signatureType?: string;
}

export interface FolderEntity extends ResolvedBase {
  entityType: 'folder';
}

/**
 * A single generated thumbnail image, per ArDrive's own convention (verified against
 * `ardrive-web`'s `Thumbnail`/`Variant` classes). `name` is a label ("small"), not a size
 * guarantee — pick by `width` when choosing among variants, don't assume ordering.
 */
export interface ThumbnailVariant {
  name: string;
  txId: string;
  size: number;
  width: number;
  height: number;
}

export interface FileEntity extends ResolvedBase {
  entityType: 'file';
  size: number;
  /** Milliseconds since epoch (note: differs from Unix-Time, which is seconds). */
  lastModifiedDate: number;
  dataTxId: string;
  dataContentType: string;
  pinnedDataOwner?: string;
  thumbnail?: { variants: ThumbnailVariant[] };
}

export type ResolvedEntity = DriveEntity | FolderEntity | FileEntity;

/** Raw JSON body shapes, as stored in the metadata transaction. */
export interface DriveJson {
  name?: string;
  rootFolderId?: string;
  isHidden?: boolean;
}
export interface FolderJson {
  name?: string;
  isHidden?: boolean;
}
export interface FileJson {
  name?: string;
  size?: number;
  lastModifiedDate?: number;
  dataTxId?: string;
  dataContentType?: string;
  isHidden?: boolean;
  pinnedDataOwner?: string;
  thumbnail?: { variants: ThumbnailVariant[] };
}

/** Index a tag array by name. Later duplicates lose, matching gateway behaviour. */
export function tagMap(tags: readonly GqlTag[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const t of tags) if (!m.has(t.name)) m.set(t.name, t.value);
  return m;
}

const ENTITY_TYPES = new Set<string>(['drive', 'folder', 'file', 'snapshot', 'drive-signature']);

/**
 * Parse a GraphQL node into an EntityStub, or null if it isn't a well-formed ArFS entity.
 *
 * Deliberately permissive about ArFS version: live mainnet data still contains 0.11 drives
 * alongside 0.15, and older revisions omit tags that later versions require. Anything we can
 * still identify and place in the tree is kept.
 */
export function parseStub(node: GqlNode): EntityStub | null {
  const tags = tagMap(node.tags);

  const entityType = tags.get(Tag.entityType);
  if (!entityType || !ENTITY_TYPES.has(entityType)) return null;

  const driveId = tags.get(Tag.driveId);
  if (!driveId) return null;

  // The ID tag that carries this entity's identity depends on its type.
  const entityId =
    entityType === 'drive' || entityType === 'drive-signature'
      ? driveId
      : entityType === 'folder'
        ? tags.get(Tag.folderId)
        : entityType === 'file'
          ? tags.get(Tag.fileId)
          : tags.get(Tag.snapshotId);
  if (!entityId) return null;

  // Privacy is usually tagged, but older folder/file revisions omit it. Presence of a Cipher tag
  // is an unambiguous fallback signal.
  const privacyTag = tags.get(Tag.drivePrivacy);
  const cipher = tags.get(Tag.cipher);
  const privacy: Privacy =
    privacyTag === 'private' ? 'private' : privacyTag === 'public' ? 'public' : cipher ? 'private' : 'public';

  const unixTime = Number(tags.get(Tag.unixTime) ?? 0);

  return {
    metadataTxId: node.id,
    entityType: entityType as EntityType,
    entityId,
    driveId,
    ...(tags.get(Tag.parentFolderId) ? { parentFolderId: tags.get(Tag.parentFolderId)! } : {}),
    privacy,
    ...(cipher ? { cipher } : {}),
    ...(tags.get(Tag.cipherIv) ? { cipherIv: tags.get(Tag.cipherIv)! } : {}),
    unixTime: Number.isFinite(unixTime) ? unixTime : 0,
    height: node.block?.height ?? null,
    minedAt: node.block?.timestamp ?? null,
    owner: node.owner.address,
    arFsVersion: tags.get(Tag.arFs) ?? '',
    contentType: tags.get(Tag.contentType) ?? '',
  };
}
