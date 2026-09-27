/**
 * Metadata body resolution — the hot path.
 *
 * ArFS stores an entity's name (and a file's size and data pointer) in the transaction *body*, not
 * its tags, so every entity costs one HTTP fetch. Measured on mainnet:
 *
 *     serial:          4.56 s/item  ->   500 files ≈ 38 minutes
 *     pool of 48:      0.163 s/item ->   500 files ≈ 82 seconds     (28x, 100/100 successful)
 *     warm cache:      0 fetches    ->   instant
 *
 * That gap is the difference between this app and ArDrive, so the two things this module must
 * never stop doing are: read through the cache first, and fetch what's left concurrently.
 */

import { AdaptiveGate, mapPool } from './pool';
import { cache } from '../cache/db';
import { DEFAULT_DATA_GATEWAYS } from './gql';
import { decryptJson, DecryptionFailedError } from './crypto/cipher';
import type { DerivedKey } from './crypto/kdf';
import type {
  DriveEntity,
  DriveJson,
  EntityStub,
  FileEntity,
  FileJson,
  FolderEntity,
  FolderJson,
  ResolvedEntity,
} from './types';

/**
 * Starting width for body fetches; the gate tunes itself from here.
 *
 * A short 100-request burst at 48-way looked great in isolation (0.163 s/item). Sustained over
 * thousands of requests it is not: arweave.net returns HTTP 429 for roughly half of them. So we
 * start conservatively and let AIMD find the real ceiling.
 */
export const DEFAULT_CONCURRENCY = 8;
const MIN_CONCURRENCY = 3;
/** Exported so callers driving their own pool on top of `fetchBinaryBody` (batch download) can
 *  size that pool "wider than the gate" too — see `fetchBinaryBodies`'s comment below. */
export const MAX_CONCURRENCY = 32;

/**
 * How long a gateway may take to *start* responding (status + headers). A hung connection must
 * not occupy a gate slot indefinitely.
 *
 * This used to be a single `AbortSignal.timeout` passed to `fetch` — which also covers reading the
 * body, so it capped the *entire transfer* at 20s. Harmless for the small metadata JSON this module
 * was first written for, but `fetchBinaryBody` also downloads whole files (every batch-download
 * item, and every private file's data for preview/download), and anything taking longer than 20s to
 * transfer was aborted mid-body and failed on every retry. Confirmed directly: headers arrived in
 * ~120ms and the body read was still killed by the timeout. On an ordinary connection that ruled
 * out most videos. Now split into a headers deadline plus a stall timeout below.
 */
let RESPONSE_TIMEOUT_MS = 20_000;
/**
 * During the body, abort only if no bytes arrive for this long. A slow-but-progressing transfer of
 * any size keeps going; a connection that goes silent mid-body is still reclaimed.
 */
let STALL_TIMEOUT_MS = 30_000;

/** Test hook: shrink the timeouts so their behavior can be exercised in milliseconds. */
export function __setFetchTimeoutsForTests(responseMs: number, stallMs: number) {
  RESPONSE_TIMEOUT_MS = responseMs;
  STALL_TIMEOUT_MS = stallMs;
}
/** Attempts per transaction before we accept that the body is unavailable. */
const MAX_ATTEMPTS = 4;

/**
 * One gate for every body fetch in the process, shared across drives and across the cold sync's
 * parallel block shards. Without this the shards multiply their pools together and stall.
 */
const bodyGate = new AdaptiveGate({
  initial: DEFAULT_CONCURRENCY,
  min: MIN_CONCURRENCY,
  max: MAX_CONCURRENCY,
});

/** The gateway is rate-limiting us: worth retrying, after backing off. */
class RateLimited extends Error {}
/** The gateway does not have this transaction: retrying the same host is pointless. */
class NotFound extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rotates the starting gateway so load spreads instead of always landing on the first one. */
let gatewayCursor = 0;

/**
 * When present, private entities in this drive get decrypted instead of left as the M1 locked
 * placeholder. Absent by default, so a session that hasn't unlocked the drive (or a public-only
 * session) behaves exactly as before — this is additive, not a fork in the read path.
 */
