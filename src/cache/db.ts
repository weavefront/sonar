/**
 * Local persistence.
 *
 * Two very different caching problems live here, and the distinction is what makes this fast:
 *
 *   - **Transaction bodies are immutable.** A metadata JSON is addressed by its transaction ID and
 *     can never change, so it is cached forever with no invalidation logic at all. This is what
 *     makes a revisit cost zero network fetches.
 *   - **Drive *state* is mutable** (ArFS is append-only, so new revisions keep arriving). That is
 *     handled by recording the last synced block height per drive and querying only above it.
 */

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ResolvedEntity } from '../arfs/types';

const DB_NAME = 'swiftdrive';
const DB_VERSION = 2;

export interface SyncRecord {
  /** `drives:<owner>` for an owner's drive list, or `drive:<driveId>` for a drive's contents. */
  key: string;
  lastHeight: number;
  updatedAt: number;
}

interface SwiftSchema extends DBSchema {
  txBodies: {
    key: string;
    value: { txId: string; body: string; at: number };
  };
  entities: {
    key: string;
    value: ResolvedEntity;
    indexes: { 'by-drive': string; 'by-owner': string };
  };
  syncState: {
    key: string;
    value: SyncRecord;
  };
  /**
   * A small locally-generated JPEG for a public image that has no real ArDrive thumbnail
   * variant, keyed by the *data* transaction's ID. Populated lazily the first time such an
   * image is viewed anywhere in the app (see `ui/Thumbnail.tsx`); every later view of the same
   * file, in any folder or any future session, reads this instead of re-fetching and
   * re-decoding the full image just to show a small row icon.
   *
   * The *source* transaction is immutable, but the *generated* blob isn't — it depends on this
   * app's own rasterization code, which can change (it already has once: an earlier version
   * produced visibly blurry output). `version` records which generation this blob came from, so
   * a reader can tell "stale, made by code we've since fixed" apart from "content-addressed and
   * fine forever" instead of serving a bad cached blob permanently. See `LOCAL_THUMB_VERSION` in
   * `ui/Thumbnail.tsx` — bump it whenever `rasterize()`'s actual output changes.
   */
  localThumbs: {
    key: string;
    value: { dataTxId: string; blob: Blob; version: number; at: number };
  };
}

/**
 * How long to wait for IndexedDB before giving up and using memory for this call.
 *
 * `openDB` can block indefinitely — another tab holding an older version open, or a pending
 * `deleteDatabase`, will park the request with no error and no timeout. The cache exists to make
 * the app fast, so it must never be able to make it hang: if the database isn't ready promptly we
 * fall through to the in-memory maps and try again on a later call.
 */
const OPEN_TIMEOUT_MS = 4_000;

let conn: IDBPDatabase<SwiftSchema> | null = null;
let opening: Promise<void> | null = null;

/**
 * try/catch rather than a `.catch()` on the chain: some environments (Safari private mode,
 * sandboxed iframes) throw synchronously from `indexedDB.open`, and that throw would escape a
 * rejection handler attached to the returned promise.
 */
async function beginOpen(): Promise<void> {
  try {
    conn = await openDB<SwiftSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('txBodies', { keyPath: 'txId' });
          const entities = db.createObjectStore('entities', { keyPath: 'metadataTxId' });
          entities.createIndex('by-drive', 'driveId');
          entities.createIndex('by-owner', 'owner');
          db.createObjectStore('syncState', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('localThumbs', { keyPath: 'dataTxId' });
        }
      },
      // Another tab wants to upgrade or delete: release our handle so it isn't stuck behind us.
      blocking() {
        conn?.close();
        conn = null;
      },
      terminated() {
        conn = null;
      },
    });
  } catch {
    conn = null;
  } finally {
    opening = null;
  }
}

async function db(): Promise<IDBPDatabase<SwiftSchema> | null> {
  if (conn) return conn;
  opening ??= beginOpen();
  await Promise.race([opening, new Promise<void>((resolve) => setTimeout(resolve, OPEN_TIMEOUT_MS))]);
  return conn;
}

/**
 * In-memory fallback. Safari private browsing and some embedded webviews reject IndexedDB
 * outright; the app should degrade to "fast within this session" rather than break.
 */
const memory = {
  bodies: new Map<string, string>(),
  entities: new Map<string, ResolvedEntity>(),
  sync: new Map<string, SyncRecord>(),
};

