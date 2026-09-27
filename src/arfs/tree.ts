/**
 * Hierarchy assembly and version reduction.
 *
 * ArFS is append-only: renaming a file or moving a folder writes a *new* metadata transaction
 * carrying the same File-Id / Folder-Id. So a drive's history contains many revisions per entity,
 * and "the current state" is the newest revision of each ID. Getting this reduction wrong is the
 * classic ArFS client bug — you show stale filenames, or a file reappears in the folder it was
 * moved out of.
 */

import type { DriveEntity, FileEntity, FolderEntity, ResolvedEntity } from './types';

/**
 * Is `a` a newer revision than `b`?
 *
 * Block height is authoritative. A pending transaction (height null) is by definition newer than
 * anything mined. Unix-Time breaks height ties (several revisions commonly land in one block), and
 * the transaction ID is a final deterministic tiebreak so the result never depends on input order.
 *
 * One case needs handling before any of that: `a` and `b` can be the *same* transaction observed
 * twice — an optimistic write recorded locally as pending, later re-ingested by a real sync once
 * it mines. That isn't a new revision at all, so "pending beats mined" must not apply; instead the
 * record with a confirmed height simply wins, since it's strictly more information about the exact
 * same transaction. Skipping this check would let a stale optimistic entry outrank its own
 * confirmation forever.
 */
export function isNewerRevision(a: ResolvedEntity, b: ResolvedEntity): boolean {
  if (a.metadataTxId === b.metadataTxId) {
    if (a.height !== b.height) return a.height !== null;
    return false;
  }
  const ah = a.height ?? Number.POSITIVE_INFINITY;
  const bh = b.height ?? Number.POSITIVE_INFINITY;
  if (ah !== bh) return ah > bh;
  if (a.unixTime !== b.unixTime) return a.unixTime > b.unixTime;
  return a.metadataTxId > b.metadataTxId;
}

/** Reduce every revision to the current state of each entity ID. */
export function latestByEntityId<T extends ResolvedEntity>(entities: readonly T[]): Map<string, T> {
  const latest = new Map<string, T>();
  for (const entity of entities) {
    const existing = latest.get(entity.entityId);
    if (!existing || isNewerRevision(entity, existing)) latest.set(entity.entityId, entity);
  }
  return latest;
}

/**
 * All revisions of each entity ID, newest first — powers the version-history panel.
 *
 * Deduplicated by transaction ID: sync deliberately fetches some entities more than once (the
 * root is primed ahead of the bulk walk), and the same revision must not be listed twice.
 */
export function revisionsByEntityId(entities: readonly ResolvedEntity[]): Map<string, ResolvedEntity[]> {
  const byId = new Map<string, Map<string, ResolvedEntity>>();
  for (const entity of entities) {
    const list = byId.get(entity.entityId);
    if (list) list.set(entity.metadataTxId, entity);
    else byId.set(entity.entityId, new Map([[entity.metadataTxId, entity]]));
  }

  const out = new Map<string, ResolvedEntity[]>();
  for (const [entityId, revisions] of byId) {
    out.set(entityId, [...revisions.values()].sort((a, b) => (isNewerRevision(a, b) ? -1 : 1)));
  }
  return out;
}

export interface DriveTree {
  drive: DriveEntity | null;
  rootFolderId: string;
  foldersById: Map<string, FolderEntity>;
  filesById: Map<string, FileEntity>;
  /** parentFolderId -> child folders */
  childFolders: Map<string, FolderEntity[]>;
  /** parentFolderId -> child files */
  childFiles: Map<string, FileEntity[]>;
  revisions: Map<string, ResolvedEntity[]>;
  /** Entities whose parent folder is unknown — usually mid-sync, occasionally genuine damage. */
  orphans: (FolderEntity | FileEntity)[];
}

/**
 * Build a navigable tree from a drive's full revision history.
 *
 * The drive's own root folder ID is preferred as the tree root; if the drive entity isn't
 * available (private drive, or still syncing) we fall back to the folder that has no parent.
 */
