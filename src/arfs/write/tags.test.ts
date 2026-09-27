import { describe, expect, it } from 'vitest';
import {
  baseAppTags,
  baseArFsTags,
  CIPHER,
  driveMetadataTags,
  fileDataTags,
  fileMetadataTags,
  folderMetadataTags,
  PRIVATE_CONTENT_TYPE,
  privateDriveMetadataTags,
  privateFileDataTags,
  privateFileMetadataTags,
  privateFolderMetadataTags,
  WRITE_ARFS_VERSION,
} from './tags';

// Verified byte-for-byte against ArDrive's own tag assembler:
//   ardrive-core-js/src/arfs/tags/tag_assembler.ts
//   ardrive-core-js/src/arfs/arfs_tag_settings.ts
//   ardrive-core-js/src/arfs/tx/arfs_prototypes.ts
// A mismatch here means ArDrive silently fails to recognize what we wrote as an ArFS entity.

function names(tags: readonly { name: string }[]): string[] {
  return tags.map((t) => t.name);
}

function value(tags: readonly { name: string; value: string }[], name: string): string | undefined {
  return tags.find((t) => t.name === name)?.value;
}

describe('baseAppTags / baseArFsTags', () => {
  it('declares App-Name and App-Version', () => {
    expect(names(baseAppTags)).toEqual(['App-Name', 'App-Version']);
    expect(value(baseAppTags, 'App-Name')).toBe('Sonar');
  });

  it('extends the app tags with the current ArFS version', () => {
    expect(names(baseArFsTags)).toEqual(['App-Name', 'App-Version', 'ArFS']);
    expect(value(baseArFsTags, 'ArFS')).toBe(WRITE_ARFS_VERSION);
  });
});

describe('driveMetadataTags', () => {
  it('includes every required drive tag with no extras', () => {
    const tags = driveMetadataTags({ driveId: 'drive-1', unixTime: 1_700_000_000 });
    expect(names(tags).sort()).toEqual(
      ['App-Name', 'App-Version', 'ArFS', 'Content-Type', 'Drive-Id', 'Drive-Privacy', 'Entity-Type', 'Unix-Time'].sort(),
    );
    expect(value(tags, 'Entity-Type')).toBe('drive');
    expect(value(tags, 'Drive-Privacy')).toBe('public');
    expect(value(tags, 'Content-Type')).toBe('application/json');
    expect(value(tags, 'Unix-Time')).toBe('1700000000');
  });
});

describe('folderMetadataTags', () => {
  it('omits Parent-Folder-Id for a root folder', () => {
    const tags = folderMetadataTags({ driveId: 'd', folderId: 'root-folder', unixTime: 1 });
    expect(names(tags)).not.toContain('Parent-Folder-Id');
    expect(value(tags, 'Folder-Id')).toBe('root-folder');
  });

  it('includes Parent-Folder-Id for a nested folder', () => {
    const tags = folderMetadataTags({ driveId: 'd', folderId: 'sub', parentFolderId: 'root-folder', unixTime: 1 });
    expect(value(tags, 'Parent-Folder-Id')).toBe('root-folder');
  });
});

describe('fileMetadataTags', () => {
  it('includes File-Id and Parent-Folder-Id, and Entity-Type: file', () => {
    const tags = fileMetadataTags({ driveId: 'd', fileId: 'f1', parentFolderId: 'root', unixTime: 1 });
    expect(value(tags, 'Entity-Type')).toBe('file');
    expect(value(tags, 'File-Id')).toBe('f1');
    expect(value(tags, 'Parent-Folder-Id')).toBe('root');
  });
});

describe('fileDataTags', () => {
  it('carries only Content-Type and the app tags — no ArFS or Entity-Type', () => {
    // The data item is just bytes; only the metadata item is an ArFS entity. Tagging the data
    // item with Entity-Type/ArFS is the classic mistake this test guards against.
    const tags = fileDataTags('image/png');
    expect(names(tags)).toEqual(['Content-Type', 'App-Name', 'App-Version']);
    expect(value(tags, 'Content-Type')).toBe('image/png');
  });

  it('falls back to a generic content type when none is given', () => {
    expect(value(fileDataTags(''), 'Content-Type')).toBe('application/octet-stream');
  });
});

