import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createDrive,
  createFolder,
  createPrivateDrive,
  createPrivateFolder,
  estimateCost,
  uploadNewFile,
  uploadNewPrivateFile,
  writeFileRevision,
  writeFolderRevision,
  writePrivateFileRevision,
  writePrivateFolderRevision,
  UploadError,
} from './upload';
import { deriveDriveKey, deriveFileKey } from '../arfs/crypto/kdf';
import { decryptBytes, decryptJson } from '../arfs/crypto/cipher';
import type { FileEntity, FolderEntity } from '../arfs/types';
import type { TurboClient } from './client';

type Call = {
  kind: 'json' | 'binary' | 'file';
  data?: unknown;
  rawData?: Uint8Array<ArrayBuffer>;
  tags: { name: string; value: string }[];
};

/**
 * A fake Turbo client capturing every call it receives, so assertions can check the exact tags
 * and bodies sent — the actual compatibility surface with ArDrive. Public writes send a JSON
 * string (parsed eagerly, as before); private writes send raw ciphertext bytes (ArrayBuffer/
 * Uint8Array), captured as-is so a test can decrypt and assert on the real plaintext.
 */
function fakeTurbo() {
  const calls: Call[] = [];
  let nextId = 0;

  const turbo = {
    upload: vi.fn(async ({ data, dataItemOpts }: { data: string | ArrayBuffer | Uint8Array; dataItemOpts?: { tags?: { name: string; value: string }[] } }) => {
      if (typeof data === 'string') {
        calls.push({ kind: 'json', data: JSON.parse(data), tags: dataItemOpts?.tags ?? [] });
      } else {
        const rawData = (data instanceof Uint8Array ? data : new Uint8Array(data)) as Uint8Array<ArrayBuffer>;
        calls.push({ kind: 'binary', rawData, tags: dataItemOpts?.tags ?? [] });
      }
      return { id: `tx-${nextId++}` };
    }),
    uploadFile: vi.fn(
      async ({
        dataItemOpts,
        fileStreamFactory,
      }: {
        dataItemOpts?: { tags?: { name: string; value: string }[] };
        fileStreamFactory: () => ReadableStream;
      }) => {
        const rawData = new Uint8Array(await new Response(fileStreamFactory()).arrayBuffer());
        calls.push({ kind: 'file', rawData, tags: dataItemOpts?.tags ?? [] });
        return { id: `tx-${nextId++}` };
      },
    ),
    getUploadCosts: vi.fn(async ({ bytes }: { bytes: number[] }) => [{ winc: String(bytes[0]! * 100), adjustments: [], fees: [] }]),
    getBalance: vi.fn(async () => ({
      winc: '1000000',
      controlledWinc: '1000000',
      effectiveBalance: '1000000',
      receivedApprovals: [],
      givenApprovals: [],
    })),
  };

  return { turbo: turbo as unknown as TurboClient, calls };
}