export function buildTree(entities: readonly ResolvedEntity[]): DriveTree {
  const revisions = revisionsByEntityId(entities);
  const latest = latestByEntityId(entities);

  let drive: DriveEntity | null = null;
  const foldersById = new Map<string, FolderEntity>();
  const filesById = new Map<string, FileEntity>();

  for (const entity of latest.values()) {
    if (entity.entityType === 'drive') {
      if (!drive || isNewerRevision(entity, drive)) drive = entity;
    } else if (entity.entityType === 'folder') {
      foldersById.set(entity.entityId, entity);
    } else {
      filesById.set(entity.entityId, entity);
    }
  }

  let rootFolderId = drive?.rootFolderId ?? '';
  if (!rootFolderId || !foldersById.has(rootFolderId)) {
    const parentless = [...foldersById.values()].find((f) => !f.parentFolderId);
    if (parentless) rootFolderId = parentless.entityId;
  }

  const childFolders = new Map<string, FolderEntity[]>();
  const childFiles = new Map<string, FileEntity[]>();
  const orphans: (FolderEntity | FileEntity)[] = [];

  const push = <T>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  for (const folder of foldersById.values()) {
    if (folder.entityId === rootFolderId) continue;
    const parent = folder.parentFolderId;
    if (parent && (foldersById.has(parent) || parent === rootFolderId)) push(childFolders, parent, folder);
    else orphans.push(folder);
  }

  for (const file of filesById.values()) {
    const parent = file.parentFolderId;
    if (parent && (foldersById.has(parent) || parent === rootFolderId)) push(childFiles, parent, file);
    else orphans.push(file);
  }

  return { drive, rootFolderId, foldersById, filesById, childFolders, childFiles, revisions, orphans };
}

/** Breadcrumb trail from the root down to `folderId`, inclusive. */
export function pathTo(tree: DriveTree, folderId: string): FolderEntity[] {
  const trail: FolderEntity[] = [];
  const seen = new Set<string>();
  let current: string | undefined = folderId;

  while (current && !seen.has(current)) {
    seen.add(current);
    const folder = tree.foldersById.get(current);
    if (!folder) break;
    trail.unshift(folder);
    if (folder.entityId === tree.rootFolderId) break;
    current = folder.parentFolderId;
  }
  return trail;
}

/** Full slash-separated path of a file, for search results and the details panel. */
export function filePath(tree: DriveTree, file: FileEntity): string {
  const parent = file.parentFolderId;
  if (!parent) return file.name;
  const trail = pathTo(tree, parent)
    .filter((f) => f.entityId !== tree.rootFolderId)
    .map((f) => f.name);
  return [...trail, file.name].join('/');
}

/**
 * Every folder ID in `folderId`'s subtree, including itself.
 *
 * Used to stop a folder being moved into its own descendant — the write would succeed (ArFS has
 * no server-side check for this), but the result is an unreachable cycle: nothing in the tree
 * would ever be able to reach the drive's root again by walking parents.
 */
export function descendantFolderIds(tree: DriveTree, folderId: string): Set<string> {
  const ids = new Set<string>();
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    for (const child of tree.childFolders.get(id) ?? []) stack.push(child.entityId);
  }
  return ids;
}

export interface FolderOption {
  folder: FolderEntity;
  depth: number;
}

/**
 * Every folder in the drive as a depth-annotated, depth-first list — the shape a simple indented
 * picker needs. The root folder is included first, at depth 0.
 */
export function listFoldersForPicker(tree: DriveTree): FolderOption[] {
  const out: FolderOption[] = [];
  const root = tree.foldersById.get(tree.rootFolderId);
  if (!root) return out;

  const walk = (folder: FolderEntity, depth: number) => {
    out.push({ folder, depth });
    const children = [...(tree.childFolders.get(folder.entityId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const child of children) walk(child, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Recursive size and count of a folder's subtree. */
export function folderStats(tree: DriveTree, folderId: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const stack = [folderId];
  const seen = new Set<string>();

  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const file of tree.childFiles.get(id) ?? []) {
      files++;
      bytes += file.size;
    }
    for (const folder of tree.childFolders.get(id) ?? []) stack.push(folder.entityId);
  }
  return { files, bytes };
}
