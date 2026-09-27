/**
 * Application state for drive listing and browsing.
 *
 * Sync streams entities in as they resolve. Rebuilding the tree on every batch would be wasteful
 * on a large drive, so rebuilds are coalesced onto a short timer — the list still fills in visibly
 * while the reduction work stays bounded.
 */

import { create } from 'zustand';
import { ArfsClient, type SyncProgress } from '../arfs/sync';
import { buildTree, type DriveTree } from '../arfs/tree';
import type { DriveEntity, ResolvedEntity } from '../arfs/types';
import { cache } from '../cache/db';
import { usePrivateDrives } from './privateDrives';

/** Coalescing window for tree rebuilds during an active sync. */
const REBUILD_MS = 120;

const client = new ArfsClient();

interface ArfsState {
  drives: DriveEntity[];
  drivesProgress: SyncProgress | null;

  activeDriveId: string | null;
  entities: ResolvedEntity[];
  tree: DriveTree | null;
  driveProgress: SyncProgress | null;

  loadDrives: (owner: string, force?: boolean) => Promise<void>;
  loadDrive: (driveId: string, owner: string, force?: boolean) => Promise<void>;
  /**
   * A quiet incremental check for whether any pending (just-uploaded, not yet mined) entity in
   * the open drive has since been confirmed — merges in only genuinely new results, never resets
   * `entities`/`tree` first the way `loadDrive` does, so the list never visibly flashes empty.
   * Meant to be called on a timer while something is pending; see `DriveBrowser.tsx`.
   */
  pollPending: (driveId: string, owner: string) => Promise<void>;
  clearCache: () => Promise<void>;
  reset: () => void;
  /**
   * Splice the result of a successful write straight into state — see `arfs/write/entities.ts`
   * for why this needs no changes to the tree-reduction logic. Applies to whichever of `drives`
   * (the drive list) and `entities`/`tree` (the open drive) the written entity actually belongs to.
   */
  applyLocalMutation: (written: ResolvedEntity[]) => void;
}

/** Guards against a stale sync writing over a newer one when the user switches drives fast. */
let driveRun = 0;
let drivesRun = 0;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Cancels the in-flight drive sync. Ignoring a stale sync's *results* isn't enough — it would
 * keep issuing requests and holding the shared fetch budget, starving the sync the user is
 * actually waiting on.
 */
let driveAbort: { aborted: boolean } = { aborted: false };

export const useArfs = create<ArfsState>((set, get) => {
  const scheduleRebuild = (run: number) => {
    if (rebuildTimer) return;
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      if (run !== driveRun) return;
      set({ tree: buildTree(get().entities) });
    }, REBUILD_MS);
  };

  return {
    drives: [],
    drivesProgress: null,
    activeDriveId: null,
    entities: [],
    tree: null,
    driveProgress: null,

    async loadDrives(owner: string, force = false) {
      const run = ++drivesRun;
      const seen = new Map<string, DriveEntity>();
      set({ drives: [], drivesProgress: { phase: 'querying', found: 0, resolved: 0 } });

      await client.listDrives(owner, {
        ...(force ? { force } : {}),
        onProgress: (progress) => {
          if (run === drivesRun) set({ drivesProgress: progress });
        },
        onEntities: (entities) => {
          if (run !== drivesRun) return;
          for (const entity of entities) {
            if (entity.entityType !== 'drive') continue;
            const existing = seen.get(entity.entityId);
            // Keep the newest revision of each drive.
            if (!existing || (entity.height ?? Infinity) >= (existing.height ?? Infinity)) {
              seen.set(entity.entityId, entity);
            }
          }
          set({
            drives: [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)),
          });
        },
      });
    },

    async loadDrive(driveId: string, owner: string, force = false) {
      const run = ++driveRun;
      driveAbort.aborted = true;
      const signal = { aborted: false };
      driveAbort = signal;
      set({
        activeDriveId: driveId,
        entities: [],
        tree: null,
        driveProgress: { phase: 'querying', found: 0, resolved: 0 },
      });

      // Threads through whatever this session already knows how to decrypt — undefined for a
      // still-locked (or public) drive, in which case syncDrive behaves exactly as it did in M1.
      const decrypt = usePrivateDrives.getState().getDecryptContext(driveId);

      await client.syncDrive(driveId, owner, {
        signal,
        ...(force ? { force } : {}),
        ...(decrypt ? { decrypt } : {}),
        onProgress: (progress) => {
          if (run === driveRun) set({ driveProgress: progress });
        },
        onEntities: (entities) => {
          if (run !== driveRun) return;
          set({ entities: [...get().entities, ...entities] });
          scheduleRebuild(run);
        },
      });

      if (run !== driveRun) return;
      if (rebuildTimer) {
        clearTimeout(rebuildTimer);
        rebuildTimer = null;
      }
      set({ tree: buildTree(get().entities) });
    },

    async pollPending(driveId: string, owner: string) {
      if (get().activeDriveId !== driveId) return;
      const decrypt = usePrivateDrives.getState().getDecryptContext(driveId);

      // syncDrive's first onEntities call is always the cached re-emit (already reflected in
      // state); only what arrives after that is genuinely new from this incremental network check.
      let sawCacheEmit = false;
      const fresh: ResolvedEntity[] = [];
      await client
        .syncDrive(driveId, owner, {
          ...(decrypt ? { decrypt } : {}),
          onEntities: (batch) => {
            if (!sawCacheEmit) {
              sawCacheEmit = true;
              return;
            }
            fresh.push(...batch);
          },
        })
        .catch(() => []);

      if (get().activeDriveId !== driveId || !fresh.length) return;
      const entities = [...get().entities, ...fresh];
      set({ entities, tree: buildTree(entities) });
    },

    async clearCache() {
      await cache.clear();
      set({ drives: [], entities: [], tree: null, drivesProgress: null, driveProgress: null });
    },

    applyLocalMutation(written: ResolvedEntity[]) {
      if (!written.length) return;
      // Best-effort: the entities are already reflected in this session's state regardless of
      // whether the cache write lands, so a failure here shouldn't block the UI update.
      void cache.putEntities(written);

      const state = get();

      const driveWrites = written.filter((e): e is DriveEntity => e.entityType === 'drive');
      let drives = state.drives;
      if (driveWrites.length) {
        const byId = new Map(drives.map((d) => [d.entityId, d]));
        for (const d of driveWrites) byId.set(d.entityId, d);
        drives = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      }

      const relevant = written.filter((e) => e.driveId === state.activeDriveId);
      const entities = relevant.length ? [...state.entities, ...relevant] : state.entities;
      const tree = relevant.length ? buildTree(entities) : state.tree;

      set({ drives, entities, tree });
    },

    reset() {
      driveRun++;
      drivesRun++;
      driveAbort.aborted = true;
      set({
        drives: [],
        drivesProgress: null,
        activeDriveId: null,
        entities: [],
        tree: null,
        driveProgress: null,
      });
    },
  };
});