function tagValue(tags: { name: string; value: string }[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

describe('createDrive', () => {
  it('writes a root folder then a drive entity that points at it', async () => {
    const { turbo, calls } = fakeTurbo();
    const { drive, rootFolder } = await createDrive({ turbo, name: 'My Drive', owner: 'OWNER' });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.data).toMatchObject({ name: 'My Drive' });
    expect(tagValue(calls[0]!.tags, 'Entity-Type')).toBe('folder');
    expect(tagValue(calls[0]!.tags, 'Parent-Folder-Id')).toBeUndefined();

    expect(calls[1]!.data).toMatchObject({ name: 'My Drive', rootFolderId: rootFolder.entityId });
    expect(tagValue(calls[1]!.tags, 'Entity-Type')).toBe('drive');

    expect(drive.rootFolderId).toBe(rootFolder.entityId);
    expect(drive.owner).toBe('OWNER');
  });
});

describe('createFolder', () => {
  it('tags the new folder with its parent', async () => {
    const { turbo, calls } = fakeTurbo();
    const folder = await createFolder({ turbo, driveId: 'd1', parentFolderId: 'root', name: 'Docs', owner: 'OWNER' });

    expect(tagValue(calls[0]!.tags, 'Parent-Folder-Id')).toBe('root');
    expect(tagValue(calls[0]!.tags, 'Drive-Id')).toBe('d1');
    expect(folder.name).toBe('Docs');
    expect(folder.parentFolderId).toBe('root');
  });
});

describe('uploadNewFile', () => {
  it('uploads bytes then metadata pointing at the data transaction', async () => {
    const { turbo, calls } = fakeTurbo();
    const file = new File(['hello world'], 'hello.txt', { type: 'text/plain' });

    const entity = await uploadNewFile({ turbo, driveId: 'd1', parentFolderId: 'root', file, owner: 'OWNER' });

    expect(calls).toHaveLength(2);
    // Data item: Content-Type + app tags only, no ArFS/Entity-Type.
    expect(calls[0]!.kind).toBe('file');
    expect(tagValue(calls[0]!.tags, 'Content-Type')).toBe('text/plain');
    expect(calls[0]!.tags.map((t) => t.name)).not.toContain('Entity-Type');

    // Metadata item: full ArFS tag set, JSON body pointing at the data tx.
    expect(calls[1]!.kind).toBe('json');
    expect(tagValue(calls[1]!.tags, 'Entity-Type')).toBe('file');
    expect(calls[1]!.data).toMatchObject({ name: 'hello.txt', dataContentType: 'text/plain' });

    expect(entity.dataTxId).toBe('tx-0');
    expect(entity.metadataTxId).toBe('tx-1');
    expect(entity.name).toBe('hello.txt');
  });

  it('falls back to a generic content type for an untyped file', async () => {
    const { turbo, calls } = fakeTurbo();
    const file = new File(['data'], 'blob', { type: '' });
    await uploadNewFile({ turbo, driveId: 'd1', parentFolderId: 'root', file, owner: 'OWNER' });
    expect(tagValue(calls[0]!.tags, 'Content-Type')).toBe('application/octet-stream');
  });

  it('uploads a thumbnail as its own data item and references it from the metadata JSON', async () => {
    const { turbo, calls } = fakeTurbo();
    const file = new File(['fake image bytes'], 'photo.png', { type: 'image/png' });
    const thumbnail = { blob: new Blob(['fake jpeg thumb'], { type: 'image/jpeg' }), width: 240, height: 180 };

    const entity = await uploadNewFile({ turbo, driveId: 'd1', parentFolderId: 'root', file, owner: 'OWNER', thumbnail });

    // data, thumbnail, metadata — three transactions instead of two.
    expect(calls).toHaveLength(3);
    expect(calls[0]!.kind).toBe('file'); // main data

    // Thumbnail data item: always image/jpeg regardless of the source format, no ArFS/Entity-Type.
    expect(calls[1]!.kind).toBe('file');
    expect(tagValue(calls[1]!.tags, 'Content-Type')).toBe('image/jpeg');
    expect(calls[1]!.tags.map((t) => t.name)).not.toContain('Entity-Type');

    expect(calls[2]!.kind).toBe('json');
    expect(calls[2]!.data).toMatchObject({
      thumbnail: { variants: [{ name: 'small', txId: 'tx-1', size: thumbnail.blob.size, width: 240, height: 180 }] },
    });

    expect(entity.thumbnail?.variants[0]).toMatchObject({ txId: 'tx-1', width: 240, height: 180 });
  });

  it('omits the thumbnail field entirely when none is given', async () => {
    const { turbo, calls } = fakeTurbo();
    const file = new File(['data'], 'plain.txt', { type: 'text/plain' });
    const entity = await uploadNewFile({ turbo, driveId: 'd1', parentFolderId: 'root', file, owner: 'OWNER' });
    expect(calls).toHaveLength(2);
    expect(entity.thumbnail).toBeUndefined();
    expect((calls[1]!.data as Record<string, unknown>).thumbnail).toBeUndefined();
  });
});

const baseFolder = (over: Partial<FolderEntity> = {}): FolderEntity => ({
  metadataTxId: 'old-tx',
  entityType: 'folder',
  entityId: 'folder-1',
  driveId: 'd1',
  parentFolderId: 'root',
  privacy: 'public',
  unixTime: 1000,
  height: 100,
  minedAt: 1000,
  owner: 'OWNER',
  arFsVersion: '0.15',
  contentType: 'application/json',
  name: 'Old Name',
  isHidden: false,
  ...over,
});

const baseFile = (over: Partial<FileEntity> = {}): FileEntity => ({
  metadataTxId: 'old-tx',
  entityType: 'file',
  entityId: 'file-1',
  driveId: 'd1',
  parentFolderId: 'root',
  privacy: 'public',
  unixTime: 1000,
  height: 100,
  minedAt: 1000,
  owner: 'OWNER',
  arFsVersion: '0.15',
  contentType: 'application/json',
  name: 'old.txt',
  isHidden: false,
  size: 10,
  lastModifiedDate: 1000,
  dataTxId: 'data-1',
  dataContentType: 'text/plain',
  ...over,
});

describe('writeFolderRevision', () => {
  it('changes only the requested field — rename', async () => {
    const { turbo } = fakeTurbo();
    const renamed = await writeFolderRevision({ turbo, folder: baseFolder(), name: 'New Name' });
    expect(renamed).toMatchObject({ name: 'New Name', parentFolderId: 'root', isHidden: false, entityId: 'folder-1' });
  });

  it('changes only the requested field — move', async () => {
    const { turbo } = fakeTurbo();
    const moved = await writeFolderRevision({ turbo, folder: baseFolder(), parentFolderId: 'other-folder' });
    expect(moved).toMatchObject({ name: 'Old Name', parentFolderId: 'other-folder' });
  });

  it('changes only the requested field — hide', async () => {
    const { turbo } = fakeTurbo();
    const hidden = await writeFolderRevision({ turbo, folder: baseFolder(), isHidden: true });
    expect(hidden).toMatchObject({ name: 'Old Name', isHidden: true });
  });

  it('produces a pending revision that outranks the mined one it replaces', async () => {
    const { turbo } = fakeTurbo();
    const renamed = await writeFolderRevision({ turbo, folder: baseFolder(), name: 'New Name' });
    expect(renamed.height).toBeNull();
    expect(renamed.metadataTxId).not.toBe('old-tx');
  });
});

describe('writeFileRevision', () => {
  it('rejects a file with no parent folder rather than writing an invalid entity', async () => {
    const { turbo } = fakeTurbo();
    await expect(
      writeFileRevision({ turbo, file: baseFile({ parentFolderId: undefined }), name: 'x' }),
    ).rejects.toThrow(UploadError);
  });

  it('preserves size/data pointer across a rename', async () => {
    const { turbo } = fakeTurbo();
    const renamed = await writeFileRevision({ turbo, file: baseFile(), name: 'new.txt' });
    expect(renamed).toMatchObject({ name: 'new.txt', size: 10, dataTxId: 'data-1', dataContentType: 'text/plain' });
  });
});

describe('estimateCost', () => {
  it('asks Turbo for a real price rather than assuming zero', async () => {
    const { turbo } = fakeTurbo();
    const cost = await estimateCost(turbo, 500);
    expect(turbo.getUploadCosts).toHaveBeenCalledWith({ bytes: [500] });
    expect(cost.winc).toBe('50000');
  });

  it('never asks for a zero-byte estimate', async () => {
    const { turbo } = fakeTurbo();
    await estimateCost(turbo, 0);
    expect(turbo.getUploadCosts).toHaveBeenCalledWith({ bytes: [1] });
  });
});

describe('error mapping', () => {
  it('turns an insufficient-balance rejection into an actionable message', async () => {
    const { turbo } = fakeTurbo();
    (turbo.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('insufficient balance for upload'));
    await expect(createFolder({ turbo, driveId: 'd', parentFolderId: 'root', name: 'x', owner: 'o' })).rejects.toThrow(
      /Turbo credits/,
    );
  });

  it('turns a rejected signature into an actionable message', async () => {
    const { turbo } = fakeTurbo();
    (turbo.upload as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('User rejected the request'));
    await expect(createFolder({ turbo, driveId: 'd', parentFolderId: 'root', name: 'x', owner: 'o' })).rejects.toThrow(
      /rejected/,
    );
  });
});

// ---------------------------------------------------------------------------
// M4: encrypted writes. The load-bearing check throughout is write-then-read: encrypt via these
// functions, then decrypt via the exact primitives the read path (M3) actually uses
// (decryptBytes/decryptJson), proving write-then-read is self-consistent without touching the
// network. `createPrivateDrive` additionally exercises real v2 signing end-to-end (ANS-104
// DataItem construction via @dha-team/arbundles, WebCrypto RSA-PSS) against a throwaway key
// generated fresh in Node — no shared fixture, no copy-pasted key material (see the M3 postmortem
// on why that matters).
// ---------------------------------------------------------------------------

function throwawayJwk(): JsonWebKey {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 4096, publicExponent: 0x10001 });
  const jwk = privateKey.export({ format: 'jwk' }) as JsonWebKey & { kty: string };
  jwk.kty = jwk.kty || 'RSA';
  return jwk;
}

