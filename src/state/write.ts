/**
 * Write-side app state.
 *
 * Two distinct shapes of "doing a write" live here:
 *
 *   - **The upload queue** (zustand, global): drag-and-drop can stage many files at once, each
 *     with its own progress and possible failure, and the queue should survive the user
 *     navigating around while it runs. That needs to be shared, persistent-within-session state.
 *   - **`useWriteAction`** (a plain hook): create-drive, create-folder, rename, move, hide are all
 *     one-shot — a dialog opens, does one write, closes. Giving each its own local state via a
 *     shared hook is simpler than routing everything through one queue, and keeps a stuck rename
 *     dialog from cluttering a persistent upload panel.
 *
 * Both funnel through the same cost-preview-then-confirm shape: per the house rule on financial
 * actions, nothing here spends without the user seeing the cost and clicking to proceed.
 */

import { t } from '../i18n/translate';
import { useCallback, useState } from 'react';
import { create } from 'zustand';
import { getTurboClient, SigningUnavailableError, type TurboClient } from '../turbo/client';
import {
  createFolder,
  createPrivateFolder,
  estimateCost,
  uploadNewFile,
  uploadNewPrivateFile,
  type UploadFileProgress,
} from '../turbo/upload';
import { newEntityId } from '../arfs/write/entities';
import { generateImageThumbnail } from '../arfs/write/thumbnail';
import { useWallet, type WalletState } from '../wallet/store';
import { useArfs } from './arfs';
import { usePrivateDrives } from './privateDrives';
import type { ResolvedEntity } from '../arfs/types';

/** `undefined` for a public (or not-currently-unlocked) drive — callers fall back to the public path. */
function decryptContextFor(driveId: string) {
  return usePrivateDrives.getState().getDecryptContext(driveId);
}

// ---------------------------------------------------------------------------
// Shared: acquiring a signable client with a consistent error shape
// ---------------------------------------------------------------------------

async function requireTurbo(wallet: Pick<WalletState, 'mode' | 'canSign' | 'jwk'>): Promise<TurboClient> {
  try {
    return await getTurboClient(wallet);
  } catch (err) {
    if (err instanceof SigningUnavailableError) throw err;
    throw new SigningUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Upload queue
// ---------------------------------------------------------------------------

export type UploadStatus = 'estimating' | 'ready' | 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: string;
  file: File;
  driveId: string;
  /** The folder the upload was started from — where a plain file (or a structure's top level) lands. */
  parentFolderId: string;
  /**
   * Directory portion of a folder upload's path (e.g. "Photos/2024" for a file at
   * "Photos/2024/pic.png"), empty for a plain file. Read straight from the browser's own
   * `webkitRelativePath` on a `webkitdirectory` file input — no manual path-walking needed.
   */
  relativePath: string;
  status: UploadStatus;
  costWinc?: string;
  error?: string;
  progress?: UploadFileProgress;
}

interface UploadQueueState {
  items: UploadItem[];
  /** Plain files (drag-and-drop, or a normal file picker) — land directly in `parentFolderId`. */
  stageFiles: (files: File[], driveId: string, parentFolderId: string) => void;
  /** A `webkitdirectory` FileList — its folder structure is recreated under `parentFolderId`. */
  stageFileList: (files: FileList, driveId: string, parentFolderId: string) => void;
  estimate: () => Promise<void>;
  confirmUpload: () => Promise<void>;
  remove: (id: string) => void;
  clearFinished: () => void;
}

let uploadIdCounter = 0;
const nextUploadId = () => `upload-${++uploadIdCounter}`;

/** Directory portion of a webkitRelativePath — everything but the last (file name) segment. */
function directoryOf(webkitRelativePath: string): string {
  const parts = webkitRelativePath.split('/');
  return parts.slice(0, -1).join('/');
}

export const useUploadQueue = create<UploadQueueState>((set, get) => ({
  items: [],

  stageFiles(files, driveId, parentFolderId) {
    const staged: UploadItem[] = files.map((file) => ({
      id: nextUploadId(),
      file,
      driveId,
      parentFolderId,
      relativePath: '',
      status: 'estimating',
    }));
    set({ items: [...get().items, ...staged] });
    void get().estimate();
  },

  stageFileList(fileList, driveId, parentFolderId) {
    const staged: UploadItem[] = Array.from(fileList).map((file) => ({
      id: nextUploadId(),
      file,
      driveId,
      parentFolderId,
      relativePath: directoryOf(file.webkitRelativePath || file.name),
      status: 'estimating',
    }));
    set({ items: [...get().items, ...staged] });
    void get().estimate();
  },

  async estimate() {
    const pending = get().items.filter((i) => i.status === 'estimating');
    if (!pending.length) return;

    const wallet = useWallet.getState();
    let turbo: TurboClient;
    try {
      turbo = await requireTurbo(wallet);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        items: get().items.map((i) => (i.status === 'estimating' ? { ...i, status: 'error', error: message } : i)),
      });
      return;
    }

    // One batched call rather than one per file — Turbo's getUploadCosts already accepts a list.
    // Private items add the 16-byte GCM auth-tag overhead so the estimate matches what actually
    // gets uploaded (Turbo's real byte-counting at upload time is still authoritative either way).
    const costs = await turbo
      .getUploadCosts({
        bytes: pending.map((i) => Math.max(1, i.file.size + (decryptContextFor(i.driveId) ? 16 : 0))),
      })
      .catch(() => null);

    set({
      items: get().items.map((i) => {
        const idx = pending.findIndex((p) => p.id === i.id);
        if (idx === -1) return i;
        const cost = costs?.[idx];
        return cost
          ? { ...i, status: 'ready', costWinc: cost.winc }
          : { ...i, status: 'error', error: t('error.estimateFailed') };
      }),
    });
  },

  async confirmUpload() {
    const ready = get().items.filter((i) => i.status === 'ready');
    if (!ready.length) return;

    const wallet = useWallet.getState();
    let turbo: TurboClient;
    try {
      turbo = await requireTurbo(wallet);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ items: get().items.map((i) => (i.status === 'ready' ? { ...i, status: 'error', error: message } : i)) });
      return;
    }

    // "path so far" -> its Folder-Id, so a folder shared by many files (or nested paths) is only
    // created once per confirm run, parent-first.
    const pathFolderIds = new Map<string, string>();

    /** Ensure every folder in `relativePath` exists, creating any that don't, and return the leaf. */
    const resolveParent = async (item: UploadItem): Promise<string> => {
      if (!item.relativePath) return item.parentFolderId;

      const decryptCtx = decryptContextFor(item.driveId);
      const segments = item.relativePath.split('/');
      let parentId = item.parentFolderId;
      let pathSoFar = '';

      for (const segment of segments) {
        pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment;
        const key = `${item.driveId}:${pathSoFar}`;
        const existing = pathFolderIds.get(key);
        if (existing) {
          parentId = existing;
          continue;
        }
        const folder = decryptCtx
          ? await createPrivateFolder({
              turbo,
              driveId: item.driveId,
              parentFolderId: parentId,
              name: segment,
              owner: wallet.address ?? '',
              driveKey: decryptCtx.driveKey,
            })
          : await createFolder({
              turbo,
              driveId: item.driveId,
              parentFolderId: parentId,
              name: segment,
              owner: wallet.address ?? '',
            });
        useArfs.getState().applyLocalMutation([folder]);
        pathFolderIds.set(key, folder.entityId);
        parentId = folder.entityId;
      }
      return parentId;
    };

    for (const item of ready) {
      set({ items: get().items.map((i) => (i.id === item.id ? { ...i, status: 'uploading' } : i)) });
      try {
        const parentFolderId = await resolveParent(item);
        const decryptCtx = decryptContextFor(item.driveId);
        const onProgress = (progress: UploadFileProgress) => {
          set({ items: get().items.map((i) => (i.id === item.id ? { ...i, progress } : i)) });
        };
        // A bad/unusual image should never block the real upload — generateImageThumbnail already
        // resolves to null instead of throwing, but the catch here is belt-and-suspenders against
        // anything unexpected in this async step specifically.
        const thumbnail = item.file.type.startsWith('image/')
          ? ((await generateImageThumbnail(item.file).catch(() => null)) ?? undefined)
          : undefined;
        const entity: ResolvedEntity = decryptCtx
          ? await (async () => {
              const fileId = newEntityId();
              const fileKey = await decryptCtx.getFileKey(fileId);
              return uploadNewPrivateFile({
                turbo,
                driveId: item.driveId,
                parentFolderId,
                file: item.file,
                owner: wallet.address ?? '',
                fileId,
                fileKey,
                thumbnail,
                onProgress,
              });
            })()
          : await uploadNewFile({
              turbo,
              driveId: item.driveId,
              parentFolderId,
              file: item.file,
              owner: wallet.address ?? '',
              thumbnail,
              onProgress,
            });
        useArfs.getState().applyLocalMutation([entity]);
        set({ items: get().items.map((i) => (i.id === item.id ? { ...i, status: 'done' } : i)) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ items: get().items.map((i) => (i.id === item.id ? { ...i, status: 'error', error: message } : i)) });
      }
    }
  },

  remove(id) {
    set({ items: get().items.filter((i) => i.id !== id) });
  },

  clearFinished() {
    set({ items: get().items.filter((i) => i.status !== 'done') });
  },
}));