// Verified against ardriveapp/ardrive-core-js's ArFSPrivate{Drive,Folder,File}MetaDataPrototype /
// ArFSPrivateFileDataPrototype (src/arfs/tx/arfs_prototypes.ts) and PRIVATE_CONTENT_TYPE
// (src/utils/constants.ts) — see the milestone 4 plan for the full table this mirrors.

describe('privateDriveMetadataTags', () => {
  it('includes every required private-drive tag, content-type octet-stream, cipher tags, and Signature-Type', () => {
    const tags = privateDriveMetadataTags({
      driveId: 'drive-1',
      unixTime: 1_700_000_000,
      cipherIv: 'AAAAAAAAAAAAAAAAAAAA',
      signatureType: '2',
    });
    expect(names(tags).sort()).toEqual(
      [
        'App-Name',
        'App-Version',
        'ArFS',
        'Content-Type',
        'Drive-Auth-Mode',
        'Drive-Id',
        'Drive-Privacy',
        'Entity-Type',
        'Signature-Type',
        'Cipher',
        'Cipher-IV',
        'Unix-Time',
      ].sort(),
    );
    expect(value(tags, 'Content-Type')).toBe(PRIVATE_CONTENT_TYPE);
    expect(value(tags, 'Content-Type')).toBe('application/octet-stream');
    expect(value(tags, 'Drive-Privacy')).toBe('private');
    expect(value(tags, 'Cipher')).toBe(CIPHER);
    expect(value(tags, 'Cipher')).toBe('AES256-GCM');
    expect(value(tags, 'Cipher-IV')).toBe('AAAAAAAAAAAAAAAAAAAA');
    expect(value(tags, 'Drive-Auth-Mode')).toBe('password');
    expect(value(tags, 'Signature-Type')).toBe('2');
  });
});

describe('privateFolderMetadataTags', () => {
  it('carries Cipher/Cipher-IV but never Drive-Privacy, Drive-Auth-Mode, or Signature-Type', () => {
    const tags = privateFolderMetadataTags({
      driveId: 'd',
      folderId: 'sub',
      parentFolderId: 'root-folder',
      unixTime: 1,
      cipherIv: 'iv',
    });
    expect(value(tags, 'Content-Type')).toBe(PRIVATE_CONTENT_TYPE);
    expect(value(tags, 'Cipher')).toBe(CIPHER);
    expect(value(tags, 'Cipher-IV')).toBe('iv');
    expect(value(tags, 'Parent-Folder-Id')).toBe('root-folder');
    for (const driveOnly of ['Drive-Privacy', 'Drive-Auth-Mode', 'Signature-Type']) {
      expect(names(tags)).not.toContain(driveOnly);
    }
  });

  it('omits Parent-Folder-Id for a root folder', () => {
    const tags = privateFolderMetadataTags({ driveId: 'd', folderId: 'root-folder', unixTime: 1, cipherIv: 'iv' });
    expect(names(tags)).not.toContain('Parent-Folder-Id');
  });
});

describe('privateFileMetadataTags', () => {
  it('carries Cipher/Cipher-IV but never Drive-Privacy, Drive-Auth-Mode, or Signature-Type', () => {
    const tags = privateFileMetadataTags({ driveId: 'd', fileId: 'f1', parentFolderId: 'root', unixTime: 1, cipherIv: 'iv' });
    expect(value(tags, 'Content-Type')).toBe(PRIVATE_CONTENT_TYPE);
    expect(value(tags, 'Entity-Type')).toBe('file');
    expect(value(tags, 'Cipher')).toBe(CIPHER);
    expect(value(tags, 'Cipher-IV')).toBe('iv');
    for (const driveOnly of ['Drive-Privacy', 'Drive-Auth-Mode', 'Signature-Type']) {
      expect(names(tags)).not.toContain(driveOnly);
    }
  });
});

describe('privateFileDataTags', () => {
  it('is always octet-stream regardless of the real file type — the data tx never leaks it', () => {
    const tags = privateFileDataTags('iv');
    expect(names(tags)).toEqual(['Content-Type', 'Cipher', 'Cipher-IV', 'App-Name', 'App-Version']);
    expect(value(tags, 'Content-Type')).toBe(PRIVATE_CONTENT_TYPE);
    expect(value(tags, 'Cipher')).toBe(CIPHER);
    expect(value(tags, 'Cipher-IV')).toBe('iv');
    expect(names(tags)).not.toContain('Entity-Type');
    expect(names(tags)).not.toContain('ArFS');
  });
});