describe('createPrivateDrive', () => {
  it('creates an encrypted drive + root folder whose names round-trip through the real read-side decrypt', async () => {
    const { turbo, calls } = fakeTurbo();
    const jwk = throwawayJwk();

    const { drive, rootFolder, driveKey } = await createPrivateDrive({
      turbo,
      wallet: { mode: 'keyfile', canSign: true, jwk: jwk as never },
      name: 'Secret Drive',
      password: 'hunter2',
      owner: 'OWNER',
    });

    expect(calls).toHaveLength(2);

    // Root folder first, then the drive entity pointing at it — same order as createDrive.
    expect(calls[0]!.kind).toBe('binary');
    expect(tagValue(calls[0]!.tags, 'Entity-Type')).toBe('folder');
    expect(tagValue(calls[0]!.tags, 'Content-Type')).toBe('application/octet-stream');
    expect(tagValue(calls[0]!.tags, 'Cipher')).toBe('AES256-GCM');
    expect(calls[0]!.tags.map((t) => t.name)).not.toContain('Drive-Privacy');

    expect(calls[1]!.kind).toBe('binary');
    expect(tagValue(calls[1]!.tags, 'Entity-Type')).toBe('drive');
    expect(tagValue(calls[1]!.tags, 'Drive-Privacy')).toBe('private');
    expect(tagValue(calls[1]!.tags, 'Drive-Auth-Mode')).toBe('password');
    expect(tagValue(calls[1]!.tags, 'Signature-Type')).toBe('2');

    // The real check: decrypt what was actually sent over the wire with the returned driveKey,
    // using this app's own read-side decryptJson — not a re-implementation of decryption.
    const folderCipherIv = tagValue(calls[0]!.tags, 'Cipher-IV')!;
    const folderJson = await decryptJson<{ name: string }>(folderCipherIv, driveKey, calls[0]!.rawData!);
    expect(folderJson).toEqual({ name: 'Secret Drive' });

    const driveCipherIv = tagValue(calls[1]!.tags, 'Cipher-IV')!;
    const driveJson = await decryptJson<{ name: string; rootFolderId: string }>(driveCipherIv, driveKey, calls[1]!.rawData!);
    expect(driveJson).toEqual({ name: 'Secret Drive', rootFolderId: rootFolder.entityId });

    expect(drive.privacy).toBe('private');
    expect(drive.signatureType).toBe('2');
    expect(drive.rootFolderId).toBe(rootFolder.entityId);
    expect(rootFolder.privacy).toBe('private');
  });
});

