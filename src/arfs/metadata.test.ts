import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { __setFetchTimeoutsForTests, fetchBinaryBody, fetchBodies, resolveEntities } from './metadata';
import { __resetCacheForTests, cache } from '../cache/db';
import { Gate, mapPool } from './pool';
import { deriveDriveKey, deriveFileKey } from './crypto/kdf';
import type { DecryptContext } from './metadata';
import type { EntityStub } from './types';

function stub(over: Partial<EntityStub> = {}): EntityStub {
  return {
    metadataTxId: 'tx1',
    entityType: 'file',
    entityId: 'file-1',
    driveId: 'drive-1',
    parentFolderId: 'root',
    privacy: 'public',
    unixTime: 1_700_000_000,
    height: 100,
    minedAt: 1_700_000_000,
    owner: 'OWNER',
    arFsVersion: '0.15',
    contentType: 'application/json',
    ...over,
  };
}

const body = (payload: unknown) => new Response(JSON.stringify(payload), { status: 200 });

beforeEach(async () => {
  await cache.clear();
  __resetCacheForTests();
});

describe('mapPool', () => {
  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    await mapPool(Array.from({ length: 50 }, (_, i) => i), 8, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 1));
      active--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(8);
  });

  it('preserves input order and isolates failures', async () => {
    const out = await mapPool([1, 2, 3], 3, async (n) => {
      if (n === 2) throw new Error('boom');
      return n * 10;
    });
    expect(out).toEqual([10, undefined, 30]);
  });
});

describe('cache resilience', () => {
  it('keeps working when IndexedDB is blocked rather than hanging the app', async () => {
    // openDB parks forever if another tab holds the database or a delete is pending. The cache
    // must degrade to memory instead of wedging every fetch behind it.
    const realIndexedDB = globalThis.indexedDB;
    // A stub whose open() never fires any callback — exactly what "blocked" looks like.
    globalThis.indexedDB = { open: () => ({}), databases: async () => [] } as unknown as IDBFactory;
    __resetCacheForTests();

    try {
      const fetchImpl = vi.fn(async () => body({ name: 'a.txt' })) as unknown as typeof fetch;
      const started = Date.now();
      const bodies = await fetchBodies(['tx1'], { fetchImpl, gateways: ['https://g'] });

      expect(bodies.get('tx1')).toContain('a.txt');
      // The 4s open timeout bounds it; without the fix this never resolves at all.
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      globalThis.indexedDB = realIndexedDB;
      __resetCacheForTests();
    }
  }, 30_000);
});

describe('Gate', () => {
  it('bounds concurrency across independent callers', async () => {
    // Regression: six parallel cold-sync shards each opened their own pool of 48, producing ~288
    // simultaneous requests to one host, which exhausted the browser connection pool and stalled.
    const gate = new Gate(10);
    let peak = 0;

    const caller = () =>
      mapPool(Array.from({ length: 30 }, (_, i) => i), 30, (n) =>
        gate.run(async () => {
          peak = Math.max(peak, gate.inFlight);
          await new Promise((r) => setTimeout(r, 2));
          return n;
        }),
      );

    await Promise.all([caller(), caller(), caller(), caller(), caller(), caller()]);
    expect(peak).toBeLessThanOrEqual(10);
  });

  it('releases its slot when the task throws', async () => {
    const gate = new Gate(1);
    await expect(gate.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(gate.inFlight).toBe(0);
    await expect(gate.run(async () => 'ok')).resolves.toBe('ok');
  });
});

describe('fetchBodies', () => {
  it('deduplicates repeated transaction ids', async () => {
    const fetchImpl = vi.fn(async () => body({ name: 'a.txt' })) as unknown as typeof fetch;
    await fetchBodies(['tx1', 'tx1', 'tx1'], { fetchImpl, gateways: ['https://g'] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('serves a second call entirely from cache', async () => {
    // The core performance guarantee: revisiting a drive must cost zero network fetches.
    const fetchImpl = vi.fn(async () => body({ name: 'a.txt' })) as unknown as typeof fetch;
    const opts = { fetchImpl, gateways: ['https://g'] };

    await fetchBodies(['tx1', 'tx2'], opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const again = await fetchBodies(['tx1', 'tx2'], opts);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(again.size).toBe(2);
  });

  it('falls back to the next gateway on failure', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('bad')) throw new Error('down');
      return body({ name: 'a.txt' });
    }) as unknown as typeof fetch;

    const bodies = await fetchBodies(['tx1'], { fetchImpl, gateways: ['https://bad', 'https://good'] });
    expect(bodies.get('tx1')).toContain('a.txt');
  });

  it('omits transactions that fail everywhere rather than rejecting the batch', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('tx2') ? Promise.reject(new Error('down')) : body({ name: 'ok' }),
    ) as unknown as typeof fetch;

    const bodies = await fetchBodies(['tx1', 'tx2'], { fetchImpl, gateways: ['https://g'] });
    expect(bodies.has('tx1')).toBe(true);
    expect(bodies.has('tx2')).toBe(false);
  });
});

