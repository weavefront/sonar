/**
 * Golden test against real mainnet data — the actual compatibility check.
 *
 * Skipped unless SWIFTDRIVE_LIVE=1, because it hits public gateways and is slow. Run with:
 *
 *     npm run test:live
 *
 * The fixture drive is deliberately nasty, and matches what real ArDrive users have:
 *   - it is ArFS **0.11**, not 0.15, so version tolerance is exercised;
 *   - folder `32fc7816` was first written with **no parent**, then re-parented into the root, so a
 *     client that picks the wrong revision will mis-root the whole subtree;
 *   - file `58419704` (e.png) has **three revisions pointing at three different data transactions**,
 *     so a client that doesn't reduce by latest revision will show the file three times, or show it
 *     once with a stale data pointer.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { ArfsClient } from './sync';
import { buildTree, filePath, folderStats } from './tree';
import { cache } from '../cache/db';
import type { FileEntity } from './types';

const LIVE = process.env.SWIFTDRIVE_LIVE === '1';

const DRIVE_ID = 'bd55904b-1c6c-46d2-98f3-b6b472b60487';
const OWNER = 'g1hzNXVbh2M6LMQSUYp7HgkgxdadYqYEfw-HAajlms0';
const ROOT = '2bbd122d-83e3-4e11-8863-31beb598654c';
const SHARE_FOLDER = '33aa0c4b-e82c-4c13-a305-326e1dd04c33';
const AWESOME_FOLDER = '32fc7816-8a7a-4415-a481-fd07dc6a0d78';
const EPNG = '58419704-1d43-47b8-922e-29317c9a2e56';

describe.skipIf(!LIVE)('live mainnet drive', () => {
  let tree: ReturnType<typeof buildTree>;
  let entities: Awaited<ReturnType<ArfsClient['syncDrive']>>;

  beforeAll(async () => {
    await cache.clear();
    const client = new ArfsClient();
    entities = await client.syncDrive(DRIVE_ID, OWNER);
    tree = buildTree(entities);
  }, 180_000);

  it('finds the drive and its declared root folder', () => {
    expect(tree.drive?.name).toBe('ariel_test_9_9_1035amPDT');
    expect(tree.rootFolderId).toBe(ROOT);
  });

  it('reconstructs the exact folder hierarchy', () => {
    const top = (tree.childFolders.get(ROOT) ?? []).map((f) => f.name).sort();
    expect(top).toEqual(['Awesome Folder 5', 'Can you share folders?']);
    expect(tree.foldersById.size).toBe(3);
  });

  it('re-parents a folder whose first revision had no parent', () => {
    // Revision 1 of this folder is parentless; revision 2 moves it under root. Picking revision 1
    // would strand "Awesome Folder 5" and its two files outside the tree.
    expect(tree.foldersById.get(AWESOME_FOLDER)?.parentFolderId).toBe(ROOT);
    expect(tree.orphans).toHaveLength(0);
  });

  it('shows each file exactly once despite multiple revisions', () => {
    expect(tree.filesById.size).toBe(3);
    const awesome = (tree.childFiles.get(AWESOME_FOLDER) ?? []).map((f) => f.name).sort();
    expect(awesome).toEqual(['e.png', 'wonderful-test-file.txt']);
    expect((tree.childFiles.get(SHARE_FOLDER) ?? []).map((f) => f.name)).toEqual(['myTxtFile.txt']);
  });

  it('points a multi-revision file at its newest data transaction', () => {
    const epng = tree.filesById.get(EPNG)!;
    expect(epng.name).toBe('e.png');
    expect(epng.size).toBe(3755);
    expect(epng.dataContentType).toBe('image/png');
    // Three revisions exist with three different dataTxIds; the newest must win.
    expect(epng.dataTxId).toBe('SlT5kd4vr9x-DRyICtU7RvxsLnIzKFgDjIe-699WFOk');
  });

  it('keeps every revision available as version history', () => {
    const revisions = tree.revisions.get(EPNG) ?? [];
    expect(revisions.length).toBe(3);
    // Newest first.
    expect((revisions[0] as FileEntity).dataTxId).toBe('SlT5kd4vr9x-DRyICtU7RvxsLnIzKFgDjIe-699WFOk');
    const heights = revisions.map((r) => r.height!);
    expect([...heights]).toEqual([...heights].sort((a, b) => b - a));
  });

  it('computes paths and recursive folder sizes', () => {
    expect(filePath(tree, tree.filesById.get(EPNG)!)).toBe('Awesome Folder 5/e.png');
    expect(folderStats(tree, ROOT)).toEqual({ files: 3, bytes: 13 + 23 + 3755 });
  });

  it('parses this ArFS 0.11 drive without special-casing', () => {
    expect(entities.every((e) => e.arFsVersion === '0.11')).toBe(true);
  });

  it('serves a repeat sync from cache with no metadata fetches', async () => {
    // The performance guarantee, asserted rather than assumed.
    let fetches = 0;
    const counting: typeof fetch = (input, init) => {
      if (!String(input).includes('/graphql')) fetches++;
      return globalThis.fetch(input as RequestInfo, init);
    };

    const warm = new ArfsClient({ fetchImpl: counting });
    const again = await warm.syncDrive(DRIVE_ID, OWNER);

    expect(buildTree(again).filesById.size).toBe(3);
    expect(fetches).toBe(0);
  }, 120_000);
});

describe.skipIf(!LIVE)('live drive listing', () => {
  it('lists drives for an owner address', async () => {
    await cache.clear();
    const drives = await new ArfsClient().listDrives(OWNER);
    expect(drives.some((d) => d.entityId === DRIVE_ID)).toBe(true);
  }, 180_000);
});
