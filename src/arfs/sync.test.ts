import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArfsClient } from './sync';
import { __resetCacheForTests, cache } from '../cache/db';
import type { FileEntity } from './types';

const DRIVE_ID = 'drive-1';
const OWNER = 'OWNER';

function unresolvedFile(over: Partial<FileEntity> = {}): FileEntity {
  return {
    metadataTxId: 'meta-tx-1',
    entityType: 'file',
    entityId: 'file-1',
    driveId: DRIVE_ID,
    parentFolderId: 'root',
    privacy: 'public',
    unixTime: 1_700_000_000,
    height: 100,
    minedAt: 1_700_000_000,
    owner: OWNER,
    arFsVersion: '0.15',
    contentType: 'application/json',
    isHidden: false,
    unresolved: true,
    name: 'Unavailable file meta-tx1',
    size: 0,
    lastModifiedDate: 1_700_000_000_000,
    dataTxId: '',
    dataContentType: 'application/octet-stream',
    ...over,
  };
}

/** Every GraphQL query, from any gateway, comes back empty — enough to satisfy `currentHeight`,
 *  `queryFirst`, and `paginate` without any real transactions to walk. */
function emptyGraphqlResponse() {
  return new Response(
    JSON.stringify({ data: { blocks: { edges: [] }, transactions: { edges: [], pageInfo: { hasNextPage: false } } } }),
    { status: 200 },
  );
}

beforeEach(async () => {
  await cache.clear();
  __resetCacheForTests();
});

describe('ArfsClient.syncDrive — healing unresolved entities', () => {
  it('resolves a file that only the second gateway actually has, on the default (single-gateway) client', async () => {
    // Seeds exactly the situation a real gateway inconsistency produces: a cached entity whose
    // body couldn't be read last time, and a watermark already set so this run takes the cheap
    // incremental path rather than a full cold sync.
    await cache.putEntities([unresolvedFile()]);
    await cache.setSync(`drive:${DRIVE_ID}`, 1_000_000);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/graphql')) return emptyGraphqlResponse();
      if (url.startsWith('https://arweave.net/')) return new Response('not found', { status: 404 });
      if (url.startsWith('https://turbo-gateway.com/')) {
        return new Response(
          JSON.stringify({
            name: 'real-photo.jpg',
            size: 4096,
            lastModifiedDate: 1_700_000_000_000,
            dataTxId: 'DATA_TX',
            dataContentType: 'image/jpeg',
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    // No `gateways` option — the same way `state/arfs.ts` constructs its one shared client.
    // Before the fix, healing inherited this single-gateway default and could never succeed here.
    const client = new ArfsClient({ fetchImpl });
    const entities = await client.syncDrive(DRIVE_ID, OWNER);

    // `syncDrive` returns every revision it has seen (`buildTree` is what reduces these to
    // current state) — the original cached-unresolved entity and the freshly healed one are both
    // present as separate array entries, so this takes the *last* one, matching what a real
    // consumer would end up displaying.
    const matches = entities.filter((e) => e.entityId === 'file-1');
    const healed = matches[matches.length - 1];
    expect(healed?.unresolved).not.toBe(true);
    expect((healed as FileEntity | undefined)?.name).toBe('real-photo.jpg');
    expect((healed as FileEntity | undefined)?.dataTxId).toBe('DATA_TX');
  });

  it('leaves the entity unresolved, without throwing, if no configured gateway has it', async () => {
    await cache.putEntities([unresolvedFile()]);
    await cache.setSync(`drive:${DRIVE_ID}`, 1_000_000);

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/graphql')) return emptyGraphqlResponse();
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const client = new ArfsClient({ fetchImpl });
    const entities = await client.syncDrive(DRIVE_ID, OWNER);

    const stillUnresolved = entities.find((e) => e.entityId === 'file-1');
    expect(stillUnresolved?.unresolved).toBe(true);
  });
});