describe('createPrivateFolder', () => {
  it('encrypts the folder name under the given drive key', async () => {
    const { turbo, calls } = fakeTurbo();
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');

    const folder = await createPrivateFolder({
      turbo,
      driveId: 'd1',
      parentFolderId: 'root',
      name: 'Documents',
      owner: 'OWNER',
      driveKey,
    });

    expect(tagValue(calls[0]!.tags, 'Parent-Folder-Id')).toBe('root');
    const cipherIv = tagValue(calls[0]!.tags, 'Cipher-IV')!;
    const json = await decryptJson<{ name: string }>(cipherIv, driveKey, calls[0]!.rawData!);
    expect(json).toEqual({ name: 'Documents' });
    expect(folder.privacy).toBe('private');
    expect(folder.name).toBe('Documents');
  });
});

describe('uploadNewPrivateFile', () => {
  it('encrypts data and metadata independently, each decrypting back to the real plaintext', async () => {
    const { turbo, calls } = fakeTurbo();
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const fileId = '11111111-2222-4333-8444-555555555555';
    const fileKey = await deriveFileKey(driveKey, fileId);
    const file = new File(['top secret contents'], 'secret.txt', { type: 'text/plain' });

    const entity = await uploadNewPrivateFile({
      turbo,
      driveId: 'd1',
      parentFolderId: 'root',
      file,
      owner: 'OWNER',
      fileId,
      fileKey,
    });

    expect(calls).toHaveLength(2);

    // Data item: Content-Type is forced to octet-stream — the real MIME type only lives inside
    // the (also encrypted) metadata, so the public data-tx tag never leaks it.
    expect(calls[0]!.kind).toBe('file');
    expect(tagValue(calls[0]!.tags, 'Content-Type')).toBe('application/octet-stream');
    expect(tagValue(calls[0]!.tags, 'Cipher')).toBe('AES256-GCM');
    const dataCipherIv = tagValue(calls[0]!.tags, 'Cipher-IV')!;
    const plaintext = await decryptBytes(dataCipherIv, fileKey, calls[0]!.rawData!);
    expect(new TextDecoder().decode(plaintext)).toBe('top secret contents');

    expect(calls[1]!.kind).toBe('binary');
    const metaCipherIv = tagValue(calls[1]!.tags, 'Cipher-IV')!;
    const metaJson = await decryptJson<{ name: string; dataContentType: string; dataTxId: string }>(
      metaCipherIv,
      fileKey,
      calls[1]!.rawData!,
    );
    expect(metaJson).toMatchObject({ name: 'secret.txt', dataContentType: 'text/plain' });
    expect(metaJson.dataTxId).toBe(entity.dataTxId);

    expect(entity.privacy).toBe('private');
    expect(entity.name).toBe('secret.txt');
  });

  it('encrypts the thumbnail with the same file key as the main data, tagged like a private file', async () => {
    const { turbo, calls } = fakeTurbo();
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const fileId = '11111111-2222-4333-8444-555555555555';
    const fileKey = await deriveFileKey(driveKey, fileId);
    const file = new File(['top secret photo'], 'secret.jpg', { type: 'image/jpeg' });
    const thumbnail = { blob: new Blob(['fake jpeg thumb']), width: 100, height: 80 };

    const entity = await uploadNewPrivateFile({
      turbo,
      driveId: 'd1',
      parentFolderId: 'root',
      file,
      owner: 'OWNER',
      fileId,
      fileKey,
      thumbnail,
    });

    expect(calls).toHaveLength(3);

    // Thumbnail data item: same private-file-data tag shape (octet-stream + cipher tags), own IV.
    expect(calls[1]!.kind).toBe('file');
    expect(tagValue(calls[1]!.tags, 'Content-Type')).toBe('application/octet-stream');
    expect(tagValue(calls[1]!.tags, 'Cipher')).toBe('AES256-GCM');
    const thumbCipherIv = tagValue(calls[1]!.tags, 'Cipher-IV')!;
    const thumbPlaintext = await decryptBytes(thumbCipherIv, fileKey, calls[1]!.rawData!);
    expect(new TextDecoder().decode(thumbPlaintext)).toBe('fake jpeg thumb');

    const metaCipherIv = tagValue(calls[2]!.tags, 'Cipher-IV')!;
    const metaJson = await decryptJson<{
      thumbnail: { variants: { txId: string; width: number; height: number }[] };
    }>(metaCipherIv, fileKey, calls[2]!.rawData!);
    expect(metaJson.thumbnail.variants[0]).toMatchObject({ txId: 'tx-1', width: 100, height: 80 });

    expect(entity.thumbnail?.variants[0]).toMatchObject({ txId: 'tx-1', width: 100, height: 80 });
  });
});