describe('fetchBinaryBody — timeouts against a real HTTP server', () => {
  // Real `fetch` against a real local server, not a mock: the bug being guarded against lives in
  // actual abort semantics (a fetch-level timeout signal also kills the body read), which a fake
  // `fetchImpl` would simply never reproduce.
  async function serve(handler: http.RequestListener) {
    const sockets = new Set<Socket>();
    const server = http.createServer(handler);
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      gateway: `http://127.0.0.1:${port}`,
      close: () => {
        for (const s of sockets) s.destroy();
        return new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }

  beforeEach(() => __setFetchTimeoutsForTests(200, 200));
  afterEach(() => __setFetchTimeoutsForTests(20_000, 30_000));

  it('completes a transfer that takes far longer than the timeout, as long as it keeps progressing', async () => {
    // ~600ms of steady trickle against 200ms timeouts: the old whole-transfer deadline would abort
    // this at 200ms on every attempt, which is exactly how large files failed to download.
    const { gateway, close } = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      let n = 0;
      const t = setInterval(() => {
        res.write(Buffer.alloc(1024, n));
        if (++n === 30) {
          clearInterval(t);
          res.end();
        }
      }, 20);
    });
    try {
      const bytes = await fetchBinaryBody('tx-large', { gateways: [gateway], fetchImpl: fetch });
      expect(bytes.byteLength).toBe(30 * 1024);
    } finally {
      await close();
    }
  });

  it('still abandons a transfer that goes silent mid-body', async () => {
    const { gateway, close } = await serve((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.write(Buffer.alloc(1024)); // one chunk, then nothing — never ends
    });
    try {
      await expect(fetchBinaryBody('tx-stalled', { gateways: [gateway], fetchImpl: fetch })).rejects.toThrow();
    } finally {
      await close();
    }
  }, 20_000);
});

