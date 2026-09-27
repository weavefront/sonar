import { describe, expect, it } from 'vitest';
import { buildDriveEntity, buildFileEntity, buildFolderEntity, newEntityId } from './entities';
import { buildTree, isNewerRevision, latestByEntityId } from '../tree';

describe('newEntityId', () => {
  it('produces distinct v4 UUIDs', () => {
    const a = newEntityId();
    const b = newEntityId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

describe('optimistic entities', () => {
  it('builds a pending drive with height/minedAt null', () => {
    const drive = buildDriveEntity({
      metadataTxId: 'tx1',
      driveId: 'd1',
      owner: 'OWNER',
      name: 'My Drive',
      rootFolderId: 'root',
    });
    expect(drive).toMatchObject({ entityType: 'drive', height: null, minedAt: null, privacy: 'public' });
  });

  it('a pending file wins over an older mined revision of the same File-Id', () => {
    // This is the whole point of the optimistic-write design: a rename the user just made must
    // outrank a stale mined revision without any change to the tree reduction logic.
    const mined = buildFileEntity({
      metadataTxId: 'mined-tx',
      driveId: 'd1',
      owner: 'OWNER',
      fileId: 'f1',
      name: 'old-name.txt',
      parentFolderId: 'root',
      size: 10,
      lastModifiedDate: 1000,
      dataTxId: 'data-old',
      dataContentType: 'text/plain',
    });
    const mined2 = { ...mined, height: 500, minedAt: 500 };

    const pendingRename = buildFileEntity({
      metadataTxId: 'pending-tx',
      driveId: 'd1',
      owner: 'OWNER',
      fileId: 'f1',
      name: 'new-name.txt',
      parentFolderId: 'root',
      size: 10,
      lastModifiedDate: 2000,
      dataTxId: 'data-old',
      dataContentType: 'text/plain',
    });

    expect(isNewerRevision(pendingRename, mined2)).toBe(true);
    expect(latestByEntityId([mined2, pendingRename]).get('f1')?.name).toBe('new-name.txt');
  });

  it('a real sync of the same metadataTxId does not duplicate the optimistic entry', () => {
    const drive = buildDriveEntity({
      metadataTxId: 'tx-shared',
      driveId: 'd1',
      owner: 'OWNER',
      name: 'Drive',
      rootFolderId: 'root',
    });
    const folder = buildFolderEntity({
      metadataTxId: 'folder-tx',
      driveId: 'd1',
      owner: 'OWNER',
      folderId: 'root',
      name: 'Root',
    });
    // Simulate the background resync re-ingesting the exact same transaction, now mined.
    const reingested = { ...drive, height: 900, minedAt: 900 };

    const tree = buildTree([drive, folder, reingested]);
    expect(tree.drive?.height).toBe(900);
    expect(tree.revisions.get('d1')).toHaveLength(1);
  });

  it('places a newly created file under its parent folder immediately', () => {
    const drive = buildDriveEntity({ metadataTxId: 't1', driveId: 'd1', owner: 'O', name: 'D', rootFolderId: 'root' });
    const root = buildFolderEntity({ metadataTxId: 't2', driveId: 'd1', owner: 'O', folderId: 'root', name: 'Root' });
    const file = buildFileEntity({
      metadataTxId: 't3',
      driveId: 'd1',
      owner: 'O',
      fileId: 'f1',
      name: 'new.txt',
      parentFolderId: 'root',
      size: 3,
      lastModifiedDate: Date.now(),
      dataTxId: 'data1',
      dataContentType: 'text/plain',
    });

    const tree = buildTree([drive, root, file]);
    expect(tree.childFiles.get('root')?.map((f) => f.entityId)).toEqual(['f1']);
  });
});
