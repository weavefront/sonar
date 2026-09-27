import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useUploadQueue } from './write';
import { useArfs } from './arfs';
import { useWallet } from '../wallet/store';
import { __resetCacheForTests, cache } from '../cache/db';
import * as clientModule from '../turbo/client';
import * as uploadModule from '../turbo/upload';
import type { FileEntity, FolderEntity } from '../arfs/types';

vi.mock('../turbo/client', async () => {
  const actual = await vi.importActual<typeof import('../turbo/client')>('../turbo/client');
  return { ...actual, getTurboClient: vi.fn() };
});
vi.mock('../turbo/upload', async () => {
  const actual = await vi.importActual<typeof import('../turbo/upload')>('../turbo/upload');
  return { ...actual, uploadNewFile: vi.fn(), createFolder: vi.fn() };
});

const fakeTurbo = {
  getUploadCosts: vi.fn(async ({ bytes }: { bytes: number[] }) =>
    bytes.map((b) => ({ winc: String(b * 10), adjustments: [], fees: [] })),
  ),
} as unknown as clientModule.TurboClient;

function resultFile(over: Partial<FileEntity> = {}): FileEntity {
  return {
    metadataTxId: 'meta-tx',
    entityType: 'file',
    entityId: 'f1',
    driveId: 'd1',
    parentFolderId: 'root',
    privacy: 'public',
    unixTime: 1,
    height: null,
    minedAt: null,
    owner: 'OWNER',
    arFsVersion: '0.15',
    contentType: 'application/json',
    name: 'a.txt',
    isHidden: false,
    size: 5,
    lastModifiedDate: 1,
    dataTxId: 'data-tx',
    dataContentType: 'text/plain',
    ...over,
  };
}

function resultFolder(over: Partial<FolderEntity> = {}): FolderEntity {
  return {
    metadataTxId: 'folder-tx',
    entityType: 'folder',
    entityId: 'new-folder',
    driveId: 'd1',
    parentFolderId: 'root',
    privacy: 'public',
    unixTime: 1,
    height: null,
    minedAt: null,
    owner: 'OWNER',
    arFsVersion: '0.15',
    contentType: 'application/json',
    name: 'Sub',
    isHidden: false,
    ...over,
  };
}

beforeEach(async () => {
  await cache.clear();
  __resetCacheForTests();
  useArfs.getState().reset();
  useUploadQueue.setState({ items: [] });
  useWallet.setState({ address: 'OWNER', mode: 'wander', canSign: true, jwk: null, error: null, connecting: false });
  vi.mocked(clientModule.getTurboClient).mockResolvedValue(fakeTurbo);
  vi.mocked(uploadModule.uploadNewFile).mockReset();
  vi.mocked(uploadModule.createFolder).mockReset();
});

describe('stageFiles', () => {
  it('adds items in estimating status and then moves them to ready with a cost', async () => {
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    useUploadQueue.getState().stageFiles([file], 'd1', 'root');

    expect(useUploadQueue.getState().items[0]?.status).toBe('estimating');

    // stageFiles fires estimate() without awaiting it (drives from UI event handlers), so let
    // the microtask queue settle.
    await vi.waitFor(() => {
      expect(useUploadQueue.getState().items[0]?.status).toBe('ready');
    });
    expect(useUploadQueue.getState().items[0]?.costWinc).toBe(String(file.size * 10));
  });

  it('marks items as error when the session cannot sign', async () => {
    vi.mocked(clientModule.getTurboClient).mockRejectedValue(
      new clientModule.SigningUnavailableError('connect a wallet that can sign'),
    );
    const file = new File(['x'], 'a.txt');
    useUploadQueue.getState().stageFiles([file], 'd1', 'root');

    await vi.waitFor(() => {
      expect(useUploadQueue.getState().items[0]?.status).toBe('error');
    });
    expect(useUploadQueue.getState().items[0]?.error).toMatch(/sign/);
  });
});