describe('resolveEntities', () => {
  const gateways = ['https://g'];

  it('resolves a file from its metadata body', async () => {
    const fetchImpl = vi.fn(async () =>
      body({
        name: 'report.pdf',
        size: 2048,
        lastModifiedDate: 1_700_000_000_000,
        dataTxId: 'DATA_TX',
        dataContentType: 'application/pdf',
      }),
    ) as unknown as typeof fetch;

    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file).toMatchObject({
      entityType: 'file',
      name: 'report.pdf',
      size: 2048,
      dataTxId: 'DATA_TX',
      dataContentType: 'application/pdf',
    });
  });

  it('passes through a thumbnail field from the metadata body', async () => {
    const thumbnail = { variants: [{ name: 'small', txId: 'THUMB_TX', size: 500, width: 320, height: 240 }] };
    const fetchImpl = vi.fn(async () =>
      body({ name: 'photo.jpg', size: 2048, dataTxId: 'DATA_TX', dataContentType: 'image/jpeg', thumbnail }),
    ) as unknown as typeof fetch;

    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file).toMatchObject({ name: 'photo.jpg', thumbnail });
  });

  it('omits the thumbnail field entirely when the body has none', async () => {
    const fetchImpl = vi.fn(async () =>
      body({ name: 'plain.txt', size: 5, dataTxId: 'D', dataContentType: 'text/plain' }),
    ) as unknown as typeof fetch;

    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file && 'thumbnail' in file).toBe(false);
  });

  it('resolves a drive and its root folder pointer', async () => {
    const fetchImpl = vi.fn(async () =>
      body({ name: 'My Drive', rootFolderId: 'ROOT' }),
    ) as unknown as typeof fetch;

    const [drive] = await resolveEntities([stub({ entityType: 'drive', entityId: 'drive-1' })], {
      fetchImpl,
      gateways,
    });
    expect(drive).toMatchObject({ entityType: 'drive', name: 'My Drive', rootFolderId: 'ROOT' });
  });

  it('never fetches a body for a private entity, and labels it as locked', async () => {
    const fetchImpl = vi.fn(async () => body({})) as unknown as typeof fetch;
    const [drive] = await resolveEntities(
      [stub({ entityType: 'drive', entityId: 'abcdef12-0000', privacy: 'private', cipher: 'AES256-GCM' })],
      { fetchImpl, gateways },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(drive?.name).toMatch(/^Private drive/);
    expect(drive?.privacy).toBe('private');
  });

  it('keeps a file whose body lacks a data pointer instead of hiding it', async () => {
    // Silently dropping it would make a file vanish from the user's drive.
    const fetchImpl = vi.fn(async () => body({ name: 'broken.txt' })) as unknown as typeof fetch;
    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file).toMatchObject({ name: 'broken.txt', dataTxId: '', size: 0 });
  });

  it('lists an entity whose body is not valid JSON rather than dropping it', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('<!doctype html>gateway error page', { status: 200 }),
    ) as unknown as typeof fetch;
    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file).toMatchObject({ entityType: 'file', unresolved: true });
  });

  it('lists an entity whose body is rate limited rather than dropping it', async () => {
    // A 429 must never look like "this file does not exist" — that silently deletes a user's file.
    const fetchImpl = vi.fn(async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file).toMatchObject({ unresolved: true });
    expect(file?.name).toContain('Unavailable');
  }, 30_000);

  it('retries a rate-limited body and succeeds when the gateway recovers', async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls++;
      if (calls <= 2) return new Response('slow down', { status: 429 });
      return body({ name: 'recovered.txt', size: 5, dataTxId: 'D', dataContentType: 'text/plain' });
    }) as unknown as typeof fetch;

    const [file] = await resolveEntities([stub()], { fetchImpl, gateways });
    expect(file).toMatchObject({ name: 'recovered.txt' });
    expect(file?.unresolved).toBeFalsy();
  }, 30_000);

  it('clears a stale `unresolved: true` on success, not just a fresh stub', async () => {
    // `sync.ts`'s "heal unresolved entities" retry passes an already-resolved `ResolvedEntity` —
    // one that was itself `unresolved: true` last time — back in as the `stub` argument, since
    // that's the only record it has of what to retry. `toEntity` builds its result via `{
    // ...stub, ... }`, so without an explicit override the stale flag survives object spread even
    // though the body genuinely resolved this time — the retry would eternally "succeed" at
    // fetching the body while the entity stayed marked unresolved forever. A plain fresh `stub()`
    // (used by every other test here) can never expose this, since a real `EntityStub` parsed
    // from GraphQL never carries this field at all.
    const alreadyUnresolved = { ...stub(), unresolved: true };
    const fetchImpl = vi.fn(async () =>
      body({ name: 'healed.txt', size: 3, dataTxId: 'D', dataContentType: 'text/plain' }),
    ) as unknown as typeof fetch;

    const [file] = await resolveEntities([alreadyUnresolved], { fetchImpl, gateways });
    expect(file?.unresolved).not.toBe(true);
    expect(file?.name).toBe('healed.txt');
  });

  it('does not keep retrying a 404 on the same gateway', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await resolveEntities([stub()], { fetchImpl, gateways });
    // One gateway, permanently absent: exactly one request, no retry storm.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('persists resolved entities for the next session', async () => {
    const fetchImpl = vi.fn(async () =>
      body({ name: 'a.txt', size: 1, dataTxId: 'D', dataContentType: 'text/plain' }),
    ) as unknown as typeof fetch;

    await resolveEntities([stub()], { fetchImpl, gateways });
    expect((await cache.entitiesByDrive('drive-1')).map((e) => e.name)).toEqual(['a.txt']);
  });
});