// ---------------------------------------------------------------------------
// One-shot write actions (create drive/folder, rename, move, hide)
// ---------------------------------------------------------------------------

export type WriteActionStatus = 'idle' | 'estimating' | 'ready' | 'running' | 'error';

export interface WriteActionState<T extends ResolvedEntity | ResolvedEntity[]> {
  status: WriteActionStatus;
  costWinc: string | null;
  error: string | null;
  /**
   * Estimate the byte size of what's about to be written (a metadata JSON body is typically a few
   * hundred bytes) and show its cost before anything is signed.
   */
  prepare: (estimatedBytes: number) => Promise<void>;
  /** Perform the write. Only meaningful after `prepare` has reached 'ready'. */
  run: (perform: (turbo: TurboClient) => Promise<T>) => Promise<T | undefined>;
  reset: () => void;
}

/**
 * Shared logic behind every create/rename/move/hide dialog: estimate cost, wait for confirmation,
 * execute, and splice the result into app state — all with one consistent error shape.
 */
export function useWriteAction<T extends ResolvedEntity | ResolvedEntity[]>(): WriteActionState<T> {
  const [status, setStatus] = useState<WriteActionStatus>('idle');
  const [costWinc, setCostWinc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const prepare = useCallback(async (estimatedBytes: number) => {
    setStatus('estimating');
    setError(null);
    try {
      const turbo = await requireTurbo(useWallet.getState());
      const cost = await estimateCost(turbo, estimatedBytes);
      setCostWinc(cost.winc);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const run = useCallback(async (perform: (turbo: TurboClient) => Promise<T>) => {
    setStatus('running');
    setError(null);
    try {
      const turbo = await requireTurbo(useWallet.getState());
      const result = await perform(turbo);
      const written = Array.isArray(result) ? result : [result];
      useArfs.getState().applyLocalMutation(written as ResolvedEntity[]);
      setStatus('idle');
      return result;
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setCostWinc(null);
    setError(null);
  }, []);

  return { status, costWinc, error, prepare, run, reset };
}
