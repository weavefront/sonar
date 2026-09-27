import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadAsZip, filesUnderSelection, type SelectionItem } from './download';
import { buildTree } from './tree';
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

describe('filesUnderSelection', () => {
  it('gives a directly-checked file a flat zip path', () => {
    const tree = buildTree([drive(), file('a', 'root', { name: 'report.pdf' })]);
    const items: SelectionItem[] = [{ kind: 'file', file: tree.filesById.get('a')! }];
    expect(filesUnderSelection(items, tree)).toEqual([{ file: tree.filesById.get('a'), zipPath: 'report.pdf' }]);
  });

  it('recurses a checked folder into folder/.../file paths', () => {
    const tree = buildTree([
      drive(),
      folder('photos', 'root', { name: 'Photos' }),
      folder('2024', 'photos', { name: '2024' }),
      file('a', 'photos', { name: 'cover.jpg' }),
      file('b', '2024', { name: 'trip.jpg' }),
    ]);
    const items: SelectionItem[] = [{ kind: 'folder', folder: tree.foldersById.get('photos')! }];
    const result = filesUnderSelection(items, tree);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.zipPath).sort()).toEqual(['Photos/2024/trip.jpg', 'Photos/cover.jpg']);
  });

  it('de-duplicates a name collision, Explorer-style', () => {
    const tree = buildTree([
      drive(),
      file('a', 'root', { name: 'photo.jpg' }),
      file('b', 'root', { name: 'photo.jpg' }),
      file('c', 'root', { name: 'photo.jpg' }),
    ]);
    const items: SelectionItem[] = [
      { kind: 'file', file: tree.filesById.get('a')! },
      { kind: 'file', file: tree.filesById.get('b')! },
      { kind: 'file', file: tree.filesById.get('c')! },
    ];
    const paths = filesUnderSelection(items, tree).map((r) => r.zipPath);
    expect(paths).toEqual(['photo.jpg', 'photo (2).jpg', 'photo (3).jpg']);
  });

  it('de-duplicates across a flat selection and a recursed folder together', () => {
    // A directly-checked file and a same-named file inside a checked folder both land at the zip
    // root — ArFS doesn't enforce unique names within a folder, and separately-checked items can
    // collide the same way once flattened into one archive.
    const tree = buildTree([
      drive(),
      folder('sub', 'root', { name: 'sub' }),
      file('a', 'root', { name: 'notes.txt' }),
      file('b', 'sub', { name: 'notes.txt' }),
    ]);
    const items: SelectionItem[] = [
      { kind: 'file', file: tree.filesById.get('a')! },
      { kind: 'folder', folder: tree.foldersById.get('sub')! },
    ];
    const paths = filesUnderSelection(items, tree).map((r) => r.zipPath);
    expect(paths).toEqual(['notes.txt', 'sub/notes.txt']);
  });

  it('skips files with no data transaction, both flat and recursed', () => {
    const tree = buildTree([
      drive(),
      folder('sub', 'root', { name: 'sub' }),
      file('a', 'root', { name: 'ready.txt' }),
      file('b', 'root', { name: 'unresolved.txt', dataTxId: '' }),
      file('c', 'sub', { name: 'also-unresolved.txt', dataTxId: '' }),
    ]);
    const items: SelectionItem[] = [
      { kind: 'file', file: tree.filesById.get('a')! },
      { kind: 'file', file: tree.filesById.get('b')! },
      { kind: 'folder', folder: tree.foldersById.get('sub')! },
    ];
    const paths = filesUnderSelection(items, tree).map((r) => r.zipPath);
    expect(paths).toEqual(['ready.txt']);
  });
});

describe('filesUnderSelection — hostile names', () => {
  it('never emits a path-traversal segment, even from folders literally named ".."', () => {
    // A public drive anyone can share: folders "..", "..", then a file ".bashrc". This used to
    // produce the zip entry "../../.bashrc" — the Zip Slip path out of the extraction folder.
    const tree = buildTree([
      drive(),
      folder('up1', 'root', { name: '..' }),
      folder('up2', 'up1', { name: '..' }),
      folder('dot', 'up2', { name: '.' }),
      file('a', 'dot', { name: '.bashrc' }),
    ]);
    const [item] = filesUnderSelection([{ kind: 'folder', folder: tree.foldersById.get('up1')! }], tree);
    const segments = item!.zipPath.split('/');
    expect(segments).not.toContain('..');
    expect(segments).not.toContain('.');
    expect(item!.zipPath).toBe('_/_/_/.bashrc');
  });

  it('strips control characters and separators from names', () => {
    const tree = buildTree([drive(), file('a', 'root', { name: 'a\u0000b\nc/d\\e.txt' })]);
    const [item] = filesUnderSelection([{ kind: 'file', file: tree.filesById.get('a')! }], tree);
    expect(item!.zipPath).toBe('a_b_c_d_e.txt');
  });
});

describe('downloadAsZip — cancellation', () => {
  afterEach(() => vi.unstubAllGlobals());

  const items = () => {
    const tree = buildTree([drive(), file('a', 'root', { name: 'a.txt' }), file('b', 'root', { name: 'b.txt' })]);
    return filesUnderSelection(
      [...tree.filesById.values()].map((f) => ({ kind: 'file' as const, file: f })),
      tree,
    );
  };

  it('produces a complete archive when not cancelled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')));
    const { response, failed } = downloadAsZip(items());
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(failed).toEqual([]);
    // Local file header signature "PK\x03\x04" — a real zip came out.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('errors the archive stream on cancel instead of finalizing a partial zip', async () => {
    // Returning early used to end the stream *normally*, so a valid partial zip was saved (or a
    // download popped up) after the user pressed Cancel. It must fail instead, so the writable is
    // aborted and nothing gets saved.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello')));
    const signal = { aborted: true };
    const { response } = downloadAsZip(items(), { signal });
    await expect(response.arrayBuffer()).rejects.toThrow();
  });
});