describe('confirmUpload', () => {
  it('uploads every ready item and applies the result to app state', async () => {
    useArfs.setState({ activeDriveId: 'd1', entities: [], tree: null });
    vi.mocked(uploadModule.uploadNewFile).mockResolvedValue(resultFile());

    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    useUploadQueue.getState().stageFiles([file], 'd1', 'root');
    await vi.waitFor(() => expect(useUploadQueue.getState().items[0]?.status).toBe('ready'));

    await useUploadQueue.getState().confirmUpload();

    expect(useUploadQueue.getState().items[0]?.status).toBe('done');
    expect(useArfs.getState().entities.map((e) => e.entityId)).toContain('f1');
  });

  it('records a per-item error without aborting the rest of the batch', async () => {
    useArfs.setState({ activeDriveId: 'd1', entities: [], tree: null });
    vi.mocked(uploadModule.uploadNewFile)
      .mockRejectedValueOnce(new Error('insufficient balance'))
      .mockResolvedValueOnce(resultFile({ entityId: 'f2', metadataTxId: 'meta-tx-2' }));

    useUploadQueue.getState().stageFiles(
      [new File(['a'], 'fail.txt'), new File(['b'], 'ok.txt')],
      'd1',
      'root',
    );
    await vi.waitFor(() => {
      const items = useUploadQueue.getState().items;
      expect(items.every((i) => i.status === 'ready')).toBe(true);
    });

    await useUploadQueue.getState().confirmUpload();

    const items = useUploadQueue.getState().items;
    expect(items.map((i) => i.status)).toEqual(['error', 'done']);
    expect(items[0]?.error).toMatch(/insufficient balance/);
  });
});

function fileWithPath(path: string): File {
  const name = path.split('/').pop()!;
  const file = new File(['x'], name, { type: 'text/plain' });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('stageFileList (folder upload)', () => {
  it('derives relativePath from webkitRelativePath, excluding the file name', async () => {
    const list = { 0: fileWithPath('Album/2024/pic.png'), length: 1, item: () => null } as unknown as FileList;
    useUploadQueue.getState().stageFileList(list, 'd1', 'root');
    expect(useUploadQueue.getState().items[0]?.relativePath).toBe('Album/2024');
  });
});

describe('confirmUpload with folder structure', () => {
  it('creates each missing folder once, parent-first, then uploads the file into the leaf', async () => {
    useArfs.setState({ activeDriveId: 'd1', entities: [], tree: null });
    const created: string[] = [];
    vi.mocked(uploadModule.createFolder).mockImplementation(async ({ name, parentFolderId }) => {
      created.push(`${name}<-${parentFolderId}`);
      return resultFolder({ metadataTxId: `tx-${name}`, entityId: `id-${name}`, name, parentFolderId });
    });
    vi.mocked(uploadModule.uploadNewFile).mockImplementation(async (params) => ({
      metadataTxId: 'file-tx',
      entityType: 'file',
      entityId: 'f1',
      driveId: params.driveId,
      parentFolderId: params.parentFolderId,
      privacy: 'public',
      unixTime: 1,
      height: null,
      minedAt: null,
      owner: 'OWNER',
      arFsVersion: '0.15',
      contentType: 'application/json',
      name: params.file.name,
      isHidden: false,
      size: params.file.size,
      lastModifiedDate: 1,
      dataTxId: 'data-tx',
      dataContentType: 'text/plain',
    }));

    const list = {
      0: fileWithPath('Album/2024/pic.png'),
      1: fileWithPath('Album/2024/other.png'),
      length: 2,
      item: () => null,
    } as unknown as FileList;
    useUploadQueue.getState().stageFileList(list, 'd1', 'root');
    await vi.waitFor(() => {
      expect(useUploadQueue.getState().items.every((i) => i.status === 'ready')).toBe(true);
    });

    await useUploadQueue.getState().confirmUpload();

    // "Album" then "Album/2024" created exactly once each, not once per file.
    expect(created).toEqual(['Album<-root', '2024<-id-Album']);
    const items = useUploadQueue.getState().items;
    expect(items.every((i) => i.status === 'done')).toBe(true);
  });
});

describe('remove / clearFinished', () => {
  it('removes a single item', () => {
    useUploadQueue.setState({
      items: [{ id: 'a', file: new File([], 'x'), driveId: 'd', parentFolderId: 'p', relativePath: '', status: 'ready' }],
    });
    useUploadQueue.getState().remove('a');
    expect(useUploadQueue.getState().items).toHaveLength(0);
  });

  it('clears only completed items', () => {
    useUploadQueue.setState({
      items: [
        { id: 'a', file: new File([], 'x'), driveId: 'd', parentFolderId: 'p', relativePath: '', status: 'done' },
        { id: 'b', file: new File([], 'y'), driveId: 'd', parentFolderId: 'p', relativePath: '', status: 'error', error: 'oops' },
      ],
    });
    useUploadQueue.getState().clearFinished();
    expect(useUploadQueue.getState().items.map((i) => i.id)).toEqual(['b']);
  });
});
