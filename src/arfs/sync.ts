/**
 * Drive synchronisation.
 *
 * Three strategies stack here, cheapest first:
 *
 *   1. **Warm start.** Cached entities are emitted before any network call, so revisiting a drive
 *      paints instantly.
 *   2. **Incremental sync.** We remember the last block height synced per drive and query only
 *      above it. Steady state is a single cheap query returning nothing.
 *   3. **Sharded cold sync.** A first-time sync splits the drive's block range into chunks queried
 *      concurrently, because cursor pagination is otherwise a serial chain of ~2s round-trips.
 *
 * ArFS snapshots, when a drive has them, collapse many body fetches into one and are ingested
 * straight into the body cache.
 */

import { ArweaveGql, currentHeight, paginate, queryAll, queryFirst, RESILIENT_DATA_GATEWAYS, type QuerySpec } from './gql';
import { resolveEntities, type ResolveOptions } from './metadata';
import { cache } from '../cache/db';
import { mapPool } from './pool';
import { parseStub, Tag, type DriveEntity, type GqlNode, type ResolvedEntity } from './types';

/** Cooperative cancellation token, checked between pages and before each body fetch. */
export interface AbortToken {
  aborted: boolean;
}

/** Re-query a few blocks below the watermark to absorb gateway indexing lag. */
const REORG_MARGIN = 10;
/** Concurrent block-range shards for a cold sync. */
const COLD_SHARDS = 6;
/** Below this many blocks, sharding costs more than the serial walk saves. */
const MIN_SHARD_SPAN = 5_000;

export type SyncPhase = 'cached' | 'querying' | 'resolving' | 'done' | 'error';

export interface SyncProgress {
  phase: SyncPhase;
  /** Entity revisions discovered via GraphQL so far. */
  found: number;
  /** Entity revisions whose body has been resolved so far. */
  resolved: number;
  error?: string;
}

export interface SyncOptions extends Omit<ResolveOptions, 'onBatch'> {
  /** Emitted whenever more entities become available, for progressive rendering. */
  onEntities?: (entities: ResolvedEntity[]) => void;
  onProgress?: (progress: SyncProgress) => void;
  /** Force a full resync, ignoring the cached height watermark. */
  force?: boolean;
}

export class ArfsClient {
  readonly gql: ArweaveGql;
  private readonly resolveOpts: ResolveOptions;