describe('resolveEntities — private drives with a decrypt context', () => {
  const gateways = ['https://g'];

  async function encryptedBody(key: Awaited<ReturnType<typeof deriveDriveKey>>, json: unknown) {
    const encryptKey = await crypto.subtle.importKey('raw', key.raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      encryptKey,
      new TextEncoder().encode(JSON.stringify(json)),
    );
    return { cipherIv: btoa(String.fromCharCode(...iv)), ciphertext };
  }

  it('decrypts a private folder using the drive key', async () => {
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const { cipherIv, ciphertext } = await encryptedBody(driveKey, { name: 'Secret Folder', isHidden: false });

    const fetchImpl = vi.fn(async () => new Response(ciphertext, { status: 200 })) as unknown as typeof fetch;
    const decrypt: DecryptContext = { driveKey, getFileKey: () => Promise.reject(new Error('not a file')) };

    const [folder] = await resolveEntities(
      [stub({ entityType: 'folder', entityId: 'folder-1', privacy: 'private', cipherIv, cipher: 'AES256-GCM' })],
      { fetchImpl, gateways, decrypt },
    );
    expect(folder).toMatchObject({ name: 'Secret Folder', privacy: 'private' });
    expect(folder?.unresolved).toBeFalsy();
  });

  it('decrypts a private file using its own file key, not the drive key', async () => {
    const fileId = '11111111-2222-4333-8444-555555555555';
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const fileKey = await deriveFileKey(driveKey, fileId);
    const { cipherIv, ciphertext } = await encryptedBody(fileKey, {
      name: 'secret.txt',
      size: 42,
      dataTxId: 'DATA',
      dataContentType: 'text/plain',
    });

    const fetchImpl = vi.fn(async () => new Response(ciphertext, { status: 200 })) as unknown as typeof fetch;
    const decrypt: DecryptContext = { driveKey, getFileKey: async (id) => deriveFileKey(driveKey, id) };

    const [file] = await resolveEntities(
      [stub({ entityType: 'file', entityId: fileId, privacy: 'private', cipherIv, cipher: 'AES256-GCM' })],
      { fetchImpl, gateways, decrypt },
    );
    expect(file).toMatchObject({ name: 'secret.txt', size: 42, dataTxId: 'DATA' });
  });

  it('passes through a thumbnail field from decrypted private JSON', async () => {
    const fileId = '11111111-2222-4333-8444-555555555555';
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const fileKey = await deriveFileKey(driveKey, fileId);
    const thumbnail = { variants: [{ name: 'small', txId: 'THUMB_TX', size: 500, width: 320, height: 240 }] };
    const { cipherIv, ciphertext } = await encryptedBody(fileKey, {
      name: 'secret.jpg',
      size: 42,
      dataTxId: 'DATA',
      dataContentType: 'image/jpeg',
      thumbnail,
    });

    const fetchImpl = vi.fn(async () => new Response(ciphertext, { status: 200 })) as unknown as typeof fetch;
    const decrypt: DecryptContext = { driveKey, getFileKey: async (id) => deriveFileKey(driveKey, id) };

    const [file] = await resolveEntities(
      [stub({ entityType: 'file', entityId: fileId, privacy: 'private', cipherIv, cipher: 'AES256-GCM' })],
      { fetchImpl, gateways, decrypt },
    );
    expect(file).toMatchObject({ name: 'secret.jpg', thumbnail });
  });

  it('falls back to the locked placeholder on a wrong password, without throwing', async () => {
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'right');
    const wrongKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'wrong');
    const { cipherIv, ciphertext } = await encryptedBody(driveKey, { name: 'Secret Folder' });

    const fetchImpl = vi.fn(async () => new Response(ciphertext, { status: 200 })) as unknown as typeof fetch;
    const decrypt: DecryptContext = { driveKey: wrongKey, getFileKey: () => Promise.reject(new Error('n/a')) };

    const [folder] = await resolveEntities(
      [stub({ entityType: 'folder', entityId: 'folder-1', privacy: 'private', cipherIv, cipher: 'AES256-GCM' })],
      { fetchImpl, gateways, decrypt },
    );
    expect(folder?.name).toMatch(/^Encrypted/);
  });

  it('still returns the M1 locked placeholder when no decrypt context is given', async () => {
    const driveKey = await deriveDriveKey(crypto.getRandomValues(new Uint8Array(32)), 'pw');
    const { cipherIv, ciphertext } = await encryptedBody(driveKey, { name: 'Secret Folder' });
    const fetchImpl = vi.fn(async () => new Response(ciphertext, { status: 200 })) as unknown as typeof fetch;

    const [folder] = await resolveEntities(
      [stub({ entityType: 'folder', entityId: 'folder-1', privacy: 'private', cipherIv, cipher: 'AES256-GCM' })],
      { fetchImpl, gateways },
    );
    expect(folder?.name).toMatch(/^Private drive|^Encrypted/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