export interface DecryptContext {
  driveKey: DerivedKey;
  /** Lazy + cached by the caller (see state/privateDrives.ts) — file keys are derived on demand. */
  getFileKey: (fileId: string) => Promise<DerivedKey>;
}

export interface ResolveOptions {
  concurrency?: number;
  gateways?: readonly string[];
  fetchImpl?: typeof fetch;
  /** Fires as entities resolve, so the UI can fill in skeleton rows progressively. */
  onBatch?: (entities: ResolvedEntity[]) => void;
  signal?: { aborted: boolean };
  decrypt?: DecryptContext;
}

async function fetchOnceAs<T>(url: string, fetchImpl: typeof fetch, read: (res: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer = setTimeout(
    () => controller.abort(new DOMException(`${url} did not respond`, 'TimeoutError')),
    RESPONSE_TIMEOUT_MS,
  );
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 429) throw new RateLimited(`${url} rate limited`);
    if (res.status === 404) throw new NotFound(`${url} not found`);
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    if (!res.body) return await read(res);

    // Re-arm on every chunk: the deadline is "no progress for STALL_TIMEOUT_MS", not "done within".
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => controller.abort(new DOMException(`${url} stalled mid-transfer`, 'TimeoutError')),
        STALL_TIMEOUT_MS,
      );
    };
    arm();
    const watched = res.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, out) {
          arm();
          out.enqueue(chunk);
        },
      }),
    );
    return await read(new Response(watched, { status: res.status, statusText: res.statusText, headers: res.headers }));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch one transaction body, retrying across gateways and through rate limiting.
 *
 * Rate limiting is the normal case here, not an exception, so a 429 must never be treated as
 * "this file doesn't exist" — that would quietly delete a file from the user's drive.
 *
 * Generic over how the response is read: `.text()` for the public JSON path below, or
 * `.arrayBuffer()` for private-drive ciphertext (`fetchBinaryBody`) — UTF-8-decoding arbitrary
 * binary via `.text()` would corrupt it, so that path must never share this string-typed one.
 * Both share the same gate, retry/backoff, and gateway-rotation logic either way.
 */
async function fetchBodyAs<T>(
  txId: string,
  gateways: readonly string[],
  fetchImpl: typeof fetch,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  const notFoundOn = new Set<string>();

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const offset = gatewayCursor++;

    for (let i = 0; i < gateways.length; i++) {
      const gateway = gateways[(offset + i) % gateways.length]!;
      if (notFoundOn.has(gateway)) continue;

      try {
        await bodyGate.waitForCooldown();
        const body = await bodyGate.run(() => fetchOnceAs(`${gateway}/${txId}`, fetchImpl, read));
        bodyGate.reward();
        return body;
      } catch (err) {
        lastError = err;
        if (err instanceof RateLimited) {
          // Back off globally: every worker is talking to the same gateway.
          bodyGate.penalise(500 * 2 ** attempt);
        } else if (err instanceof NotFound) {
          notFoundOn.add(gateway);
        }
      }
    }

    if (notFoundOn.size === gateways.length) break;
    // Jitter so a synchronised swarm doesn't retry in lockstep.
    await sleep(250 * 2 ** attempt + Math.random() * 250);
  }

  throw lastError instanceof Error ? lastError : new Error(`failed to fetch ${txId}`);
}

async function fetchBody(txId: string, gateways: readonly string[], fetchImpl: typeof fetch): Promise<string> {
  return fetchBodyAs(txId, gateways, fetchImpl, (res) => res.text());
}

/**
 * Binary-safe counterpart to `fetchBody`, for private-drive ciphertext. Shares the same gate and
 * gateway list as the public path but is never cached here — the useful cache point for private
 * entities is the *decrypted* result (`cache.putEntities`, same as public entities), not the raw
 * ciphertext, so there's no text-typed cache to route around.
 */
