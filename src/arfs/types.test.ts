import { describe, expect, it } from 'vitest';
import { parseStub, tagMap, type GqlNode } from './types';

function node(tags: Record<string, string>, over: Partial<GqlNode> = {}): GqlNode {
  return {
    id: 'tx1',
    owner: { address: 'OWNER' },
    block: { height: 100, timestamp: 1_700_000_000 },
    tags: Object.entries(tags).map(([name, value]) => ({ name, value })),
    ...over,
  };
}

describe('tagMap', () => {
  it('keeps the first value when a tag name repeats', () => {
    const m = tagMap([
      { name: 'A', value: 'first' },
      { name: 'A', value: 'second' },
    ]);
    expect(m.get('A')).toBe('first');
  });
});

describe('parseStub', () => {
  it('parses a v0.15 public file', () => {
    const stub = parseStub(
      node({
        ArFS: '0.15',
        'Entity-Type': 'file',
        'Drive-Id': 'drive-1',
        'File-Id': 'file-1',
        'Parent-Folder-Id': 'folder-1',
        'Drive-Privacy': 'public',
        'Unix-Time': '1700000000',
        'Content-Type': 'application/json',
      }),
    );
    expect(stub).toMatchObject({
      entityType: 'file',
      entityId: 'file-1',
      driveId: 'drive-1',
      parentFolderId: 'folder-1',
      privacy: 'public',
      unixTime: 1_700_000_000,
      height: 100,
      owner: 'OWNER',
    });
  });

  it('uses Drive-Id as the entity id for drives', () => {
    const stub = parseStub(node({ 'Entity-Type': 'drive', 'Drive-Id': 'drive-1' }));
    expect(stub?.entityId).toBe('drive-1');
  });

  it('tolerates ArFS 0.11 entities that omit Drive-Privacy', () => {
    // Live mainnet still serves 0.11 drives; dropping them would hide real user files.
    const stub = parseStub(
      node({ ArFS: '0.11', 'Entity-Type': 'folder', 'Drive-Id': 'd', 'Folder-Id': 'f' }),
    );
    expect(stub).toMatchObject({ entityType: 'folder', privacy: 'public', arFsVersion: '0.11' });
  });

  it('infers private from a Cipher tag when Drive-Privacy is absent', () => {
    const stub = parseStub(
      node({ 'Entity-Type': 'file', 'Drive-Id': 'd', 'File-Id': 'f', Cipher: 'AES256-GCM', 'Cipher-IV': 'aXY=' }),
    );
    expect(stub).toMatchObject({ privacy: 'private', cipher: 'AES256-GCM', cipherIv: 'aXY=' });
  });

  it('marks unmined transactions with a null height', () => {
    const stub = parseStub(node({ 'Entity-Type': 'drive', 'Drive-Id': 'd' }, { block: null }));
    expect(stub?.height).toBeNull();
    expect(stub?.minedAt).toBeNull();
  });

  it.each([
    ['an unknown entity type', { 'Entity-Type': 'nonsense', 'Drive-Id': 'd' }],
    ['a missing Drive-Id', { 'Entity-Type': 'file', 'File-Id': 'f' }],
    ['a missing File-Id', { 'Entity-Type': 'file', 'Drive-Id': 'd' }],
    ['a missing Folder-Id', { 'Entity-Type': 'folder', 'Drive-Id': 'd' }],
    ['no ArFS tags at all', { 'Content-Type': 'text/plain' }],
  ])('rejects %s', (_label, tags) => {
    expect(parseStub(node(tags))).toBeNull();
  });

  it('defaults a malformed Unix-Time to 0 rather than NaN', () => {
    const stub = parseStub(node({ 'Entity-Type': 'drive', 'Drive-Id': 'd', 'Unix-Time': 'not-a-number' }));
    expect(stub?.unixTime).toBe(0);
  });
});
