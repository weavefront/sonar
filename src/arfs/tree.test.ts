import { describe, expect, it } from 'vitest';
import {
  buildTree,
  descendantFolderIds,
  filePath,
  folderStats,
  isNewerRevision,
  latestByEntityId,
  listFoldersForPicker,
  pathTo,
  revisionsByEntityId,
} from './tree';
import type { DriveEntity, FileEntity, FolderEntity, ResolvedEntity } from './types';

let txCounter = 0;

function base(over: Partial<ResolvedEntity> = {}) {
  return {
    metadataTxId: over.metadataTxId ?? `tx${++txCounter}`,
    driveId: 'drive-1',
    privacy: 'public' as const,
    unixTime: 1_000,
    height: 100,
    minedAt: 1_000,
    owner: 'OWNER',
    arFsVersion: '0.15',
    contentType: 'application/json',
    isHidden: false,
  };
}

const drive = (over: Partial<DriveEntity> = {}): DriveEntity => ({
  ...base(over),
  entityType: 'drive',
  entityId: 'drive-1',
  name: 'My Drive',
  rootFolderId: 'root',
  ...over,
});

const folder = (id: string, parent: string | undefined, over: Partial<FolderEntity> = {}): FolderEntity => ({
  ...base(over),
  entityType: 'folder',
  entityId: id,
  name: `folder-${id}`,
  ...(parent ? { parentFolderId: parent } : {}),
  ...over,
});

const file = (id: string, parent: string, over: Partial<FileEntity> = {}): FileEntity => ({
  ...base(over),
  entityType: 'file',
  entityId: id,
  name: `file-${id}`,
  parentFolderId: parent,
  size: 10,
  lastModifiedDate: 1_000_000,
  dataTxId: `data-${id}`,
  dataContentType: 'text/plain',
  ...over,
});

describe('isNewerRevision', () => {
  it('ranks by block height', () => {
    expect(isNewerRevision(file('a', 'root', { height: 200 }), file('a', 'root', { height: 100 }))).toBe(true);
  });

  it('treats a pending transaction as newer than any mined one', () => {
    // A rename that hasn't been mined yet is still the user's latest intent.
    expect(isNewerRevision(file('a', 'root', { height: null }), file('a', 'root', { height: 999 }))).toBe(true);
  });

  it('breaks height ties with Unix-Time', () => {
    const newer = file('a', 'root', { height: 100, unixTime: 50 });
    const older = file('a', 'root', { height: 100, unixTime: 10 });
    expect(isNewerRevision(newer, older)).toBe(true);
  });

  it('prefers a mined confirmation over its own earlier pending sighting', () => {
    // Not two revisions — the SAME transaction observed twice (e.g. a locally-optimistic write
    // later re-ingested by a real sync once mined). "Pending beats mined" must not apply here, or
    // a confirmed transaction can never outrank its own stale pending placeholder.
    const pendingSighting = file('a', 'root', { metadataTxId: 'tx-x', height: null });
    const minedSighting = file('a', 'root', { metadataTxId: 'tx-x', height: 700 });
    expect(isNewerRevision(minedSighting, pendingSighting)).toBe(true);
    expect(isNewerRevision(pendingSighting, minedSighting)).toBe(false);
  });

  it('breaks full ties deterministically by transaction id', () => {
    const a = file('a', 'root', { height: 100, unixTime: 10, metadataTxId: 'aaa' });
    const b = file('a', 'root', { height: 100, unixTime: 10, metadataTxId: 'bbb' });
    expect(isNewerRevision(a, b)).toBe(false);
    expect(isNewerRevision(b, a)).toBe(true);
  });
});

describe('latestByEntityId', () => {
  it('is independent of input order', () => {
    const v1 = file('a', 'root', { height: 100, name: 'old.txt' });
    const v2 = file('a', 'root', { height: 200, name: 'new.txt' });
    expect(latestByEntityId([v1, v2]).get('a')?.name).toBe('new.txt');
    expect(latestByEntityId([v2, v1]).get('a')?.name).toBe('new.txt');
  });
});

describe('revisionsByEntityId', () => {
  it('returns every revision newest-first', () => {
    const v1 = file('a', 'root', { height: 100, name: 'v1' });
    const v2 = file('a', 'root', { height: 200, name: 'v2' });
    const v3 = file('a', 'root', { height: 300, name: 'v3' });
    expect(revisionsByEntityId([v1, v3, v2]).get('a')?.map((r) => r.name)).toEqual(['v3', 'v2', 'v1']);
  });
});

