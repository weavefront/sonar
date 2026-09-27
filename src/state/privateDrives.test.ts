import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePrivateDrives } from './privateDrives';
import { useWallet } from '../wallet/store';
import { deriveDriveKey, uuidToBytes } from '../arfs/crypto/kdf';
import type { DriveEntity } from '../arfs/types';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSA-PSS', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk = await crypto.subtle.exportKey('jwk', privateKey);
void publicKey;

// A real Arweave wallet's RSA modulus is 4096 bits (512 bytes) — `@dha-team/arbundles`'
// `ArweaveSigner` (exercised by v2Signature's keyfile path) validates that length strictly, unlike
// the 2048-bit key above which is fine for the raw-WebCrypto v1Signature() paths that don't go
// through arbundles at all. Only generated for the one test that actually needs a v2 signature.
const { privateKey: privateKey4096 } = await crypto.subtle.generateKey(
  { name: 'RSA-PSS', modulusLength: 4096, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true,
  ['sign', 'verify'],
);
const jwk4096 = await crypto.subtle.exportKey('jwk', privateKey4096);

function signingKeyFor(driveId: string): Uint8Array<ArrayBuffer> {
  const prefix = new TextEncoder().encode('drive');
  const idBytes = uuidToBytes(driveId);
  const out: Uint8Array<ArrayBuffer> = new Uint8Array(prefix.length + idBytes.length);
  out.set(prefix, 0);
  out.set(idBytes, prefix.length);
  return out;
}

/** Real v1-style saltLength-0 signature over the drive's signing key, using the test JWK. */
async function realV1Signature(driveId: string): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-PSS', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'RSA-PSS', saltLength: 0 }, key, signingKeyFor(driveId));
  return new Uint8Array(sig);
}

const DRIVE_ID = '11111111-2222-4333-8444-555555555555';

function driveFixture(over: Partial<DriveEntity> = {}): DriveEntity {
  return {
    metadataTxId: 'meta-tx',
    entityType: 'drive',
    entityId: DRIVE_ID,
    driveId: DRIVE_ID,
    privacy: 'private',
    cipher: 'AES256-GCM',
    cipherIv: '',
    unixTime: 1,
    height: 100,
    minedAt: 1,
    owner: 'OWNER',
    arFsVersion: '0.15',
    contentType: 'application/json',
    name: 'Locked drive',
    isHidden: false,
    rootFolderId: '',
    ...over,
  };
}

beforeEach(() => {
  usePrivateDrives.getState().clear();
  useWallet.setState({ address: 'OWNER', mode: 'keyfile', canSign: true, jwk: jwk as never, error: null, connecting: false });
});