describe('writePrivateFolderRevision', () => {
  it('encrypts the changed field under the drive key', async () => {
    const { turbo, calls } = fakeTurbo();
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const folder = { ...baseFolder(), privacy: 'private' as const };

    const renamed = await writePrivateFolderRevision({ turbo, folder, name: 'New Name', driveKey });

    const cipherIv = tagValue(calls[0]!.tags, 'Cipher-IV')!;
    const json = await decryptJson<{ name: string; isHidden: boolean }>(cipherIv, driveKey, calls[0]!.rawData!);
    expect(json).toEqual({ name: 'New Name', isHidden: false });
    expect(renamed.height).toBeNull();
  });
});

describe('writePrivateFileRevision', () => {
  it('encrypts the changed field under the file key', async () => {
    const { turbo, calls } = fakeTurbo();
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const fileId = '11111111-2222-4333-8444-555555555555';
    const fileKey = await deriveFileKey(driveKey, fileId);
    const file = { ...baseFile({ entityId: fileId }), privacy: 'private' as const };

    const hidden = await writePrivateFileRevision({ turbo, file, isHidden: true, fileKey });

    const cipherIv = tagValue(calls[0]!.tags, 'Cipher-IV')!;
    const json = await decryptJson<{ name: string; isHidden: boolean; dataTxId: string }>(
      cipherIv,
      fileKey,
      calls[0]!.rawData!,
    );
    expect(json).toMatchObject({ name: 'old.txt', isHidden: true, dataTxId: 'data-1' });
    expect(hidden.isHidden).toBe(true);
  });

  it('rejects a file with no parent folder, same as the public path', async () => {
    const { turbo } = fakeTurbo();
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const fileKey = await deriveFileKey(driveKey, '11111111-2222-4333-8444-555555555555');
    await expect(
      writePrivateFileRevision({
        turbo,
        file: baseFile({ parentFolderId: undefined, entityId: '11111111-2222-4333-8444-555555555555' }),
        name: 'x',
        fileKey,
      }),
    ).rejects.toThrow(UploadError);
  });
});