  constructor(opts: { gateways?: readonly string[]; fetchImpl?: typeof fetch; concurrency?: number } = {}) {
    this.gql = new ArweaveGql({
      ...(opts.gateways ? { gateways: opts.gateways } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    this.resolveOpts = {
      ...(opts.gateways ? { gateways: opts.gateways } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts.concurrency ? { concurrency: opts.concurrency } : {}),
    };
  }

  /**
   * List every drive owned by an address.
   *
   * The `owners` filter is load-bearing for correctness, not just speed: anyone can post a
   * transaction carrying someone else's Drive-Id, so entities are only ever trusted from the
   * drive owner's own address.
   */
  async listDrives(owner: string, opts: SyncOptions = {}): Promise<DriveEntity[]> {
    const syncKey = `drives:${owner}`;
    const emit = (entities: ResolvedEntity[]) => opts.onEntities?.(entities);

    const cached = (await cache.entitiesByOwner(owner)).filter((e) => e.entityType === 'drive');
    if (cached.length) {
      opts.onProgress?.({ phase: 'cached', found: cached.length, resolved: cached.length });
      emit(cached);
    }

    const watermark = opts.force ? 0 : ((await cache.getSync(syncKey))?.lastHeight ?? 0);
    const spec: QuerySpec = {
      tags: [{ name: Tag.entityType, values: ['drive'] }],
      owners: [owner],
      ...(watermark ? { minHeight: Math.max(0, watermark - REORG_MARGIN) } : {}),
      sort: 'HEIGHT_ASC',
    };

    const collected: ResolvedEntity[] = [...cached];
    let maxHeight = watermark;
    let found = cached.length;

    try {
      opts.onProgress?.({ phase: 'querying', found, resolved: found });
      for await (const page of paginate(this.gql, spec)) {
        const stubs = page.map((e) => parseStub(e.node)).filter((s) => s !== null);
        found += stubs.length;
        opts.onProgress?.({ phase: 'resolving', found, resolved: collected.length });

        const resolved = await resolveEntities(stubs, this.resolveOpts);
        collected.push(...resolved);
        for (const stub of stubs) if (stub.height !== null) maxHeight = Math.max(maxHeight, stub.height);
        emit(resolved);
        opts.onProgress?.({ phase: 'resolving', found, resolved: collected.length });
      }

      if (maxHeight > watermark) await cache.setSync(syncKey, maxHeight);
      opts.onProgress?.({ phase: 'done', found, resolved: collected.length });
    } catch (err) {
      opts.onProgress?.({
        phase: 'error',
        found,
        resolved: collected.length,
        error: err instanceof Error ? err.message : String(err),
      });
      // Cached drives are still worth showing when the network is unreachable.
      if (!cached.length) throw err;
    }

    // Newest revision per drive ID.
    const byId = new Map<string, DriveEntity>();
    for (const entity of collected) {
      if (entity.entityType !== 'drive') continue;
      const existing = byId.get(entity.entityId);
      if (!existing || (entity.height ?? Infinity) >= (existing.height ?? Infinity)) byId.set(entity.entityId, entity);
    }
    return [...byId.values()];
  }

  /**
   * Sync all entities of one drive. Returns every revision known locally, which `buildTree`
   * reduces to current state.
   */
  async syncDrive(driveId: string, owner: string, opts: SyncOptions = {}): Promise<ResolvedEntity[]> {
    const syncKey = `drive:${driveId}`;
    const collected: ResolvedEntity[] = [];

    const cached = await cache.entitiesByDrive(driveId);
    if (cached.length) {
      collected.push(...cached);
      opts.onProgress?.({ phase: 'cached', found: cached.length, resolved: cached.length });
      opts.onEntities?.(cached);
    }

    // Entities whose body was unreadable last time sit below the sync watermark, so the
    // incremental query would never look at them again. Retry them explicitly — but not on the
    // same single gateway everything else uses: a transient 429 there will resolve on retry, but
    // a transaction that gateway simply never indexed (confirmed to happen even for entities that
    // are genuinely mined and available elsewhere — arweave.net 404s a real, retrievable
    // transaction more often than it should) never will, no matter how many times this runs. This
    // is the same "correctness over latency" tradeoff `RESILIENT_DATA_GATEWAYS`'s own doc comment
    // already describes for one-shot fetches: healing only ever touches the small unresolved
    // subset of a drive, not every entity, so the second gateway's extra latency is bounded and
    // worth paying to actually fix the file instead of leaving it stuck forever.
    const unresolved = cached.filter((e) => e.unresolved);
    if (unresolved.length) {
      const healed = await resolveEntities(unresolved, {
        ...this.resolveOpts,
        gateways: RESILIENT_DATA_GATEWAYS,
        ...(opts.decrypt ? { decrypt: opts.decrypt } : {}),
      }).catch(() => []);
      const fixed = healed.filter((e) => !e.unresolved);
      if (fixed.length) {
        collected.push(...fixed);
        opts.onEntities?.(fixed);
      }
    }

    const watermark = opts.force ? 0 : ((await cache.getSync(syncKey))?.lastHeight ?? 0);
    let found = cached.length;
    let maxHeight = watermark;

    // Drive, folders and files in a single query: the gateway ORs values within one tag filter,
    // which halves the round-trips a naive per-entity-type implementation would need.
    const baseSpec: QuerySpec = {
      tags: [
        { name: Tag.driveId, values: [driveId] },
        { name: Tag.entityType, values: ['drive', 'folder', 'file'] },
      ],
      owners: [owner],
      sort: 'HEIGHT_ASC',
    };

    const ingestPage = async (nodes: GqlNode[]) => {
      const stubs = nodes.map((n) => parseStub(n)).filter((s) => s !== null);
      if (!stubs.length) return;
      found += stubs.length;
      opts.onProgress?.({ phase: 'resolving', found, resolved: collected.length });

      // Emit per chunk rather than per page: under rate limiting a 100-entity page can take
      // minutes, and the user should see rows appear throughout rather than all at the end.
      await resolveEntities(stubs, {
        ...this.resolveOpts,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.decrypt ? { decrypt: opts.decrypt } : {}),
        onBatch: (batch) => {
          collected.push(...batch);
          opts.onEntities?.(batch);
          opts.onProgress?.({ phase: 'resolving', found, resolved: collected.length });
        },
      });
      for (const stub of stubs) if (stub.height !== null) maxHeight = Math.max(maxHeight, stub.height);
    };

    try {
      opts.onProgress?.({ phase: 'querying', found, resolved: collected.length });

      if (watermark > 0) {
        // Incremental: a narrow range, cheapest as a plain serial walk.
        const spec = { ...baseSpec, minHeight: Math.max(0, watermark - REORG_MARGIN) };
        for await (const page of paginate(this.gql, spec)) await ingestPage(page.map((e) => e.node));
      } else {
        await this.coldSync(driveId, baseSpec, ingestPage, opts);
      }

      if (maxHeight > watermark) await cache.setSync(syncKey, maxHeight);
      opts.onProgress?.({ phase: 'done', found, resolved: collected.length });
    } catch (err) {
      opts.onProgress?.({
        phase: 'error',
        found,
        resolved: collected.length,
        error: err instanceof Error ? err.message : String(err),
      });
      if (!cached.length) throw err;
    }

    return collected;
  }

  /**
   * First-time sync: find the drive's block span, then walk shards of it concurrently.
   * Block ranges partition results disjointly, so shards can't duplicate or drop entities.
   */
  private async coldSync(
    driveId: string,
    baseSpec: QuerySpec,
    ingestPage: (nodes: GqlNode[]) => Promise<void>,
    opts: SyncOptions,
  ): Promise<void> {
    const owner = baseSpec.owners?.[0] ?? '';
    await this.ingestSnapshots(driveId, owner);
    await this.primeRoot(driveId, owner, ingestPage);

    const [firstEdge, tip] = await Promise.all([
      queryFirst(this.gql, baseSpec).catch(() => null),
      currentHeight(this.gql).catch(() => 0),
    ]);

    const start = firstEdge?.node.block?.height ?? 0;
    const span = tip - start;

    if (!tip || span < MIN_SHARD_SPAN) {
      for await (const page of paginate(this.gql, baseSpec)) await ingestPage(page.map((e) => e.node));
      return;
    }

    const size = Math.ceil(span / COLD_SHARDS);
    const shards = Array.from({ length: COLD_SHARDS }, (_, i) => ({
      minHeight: start + i * size,
      // Ranges are inclusive on both ends, so stop one short of the next shard's start.
      maxHeight: i === COLD_SHARDS - 1 ? undefined : start + (i + 1) * size - 1,
    }));

    await mapPool(shards, COLD_SHARDS, async (shard) => {
      const spec: QuerySpec = {
        ...baseSpec,
        minHeight: shard.minHeight,
        ...(shard.maxHeight !== undefined ? { maxHeight: shard.maxHeight } : {}),
      };
      // Pass the signal object itself, not a snapshot of its current value, or a superseded sync
      // keeps running and keeps consuming the shared fetch budget.
      for await (const page of paginate(this.gql, spec, opts.signal)) {
        await ingestPage(page.map((e) => e.node));
      }
    });
  }

  /**
   * Fetch the drive entity and the root folder's direct children before the bulk sync.
   *
   * The bulk sync walks history in block order, so on a large drive the drive entity — and with
   * it `rootFolderId` — can surface at any point, leaving the user staring at an empty folder
   * while thousands of entities load behind it. Both queries below are cheap and targeted:
   * a drive has few revisions, and `Parent-Folder-Id` is an indexed tag, so the first screen
   * populates in seconds no matter how big the drive is.
   */
  private async primeRoot(
    driveId: string,
    owner: string,
    ingestPage: (nodes: GqlNode[]) => Promise<void>,
  ): Promise<void> {
    try {
      const driveEdges = await queryAll(this.gql, {
        tags: [
          { name: Tag.driveId, values: [driveId] },
          { name: Tag.entityType, values: ['drive'] },
        ],
        ...(owner ? { owners: [owner] } : {}),
        sort: 'HEIGHT_ASC',
      });
      if (!driveEdges.length) return;
      // Resolving these also writes them to the cache, which is where we read the root ID back from.
      await ingestPage(driveEdges.map((e) => e.node));

      // Newest drive revision wins, the same rule the tree builder uses.
      const rootId = (await cache.entitiesByDrive(driveId))
        .filter((e): e is Extract<ResolvedEntity, { entityType: 'drive' }> => e.entityType === 'drive')
        .sort((a, b) => (b.height ?? Infinity) - (a.height ?? Infinity))[0]?.rootFolderId;
      if (!rootId) return;

      for await (const page of paginate(this.gql, {
        tags: [
          { name: Tag.driveId, values: [driveId] },
          { name: Tag.parentFolderId, values: [rootId] },
        ],
        ...(owner ? { owners: [owner] } : {}),
        sort: 'HEIGHT_ASC',
      })) {
        await ingestPage(page.map((e) => e.node));
      }
    } catch {
      /* priming is an optimisation — the sharded sync still covers everything */
    }
  }

  /**
   * Ingest ArFS snapshots into the body cache.
   *
   * A snapshot bundles many entities' metadata into a single transaction, so ingesting one turns
   * N HTTP fetches into 1. Entirely an optimisation: if anything about the snapshot is malformed
   * we simply return, and normal resolution fetches the bodies itself.
   */
  private async ingestSnapshots(driveId: string, owner: string): Promise<void> {
    try {
      const edges = await queryAll(this.gql, {
        tags: [
          { name: Tag.driveId, values: [driveId] },
          { name: Tag.entityType, values: ['snapshot'] },
        ],
        ...(owner ? { owners: [owner] } : {}),
        sort: 'HEIGHT_ASC',
      });
      if (!edges.length) return;

      const gateways = this.resolveOpts.gateways ?? ['https://arweave.net'];
      const fetchImpl = this.resolveOpts.fetchImpl ?? globalThis.fetch.bind(globalThis);

      await mapPool(edges, 4, async (edge) => {
        const res = await fetchImpl(`${gateways[0]}/${edge.node.id}`);
        if (!res.ok) return;
        const snapshot = JSON.parse(await res.text()) as {
          txSnapshots?: { gqlNode?: { id?: string }; dataJson?: string }[];
        };

        const bodies: { txId: string; body: string }[] = [];
        for (const entry of snapshot.txSnapshots ?? []) {
          const txId = entry.gqlNode?.id;
          if (!txId || typeof entry.dataJson !== 'string') continue;
          bodies.push({ txId, body: decodeSnapshotBody(entry.dataJson) });
        }
        if (bodies.length) await cache.putBodies(bodies);
      });
    } catch {
      /* snapshots are a pure optimisation — never let them fail a sync */
    }
  }
}

/** Snapshot bodies are stored as raw JSON in some versions and base64 in others. */
function decodeSnapshotBody(dataJson: string): string {
  const trimmed = dataJson.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return dataJson;
  try {
    const decoded = atob(dataJson.replace(/-/g, '+').replace(/_/g, '/'));
    const probe = decoded.trim();
    if (probe.startsWith('{') || probe.startsWith('[')) return decoded;
  } catch {
    /* not base64 */
  }
  return dataJson;
}