describe('buildTree', () => {
  it('nests folders and files under their parents', () => {
    const tree = buildTree([
      drive(),
      folder('root', undefined),
      folder('sub', 'root'),
      file('f1', 'root'),
      file('f2', 'sub'),
    ]);

    expect(tree.rootFolderId).toBe('root');
    expect(tree.childFolders.get('root')?.map((f) => f.entityId)).toEqual(['sub']);
    expect(tree.childFiles.get('root')?.map((f) => f.entityId)).toEqual(['f1']);
    expect(tree.childFiles.get('sub')?.map((f) => f.entityId)).toEqual(['f2']);
    expect(tree.orphans).toHaveLength(0);
  });

  it('shows a renamed file under its newest name only once', () => {
    const tree = buildTree([
      drive(),
      folder('root', undefined),
      file('f1', 'root', { height: 100, name: 'before.txt' }),
      file('f1', 'root', { height: 200, name: 'after.txt' }),
    ]);
    const files = tree.childFiles.get('root') ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe('after.txt');
  });

  it('does not leave a moved file in its old folder', () => {
    // The regression that matters most: the old revision still names `a` as parent.
    const tree = buildTree([
      drive(),
      folder('root', undefined),
      folder('a', 'root'),
      folder('b', 'root'),
      file('f1', 'a', { height: 100 }),
      file('f1', 'b', { height: 200 }),
    ]);
    expect(tree.childFiles.get('a') ?? []).toHaveLength(0);
    expect(tree.childFiles.get('b')?.map((f) => f.entityId)).toEqual(['f1']);
  });

  it('collects entities whose parent folder is unknown as orphans', () => {
    const tree = buildTree([drive(), folder('root', undefined), file('lost', 'missing-folder')]);
    expect(tree.orphans.map((o) => o.entityId)).toEqual(['lost']);
  });

  it('falls back to the parentless folder when the drive entity is absent', () => {
    const tree = buildTree([folder('root', undefined), file('f1', 'root')]);
    expect(tree.drive).toBeNull();
    expect(tree.rootFolderId).toBe('root');
    expect(tree.childFiles.get('root')).toHaveLength(1);
  });
});

describe('pathTo', () => {
  const tree = buildTree([
    drive(),
    folder('root', undefined, { name: 'Root' }),
    folder('a', 'root', { name: 'A' }),
    folder('b', 'a', { name: 'B' }),
    file('f1', 'b', { name: 'deep.txt' }),
  ]);

  it('returns the trail from root down to the folder', () => {
    expect(pathTo(tree, 'b').map((f) => f.name)).toEqual(['Root', 'A', 'B']);
  });

  it('terminates on a parent cycle instead of hanging', () => {
    const cyclic = buildTree([folder('x', 'y', { name: 'X' }), folder('y', 'x', { name: 'Y' })]);
    expect(() => pathTo(cyclic, 'x')).not.toThrow();
    expect(pathTo(cyclic, 'x').length).toBeLessThanOrEqual(2);
  });

  it('builds a full slash path for a file, excluding the root folder', () => {
    const f = tree.filesById.get('f1')!;
    expect(filePath(tree, f)).toBe('A/B/deep.txt');
  });
});

describe('descendantFolderIds', () => {
  const tree = buildTree([
    drive(),
    folder('root', undefined),
    folder('a', 'root'),
    folder('b', 'a'),
    folder('c', 'root'),
  ]);

  it('includes the folder itself and every descendant', () => {
    expect(descendantFolderIds(tree, 'a')).toEqual(new Set(['a', 'b']));
  });

  it('excludes siblings and ancestors', () => {
    const ids = descendantFolderIds(tree, 'a');
    expect(ids.has('c')).toBe(false);
    expect(ids.has('root')).toBe(false);
  });

  it('is exactly the whole tree when starting from the root', () => {
    expect(descendantFolderIds(tree, 'root')).toEqual(new Set(['root', 'a', 'b', 'c']));
  });
});

describe('listFoldersForPicker', () => {
  it('lists every folder depth-first with the root at depth 0', () => {
    const tree = buildTree([
      drive(),
      folder('root', undefined, { name: 'Root' }),
      folder('b', 'root', { name: 'B' }),
      folder('a', 'root', { name: 'A' }),
      folder('a1', 'a', { name: 'A1' }),
    ]);
    const options = listFoldersForPicker(tree);
    expect(options.map((o) => [o.folder.name, o.depth])).toEqual([
      ['Root', 0],
      ['A', 1],
      ['A1', 2],
      ['B', 1],
    ]);
  });
});

describe('folderStats', () => {
  it('totals files and bytes recursively', () => {
    const tree = buildTree([
      drive(),
      folder('root', undefined),
      folder('sub', 'root'),
      file('f1', 'root', { size: 100 }),
      file('f2', 'sub', { size: 250 }),
    ]);
    expect(folderStats(tree, 'root')).toEqual({ files: 2, bytes: 350 });
    expect(folderStats(tree, 'sub')).toEqual({ files: 1, bytes: 250 });
  });
});