describe('unlock', () => {
  it('refuses to unlock without a signable session', async () => {
    useWallet.setState({ canSign: false, mode: 'watch' });
    const result = await usePrivateDrives.getState().unlock(driveFixture(), 'pw');
    expect(result.status).toBe('error');
  });

  it('recovers the real drive name on the correct password (v1, no bridge entity)', async () => {
    const signature = await realV1Signature(DRIVE_ID);
    const driveKey = await deriveDriveKey(signature, 'correct horse');
    const encryptKey = await crypto.subtle.importKey('raw', driveKey.raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      encryptKey,
      new TextEncoder().encode(JSON.stringify({ name: 'My Secret Drive', rootFolderId: 'root-1' })),
    );
    const cipherIv = btoa(String.fromCharCode(...iv));

    // No Signature-Type tag and no drive-signature bridge entity on this fixture, so
    // resolveDriveSignature falls through to the legacy v1 signature() call — exercised via
    // 'keyfile' mode, which computes it locally rather than needing a wallet extension.
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/graphql')) return new Response(JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }));
      return new Response(ciphertext, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await usePrivateDrives
      .getState()
      .unlock(driveFixture({ cipherIv }), 'correct horse', { fetchImpl });

    expect(result).toMatchObject({ status: 'ok', entity: { name: 'My Secret Drive', rootFolderId: 'root-1' } });
    expect(usePrivateDrives.getState().isUnlocked(DRIVE_ID)).toBe(true);
  });

  it('reports wrong-password without throwing, and does not unlock', async () => {
    const signature = await realV1Signature(DRIVE_ID);
    const driveKey = await deriveDriveKey(signature, 'the-real-password');
    const encryptKey = await crypto.subtle.importKey('raw', driveKey.raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      encryptKey,
      new TextEncoder().encode(JSON.stringify({ name: 'My Secret Drive' })),
    );
    const cipherIv = btoa(String.fromCharCode(...iv));

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/graphql')) return new Response(JSON.stringify({ data: { transactions: { edges: [], pageInfo: { hasNextPage: false } } } }));
      return new Response(ciphertext, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await usePrivateDrives
      .getState()
      .unlock(driveFixture({ cipherIv }), 'a-wrong-guess', { fetchImpl });

    expect(result.status).toBe('wrong-password');
    // The trace is what makes a genuine typo tellable apart from a bug in our own key derivation,
    // so it must actually record which branch ran — not just be present.
    expect((result as { diagnostic: string }).diagnostic).toContain('scheme=v1');
    expect((result as { diagnostic: string }).diagnostic).toContain('bridgeFound=false');
    expect(usePrivateDrives.getState().isUnlocked(DRIVE_ID)).toBe(false);
  });

  it('refuses a drive with no Cipher-IV tag rather than deriving a meaningless key', async () => {
    const result = await usePrivateDrives.getState().unlock(driveFixture({ cipherIv: '' }), 'pw');
    expect(result.status).toBe('error');
  });

  it('reports a network error, never "wrong password", when a drive-signature bridge entity exists but its data cannot be fetched', async () => {
    // Real-world case this reproduces: a v1-signature drive whose bridge entity's data tx 404'd
    // on arweave.net (confirmed live). Silently falling through to recompute a fresh
    // v1Signature() there would derive the wrong key even with the exactly correct password —
    // this must surface as an honest "couldn't reach the network" error instead.
    // Resolving the bridge needs a real v2Signature (unlike the other tests here), which goes
    // through arbundles' ArweaveSigner — needs the 4096-bit key, not the shared 2048-bit one.
    useWallet.setState({ jwk: jwk4096 as never });
    const bridgeIv = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))));
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/graphql')) {
        return new Response(
          JSON.stringify({
            data: {
              transactions: {
                edges: [
                  {
                    cursor: 'c1',
                    node: {
                      id: 'bridge-tx',
                      owner: { address: 'OWNER' },
                      block: { height: 100, timestamp: 1 },
                      tags: [
                        { name: 'Entity-Type', value: 'drive-signature' },
                        { name: 'Drive-Id', value: DRIVE_ID },
                        { name: 'Cipher-IV', value: bridgeIv },
                      ],
                    },
                  },
                ],
                pageInfo: { hasNextPage: false },
              },
            },
          }),
        );
      }
      // Both the primary gateway and the turbo-gateway.com fallback 404 on the bridge's data tx.
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const result = await usePrivateDrives
      .getState()
      .unlock(driveFixture({ cipherIv: 'unused-in-this-scenario' }), 'correct horse', { fetchImpl });

    expect(result.status).toBe('error');
    expect((result as { status: 'error'; message: string }).message).toMatch(/network|gateway/i);
    expect(usePrivateDrives.getState().isUnlocked(DRIVE_ID)).toBe(false);
  });
});

describe('getDecryptContext / isUnlocked / lock', () => {
  it('is undefined for a drive that was never unlocked', () => {
    expect(usePrivateDrives.getState().getDecryptContext('never-unlocked')).toBeUndefined();
  });

  it('caches derived file keys across repeated calls', async () => {
    const signature = await realV1Signature(DRIVE_ID);
    const driveKey = await deriveDriveKey(signature, 'pw');
    // Seed an unlocked session directly — this suite already proves `unlock()` populates it correctly.
    usePrivateDrives.setState({
      unlocked: new Map([[DRIVE_ID, { password: 'pw', driveKey, fileKeys: new Map() }]]),
    });

    const ctx = usePrivateDrives.getState().getDecryptContext(DRIVE_ID)!;
    const fileId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const a = await ctx.getFileKey(fileId);
    const b = await ctx.getFileKey(fileId);
    expect(a).toBe(b); // same object reference — proves the cache path, not just equal bytes
  });

  it('lock() removes a session so getDecryptContext falls back to undefined', async () => {
    const signature = await realV1Signature(DRIVE_ID);
    const driveKey = await deriveDriveKey(signature, 'pw');
    usePrivateDrives.setState({
      unlocked: new Map([[DRIVE_ID, { password: 'pw', driveKey, fileKeys: new Map() }]]),
    });
    expect(usePrivateDrives.getState().isUnlocked(DRIVE_ID)).toBe(true);

    usePrivateDrives.getState().lock(DRIVE_ID);

    expect(usePrivateDrives.getState().isUnlocked(DRIVE_ID)).toBe(false);
    expect(usePrivateDrives.getState().getDecryptContext(DRIVE_ID)).toBeUndefined();
  });
});

describe('clear', () => {
  it('drops every unlocked session at once', async () => {
    const signature = await realV1Signature(DRIVE_ID);
    const driveKey = await deriveDriveKey(signature, 'pw');
    usePrivateDrives.setState({
      unlocked: new Map([
        [DRIVE_ID, { password: 'pw', driveKey, fileKeys: new Map() }],
        ['other-drive', { password: 'pw2', driveKey, fileKeys: new Map() }],
      ]),
    });

    usePrivateDrives.getState().clear();

    expect(usePrivateDrives.getState().unlocked.size).toBe(0);
  });
});