export const cache = {
  async getBody(txId: string): Promise<string | undefined> {
    const mem = memory.bodies.get(txId);
    if (mem !== undefined) return mem;
    const conn = await db();
    if (!conn) return undefined;
    const rec = await conn.get('txBodies', txId).catch(() => undefined);
    if (rec) memory.bodies.set(txId, rec.body);
    return rec?.body;
  },

  async getBodies(txIds: readonly string[]): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    const missing: string[] = [];
    for (const id of txIds) {
      const mem = memory.bodies.get(id);
      if (mem !== undefined) found.set(id, mem);
      else missing.push(id);
    }
    if (!missing.length) return found;

    const conn = await db();
    if (!conn) return found;
    try {
      const tx = conn.transaction('txBodies');
      const store = tx.objectStore('txBodies');
      const results = await Promise.all(missing.map((id) => store.get(id)));
      await tx.done;
      for (const rec of results) {
        if (rec) {
          found.set(rec.txId, rec.body);
          memory.bodies.set(rec.txId, rec.body);
        }
      }
    } catch {
      /* fall through to whatever we already have */
    }
    return found;
  },

  async putBodies(entries: readonly { txId: string; body: string }[]): Promise<void> {
    if (!entries.length) return;
    const at = Date.now();
    for (const e of entries) memory.bodies.set(e.txId, e.body);
    const conn = await db();
    if (!conn) return;
    try {
      const tx = conn.transaction('txBodies', 'readwrite');
      const store = tx.objectStore('txBodies');
      await Promise.all(entries.map((e) => store.put({ txId: e.txId, body: e.body, at })));
      await tx.done;
    } catch {
      /* cache writes are best-effort */
    }
  },

  async putEntities(entities: readonly ResolvedEntity[]): Promise<void> {
    if (!entities.length) return;
    for (const e of entities) memory.entities.set(e.metadataTxId, e);
    const conn = await db();
    if (!conn) return;
    try {
      const tx = conn.transaction('entities', 'readwrite');
      const store = tx.objectStore('entities');
      await Promise.all(entities.map((e) => store.put(e)));
      await tx.done;
    } catch {
      /* best-effort */
    }
  },

  /** Every revision we know of for a drive — the caller reduces these to current state. */
  async entitiesByDrive(driveId: string): Promise<ResolvedEntity[]> {
    const conn = await db();
    if (!conn) return [...memory.entities.values()].filter((e) => e.driveId === driveId);
    try {
      return await conn.getAllFromIndex('entities', 'by-drive', driveId);
    } catch {
      return [...memory.entities.values()].filter((e) => e.driveId === driveId);
    }
  },

  async entitiesByOwner(owner: string): Promise<ResolvedEntity[]> {
    const conn = await db();
    if (!conn) return [...memory.entities.values()].filter((e) => e.owner === owner);
    try {
      return await conn.getAllFromIndex('entities', 'by-owner', owner);
    } catch {
      return [...memory.entities.values()].filter((e) => e.owner === owner);
    }
  },

  /** Returns `undefined` for both "never cached" and "cached by an older, since-fixed generation". */
  async getLocalThumb(dataTxId: string, version: number): Promise<Blob | undefined> {
    const conn = await db();
    if (!conn) return undefined;
    const rec = await conn.get('localThumbs', dataTxId).catch(() => undefined);
    if (!rec || rec.version !== version) return undefined;
    return rec.blob;
  },

  async putLocalThumb(dataTxId: string, blob: Blob, version: number): Promise<void> {
    const conn = await db();
    if (!conn) return;
    await conn.put('localThumbs', { dataTxId, blob, version, at: Date.now() }).catch(() => undefined);
  },

  async getSync(key: string): Promise<SyncRecord | undefined> {
    const mem = memory.sync.get(key);
    if (mem) return mem;
    const conn = await db();
    if (!conn) return undefined;
    const rec = await conn.get('syncState', key).catch(() => undefined);
    if (rec) memory.sync.set(key, rec);
    return rec;
  },

  async setSync(key: string, lastHeight: number): Promise<void> {
    const rec: SyncRecord = { key, lastHeight, updatedAt: Date.now() };
    memory.sync.set(key, rec);
    const conn = await db();
    if (!conn) return;
    await conn.put('syncState', rec).catch(() => undefined);
  },

  /** Wipe everything — exposed in the UI so a user can force a clean resync. */
  async clear(): Promise<void> {
    memory.bodies.clear();
    memory.entities.clear();
    memory.sync.clear();
    const conn = await db();
    if (!conn) return;
    try {
      await Promise.all([
        conn.clear('txBodies'),
        conn.clear('entities'),
        conn.clear('syncState'),
        conn.clear('localThumbs'),
      ]);
    } catch {
      /* best-effort */
    }
  },

  async stats(): Promise<{ bodies: number; entities: number }> {
    const conn = await db();
    if (!conn) return { bodies: memory.bodies.size, entities: memory.entities.size };
    try {
      const [bodies, entities] = await Promise.all([conn.count('txBodies'), conn.count('entities')]);
      return { bodies, entities };
    } catch {
      return { bodies: memory.bodies.size, entities: memory.entities.size };
    }
  },
};

/** Test hook: drop connections and in-memory state between cases. */
export function __resetCacheForTests() {
  conn?.close();
  conn = null;
  opening = null;
  memory.bodies.clear();
  memory.entities.clear();
  memory.sync.clear();
}