export async function fetchBinaryBody(
  txId: string,
  opts: Pick<ResolveOptions, 'gateways' | 'fetchImpl'> = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const gateways = opts.gateways?.length ? opts.gateways : DEFAULT_DATA_GATEWAYS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const buf = await fetchBodyAs(txId, gateways, fetchImpl, (res) => res.arrayBuffer());
  return new Uint8Array(buf);
}

/**
 * Concurrent counterpart to `fetchBinaryBody`, for resolving many private entities' ciphertext at
 * once — the same shape as `fetchBodies` but binary, and (as above) uncached, since the useful
 * cache point for private entities is the decrypted result.
 */
export async function fetchBinaryBodies(
  txIds: readonly string[],
  opts: Pick<ResolveOptions, 'gateways' | 'fetchImpl' | 'concurrency' | 'signal'> = {},
): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const unique = [...new Set(txIds)];
  const bodies = new Map<string, Uint8Array<ArrayBuffer>>();

  await mapPool(
    unique,
    opts.concurrency ?? MAX_CONCURRENCY,
    async (txId) => {
      if (opts.signal?.aborted) throw new Error('aborted');
      return fetchBinaryBody(txId, opts);
    },
    (body, txId) => {
      if (body !== undefined) bodies.set(txId, body);
    },
  );

  return bodies;
}

/**
 * Resolve transaction bodies for the given IDs, reading through the cache and fetching only what
 * is missing. Bodies are immutable, so anything cached is trusted permanently.
 */
