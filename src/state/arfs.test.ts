import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useArfs } from './arfs';
import { ArfsClient } from '../arfs/sync';
import { buildTree } from '../arfs/tree';
import { __resetCacheForTests, cache } from '../cache/db';
import type { DriveEntity, FileEntity, FolderEntity } from '../arfs/types';

const drive = (over: Partial<DriveEntity> = {}): DriveEntity => ({
  metadataTxId: 'dtx',
  entityType: 'drive',
  entityId: 'd1',
  driveId: 'd1',
  privacy: 'public',
  unixTime: 1,
  height: 100,
  minedAt: 1,
  owner: 'OWNER',
  arFsVersion: '0.15',
  contentType: 'application/json',
  name: 'Drive',
  isHidden: false,
  rootFolderId: 'root',
  ...over,
});

const folder = (over: Partial<FolderEntity> = {}): FolderEntity => ({
  metadataTxId: 'ftx',
  entityType: 'folder',
  entityId: 'root',
  driveId: 'd1',
  privacy: 'public',
  unixTime: 1,
  height: 100,
  minedAt: 1,
  owner: 'OWNER',
  arFsVersion: '0.15',
  contentType: 'application/json',
  name: 'Root',
  isHidden: false,
  ...over,
});

const file = (over: Partial<FileEntity> = {}): FileEntity => ({
  metadataTxId: 'newtx',
  entityType: 'file',
  entityId: 'f1',
  driveId: 'd1',
  parentFolderId: 'root',
  privacy: 'public',
  unixTime: 2,
  height: null,
  minedAt: null,
  owner: 'OWNER',
  arFsVersion: '0.15',
  contentType: 'application/json',
  name: 'new.txt',
  isHidden: false,
  size: 3,
  lastModifiedDate: Date.now(),
  dataTxId: 'data1',
  dataContentType: 'text/plain',
  ...over,
});

beforeEach(async () => {
  await cache.clear();
  __resetCacheForTests();
  useArfs.getState().reset();
});

describe('applyLocalMutation', () => {
  it('adds a newly created drive to the drive list', () => {
    useArfs.setState({ drives: [] });
    useArfs.getState().applyLocalMutation([drive({ name: 'Brand New' })]);
    expect(useArfs.getState().drives.map((d) => d.name)).toEqual(['Brand New']);
  });

  it('updates an existing drive in place rather than duplicating it', () => {
    useArfs.setState({ drives: [drive({ name: 'Old Name' })] });
    useArfs.getState().applyLocalMutation([drive({ metadataTxId: 'dtx2', name: 'Renamed', height: null })]);
    const drives = useArfs.getState().drives;
    expect(drives).toHaveLength(1);
    expect(drives[0]?.name).toBe('Renamed');
  });

  it('splices a new file into the currently open drive tree immediately', () => {
    useArfs.setState({ activeDriveId: 'd1', entities: [drive(), folder()], tree: null });
    expect(useArfs.getState().tree).toBeNull();

    useArfs.getState().applyLocalMutation([file()]);

    const after = useArfs.getState();
    expect(after.tree?.childFiles.get('root')?.map((f) => f.entityId)).toEqual(['f1']);
  });

  it('ignores a mutation belonging to a drive that is not currently open', () => {
    useArfs.setState({ activeDriveId: 'other-drive', entities: [], tree: null });
    useArfs.getState().applyLocalMutation([file()]);
    expect(useArfs.getState().entities).toHaveLength(0);
    expect(useArfs.getState().tree).toBeNull();
  });

  it('persists written entities to the cache', async () => {
    useArfs.setState({ activeDriveId: 'd1', entities: [], tree: null });
    useArfs.getState().applyLocalMutation([file()]);
    // putEntities is fire-and-forget; give the microtask queue a tick.
    await Promise.resolve();
    await Promise.resolve();
    const cached = await cache.entitiesByDrive('d1');
    expect(cached.map((e) => e.entityId)).toContain('f1');
  });

  it('is a no-op for an empty write', () => {
    const before = useArfs.getState();
    useArfs.getState().applyLocalMutation([]);
    expect(useArfs.getState()).toEqual(before);
  });
});

describe('pollPending', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges only genuinely new results, skipping syncDrive\'s initial cache re-emit', async () => {
    const seed = [drive(), folder()];
    useArfs.setState({ activeDriveId: 'd1', entities: seed, tree: buildTree(seed) });

    const confirmed = file({ height: 500, minedAt: 500 });
    vi.spyOn(ArfsClient.prototype, 'syncDrive').mockImplementation(async (_driveId, _owner, opts) => {
      opts?.onEntities?.([file()]); // the cache re-emit — must be ignored, it's already in state
      opts?.onEntities?.([confirmed]); // a genuinely new incremental result
      return [];
    });

    await useArfs.getState().pollPending('d1', 'OWNER');

    const matches = useArfs.getState().entities.filter((e) => e.entityId === 'f1');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ height: 500 });
  });

  it('rebuilds the tree so a newly confirmed entity is reflected immediately', async () => {
    const seed = [drive(), folder()];
    useArfs.setState({ activeDriveId: 'd1', entities: seed, tree: buildTree(seed) });

    vi.spyOn(ArfsClient.prototype, 'syncDrive').mockImplementation(async (_driveId, _owner, opts) => {
      opts?.onEntities?.([]);
      opts?.onEntities?.([file({ height: 500, minedAt: 500 })]);
      return [];
    });

    await useArfs.getState().pollPending('d1', 'OWNER');
    expect(useArfs.getState().tree?.childFiles.get('root')?.map((f) => f.entityId)).toEqual(['f1']);
  });

  it('does nothing if nothing new came back', async () => {
    const seed = [drive(), folder()];
    useArfs.setState({ activeDriveId: 'd1', entities: seed, tree: buildTree(seed) });
    const treeBefore = useArfs.getState().tree;

    vi.spyOn(ArfsClient.prototype, 'syncDrive').mockImplementation(async (_driveId, _owner, opts) => {
      opts?.onEntities?.([]); // cache re-emit only, nothing new
      return [];
    });

    await useArfs.getState().pollPending('d1', 'OWNER');
    expect(useArfs.getState().entities).toEqual(seed);
    expect(useArfs.getState().tree).toBe(treeBefore); // no pointless rebuild either
  });

  it('discards results for a drive the user has since navigated away from', async () => {
    useArfs.setState({ activeDriveId: 'd1', entities: [], tree: null });

    vi.spyOn(ArfsClient.prototype, 'syncDrive').mockImplementation(async (_driveId, _owner, opts) => {
      opts?.onEntities?.([]);
      useArfs.setState({ activeDriveId: 'other-drive' }); // navigated away mid-poll
      opts?.onEntities?.([file()]);
      return [];
    });

    await useArfs.getState().pollPending('d1', 'OWNER');
    expect(useArfs.getState().entities).toHaveLength(0);
  });

  it('does nothing at all if the polled drive is not the active one', async () => {
    useArfs.setState({ activeDriveId: 'other-drive', entities: [], tree: null });
    const spy = vi.spyOn(ArfsClient.prototype, 'syncDrive');

    await useArfs.getState().pollPending('d1', 'OWNER');
    expect(spy).not.toHaveBeenCalled();
  });
});