export async function fetchBodies(
  txIds: readonly string[],
  opts: ResolveOptions = {},
): Promise<Map<string, string>> {
  const gateways = opts.gateways?.length ? opts.gateways : DEFAULT_DATA_GATEWAYS;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  const unique = [...new Set(txIds)];
  const bodies = await cache.getBodies(unique);
  const missing = unique.filter((id) => !bodies.has(id));
  if (!missing.length) return bodies;

  const pending: { txId: string; body: string }[] = [];
  await mapPool(
    missing,
    // Wider than the gate on purpose: the adaptive gate is what actually limits concurrency, and
    // capping here would stop it ever ramping up on a healthy gateway.
    opts.concurrency ?? MAX_CONCURRENCY,
    async (txId) => {
      if (opts.signal?.aborted) throw new Error('aborted');
      // fetchBody gates each individual attempt, so shards share one adaptive budget.
      return fetchBody(txId, gateways, fetchImpl);
    },
    (body, txId) => {
      if (body === undefined) return;
      bodies.set(txId, body);
      pending.push({ txId, body });
    },
  );

  await cache.putBodies(pending);
  return bodies;
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** A private entity's body is encrypted, so its real name is unavailable until M3. */
function lockedName(stub: EntityStub): string {
  const short = stub.entityId.slice(0, 8);
  return stub.entityType === 'drive' ? `Private drive ${short}` : `Encrypted ${stub.entityType} ${short}`;
}

/**
 * Stand-in for an entity whose metadata body could not be read.
 *
 * Rate limiting makes this a routine outcome, not a rare one, so returning null here would mean
 * files disappearing from a drive whenever a gateway got busy. Listing a placeholder is honest:
 * the entity exists on chain, we just can't name it yet. A later sync fills it in for real.
 */
function unresolvedEntity(stub: EntityStub): ResolvedEntity | null {
  const short = stub.entityId.slice(0, 8);
  const base = { ...stub, isHidden: false, unresolved: true };

  switch (stub.entityType) {
    case 'drive':
      return { ...base, entityType: 'drive', name: `Drive ${short}`, rootFolderId: '' };
    case 'folder':
      return { ...base, entityType: 'folder', name: `Folder ${short}` };
    case 'file':
      return {
        ...base,
        entityType: 'file',
        name: `Unavailable file ${short}`,
        size: 0,
        lastModifiedDate: stub.unixTime * 1000,
        dataTxId: '',
        dataContentType: 'application/octet-stream',
      };
    default:
      return null;
  }
}

/** Locked placeholder for a private entity — used when no decrypt context is available at all. */
function lockedEntity(stub: EntityStub): ResolvedEntity | null {
  const base = { ...stub, name: lockedName(stub), isHidden: false };
  if (stub.entityType === 'drive') return { ...base, entityType: 'drive', rootFolderId: '' } as DriveEntity;
  if (stub.entityType === 'folder') return { ...base, entityType: 'folder' } as FolderEntity;
  if (stub.entityType === 'file') {
    return {
      ...base,
      entityType: 'file',
      size: 0,
      lastModifiedDate: stub.unixTime * 1000,
      dataTxId: '',
      dataContentType: 'application/octet-stream',
    } as FileEntity;
  }
  return null;
}

/**
 * Decrypt a private entity's metadata into the same shape `toEntity` produces for a public one.
 * Drive and folder bodies are decrypted with the drive key directly; a file's metadata is
 * decrypted with its own file key (derived from the drive key), same as ArFS's own layering —
 * only the file's *data* transaction stays encrypted at this point, decrypted lazily on preview/
 * download (`fetchAndDecryptFileData`).
 *
 * Falls back to the locked placeholder (not `unresolvedEntity`) on failure: a decrypt failure here
 * — corrupt ciphertext, an unexpected per-file key issue — is a different situation from "the
 * gateway didn't have this body," and conflating the two would misdescribe what actually happened.
 */
async function toPrivateEntity(
  stub: EntityStub,
  ciphertext: Uint8Array<ArrayBuffer> | undefined,
  decrypt: DecryptContext,
): Promise<ResolvedEntity | null> {
  if (!ciphertext || !stub.cipherIv) return lockedEntity(stub);

  try {
    if (stub.entityType === 'drive') {
      const json = await decryptJson<DriveJson>(stub.cipherIv, decrypt.driveKey, ciphertext);
      return {
        ...stub,
        entityType: 'drive',
        name: json.name ?? lockedName(stub),
        rootFolderId: json.rootFolderId ?? '',
        isHidden: json.isHidden === true,
        unresolved: false, // see the matching comment in toEntity's 'drive' case
      };
    }
    if (stub.entityType === 'folder') {
      const json = await decryptJson<FolderJson>(stub.cipherIv, decrypt.driveKey, ciphertext);
      return {
        ...stub,
        entityType: 'folder',
        name: json.name ?? lockedName(stub),
        isHidden: json.isHidden === true,
        unresolved: false,
      };
    }
    if (stub.entityType === 'file') {
      const fileKey = await decrypt.getFileKey(stub.entityId);
      const json = await decryptJson<FileJson>(stub.cipherIv, fileKey, ciphertext);
      return {
        ...stub,
        entityType: 'file',
        name: json.name ?? lockedName(stub),
        size: typeof json.size === 'number' ? json.size : 0,
        lastModifiedDate:
          typeof json.lastModifiedDate === 'number' ? json.lastModifiedDate : stub.unixTime * 1000,
        dataTxId: json.dataTxId ?? '',
        dataContentType: json.dataContentType || 'application/octet-stream',
        isHidden: json.isHidden === true,
        unresolved: false,
        ...(json.thumbnail ? { thumbnail: json.thumbnail } : {}),
      };
    }
    return null;
  } catch (err) {
    if (err instanceof DecryptionFailedError) return lockedEntity(stub);
    throw err;
  }
}

function toEntity(stub: EntityStub, raw: string | undefined): ResolvedEntity | null {
  // No decrypt context reached this call site — see resolveEntities, which routes private
  // entities to toPrivateEntity instead whenever one is available.
  if (stub.privacy === 'private') return lockedEntity(stub);

  switch (stub.entityType) {
    case 'drive': {
      const json = parseJson<DriveJson>(raw);
      if (!json) return unresolvedEntity(stub);
      return {
        ...stub,
        entityType: 'drive',
        name: json.name ?? `Drive ${stub.entityId.slice(0, 8)}`,
        rootFolderId: json.rootFolderId ?? '',
        isHidden: json.isHidden === true,
        // Explicit, not just omitted: `stub` is a plain `EntityStub` on every *normal* call, which
        // never carries this field at all — but `sync.ts`'s "heal unresolved entities" retry
        // passes an already-resolved (and previously `unresolved: true`) entity back in as the
        // `stub` here. Object spread only ever *adds or overrides* keys, so without this the
        // spread of `...stub` silently carried a stale `unresolved: true` through into an entity
        // that had just, in this same call, successfully resolved a real body — meaning the retry
        // could never actually mark anything as fixed, no matter how many times it ran.
        unresolved: false,
      };
    }
    case 'folder': {
      const json = parseJson<FolderJson>(raw);
      if (!json) return unresolvedEntity(stub);
      return {
        ...stub,
        entityType: 'folder',
        name: json.name ?? 'Unnamed folder',
        isHidden: json.isHidden === true,
        unresolved: false, // see the matching comment in the 'drive' case above
      };
    }
    case 'file': {
      const json = parseJson<FileJson>(raw);
      if (!json) return unresolvedEntity(stub);
      return {
        ...stub,
        entityType: 'file',
        name: json.name ?? 'Unnamed file',
        // Keep files whose body is missing a data pointer rather than hiding them; the UI
        // disables download instead, so nothing silently disappears from a user's drive.
        size: typeof json.size === 'number' ? json.size : 0,
        lastModifiedDate:
          typeof json.lastModifiedDate === 'number' ? json.lastModifiedDate : stub.unixTime * 1000,
        dataTxId: json.dataTxId ?? '',
        dataContentType: json.dataContentType || 'application/octet-stream',
        isHidden: json.isHidden === true,
        unresolved: false, // see the matching comment in the 'drive' case above
        ...(json.pinnedDataOwner ? { pinnedDataOwner: json.pinnedDataOwner } : {}),
        ...(json.thumbnail ? { thumbnail: json.thumbnail } : {}),
      };
    }
    default:
      // snapshot / drive-signature carry no user-visible entity.
      return null;
  }
}

/**
 * Rows appear in chunks this size rather than only when a whole GraphQL page finishes.
 *
 * A page is 100 entities, and under rate limiting that can take minutes — long enough that the
 * user would stare at an empty folder while data was arriving. The adaptive gate still governs
 * actual concurrency, so this costs throughput nothing.
 */
const EMIT_CHUNK = 16;

/** Resolve stubs into full entities, fetching bodies concurrently and caching the results. */
export async function resolveEntities(
  stubs: readonly EntityStub[],
  opts: ResolveOptions = {},
): Promise<ResolvedEntity[]> {
  const resolved: ResolvedEntity[] = [];

  for (let i = 0; i < stubs.length; i += EMIT_CHUNK) {
    if (opts.signal?.aborted) break;
    const chunk = stubs.slice(i, i + EMIT_CHUNK);

    const isEntity = (s: EntityStub) =>
      s.entityType === 'drive' || s.entityType === 'folder' || s.entityType === 'file';
    const needsBody = chunk.filter((s) => s.privacy === 'public' && isEntity(s));
    const bodies = await fetchBodies(
      needsBody.map((s) => s.metadataTxId),
      opts,
    );

    // Private entities are only fetched (as ciphertext, never through the text-typed cache above)
    // when the caller has actually unlocked this drive — otherwise they stay the M1 locked
    // placeholder, exactly as before.
    let ciphertexts: Map<string, Uint8Array<ArrayBuffer>> | null = null;
    if (opts.decrypt) {
      const needsCiphertext = chunk.filter((s) => s.privacy === 'private' && isEntity(s));
      ciphertexts = await fetchBinaryBodies(
        needsCiphertext.map((s) => s.metadataTxId),
        opts,
      );
    }

    const batch: ResolvedEntity[] = [];
    for (const stub of chunk) {
      const entity =
        stub.privacy === 'private' && opts.decrypt
          ? await toPrivateEntity(stub, ciphertexts!.get(stub.metadataTxId), opts.decrypt)
          : toEntity(stub, bodies.get(stub.metadataTxId));
      if (entity) batch.push(entity);
    }

    await cache.putEntities(batch);
    resolved.push(...batch);
    opts.onBatch?.(batch);
  }

  return resolved;
}
