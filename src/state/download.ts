/**
 * Batch-download job state — one at a time, mirroring `write.ts`'s upload queue shape but simpler:
 * a batch download is a single sequential operation from the user's point of view (collect the
 * file list, fetch+zip, save), so there's nothing here that benefits from a multi-item queue the
 * way drag-and-drop uploads do.
 */

import { create } from 'zustand';
import { downloadAsZip, filesUnderSelection, saveZipStream, type SelectionItem } from '../arfs/download';
import type { AbortToken } from '../arfs/sync';
import type { DriveTree } from '../arfs/tree';
import { usePrivateDrives } from './privateDrives';

export type DownloadStatus = 'collecting' | 'fetching' | 'saving' | 'done' | 'error';

export interface DownloadJob {
  status: DownloadStatus;
  totalFiles: number;
  completedFiles: number;
  totalBytes: number;
  completedBytes: number;
  failed: string[];
  error?: string;
}

interface DownloadQueueState {
  job: DownloadJob | null;
  start: (items: readonly SelectionItem[], tree: DriveTree, driveId: string, zipName: string) => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
}

/** The in-flight job's cancellation token — cooperative, matching `sync.ts`'s `AbortToken`. */
let activeSignal: AbortToken | null = null;

const ACTIVE_STATUSES: readonly DownloadStatus[] = ['collecting', 'fetching', 'saving'];

export const useDownloadQueue = create<DownloadQueueState>((set, get) => ({
  job: null,

  async start(items, tree, driveId, zipName) {
    const current = get().job;
    if (current && ACTIVE_STATUSES.includes(current.status)) return; // one job at a time

    const signal: AbortToken = { aborted: false };
    activeSignal = signal;

    const resolved = filesUnderSelection(items, tree);
    const totalBytes = resolved.reduce((sum, item) => sum + item.file.size, 0);
    set({
      job: {
        status: 'fetching',
        totalFiles: resolved.length,
        completedFiles: 0,
        totalBytes,
        completedBytes: 0,
        failed: [],
      },
    });

    if (!resolved.length) {
      set({ job: { ...get().job!, status: 'done' } });
      return;
    }

    try {
      const decrypt = usePrivateDrives.getState().getDecryptContext(driveId);
      const { response, failed } = downloadAsZip(resolved, {
        decrypt,
        signal,
        onProgress: (progress) => {
          if (signal.aborted) return;
          set({
            job: {
              ...get().job!,
              completedFiles: progress.completedFiles,
              completedBytes: progress.completedBytes,
              // Stay in 'fetching' (which shows "Downloading N of M files") until every file is in,
              // then 'saving' for the final flush. This used to flip to 'saving' before a single
              // byte was fetched — the zip is generated lazily as `saveZipStream` reads it, so all
              // the fetching actually happens *during* the save — which meant the per-file progress
              // text never appeared at all; the panel just said "Saving…" the whole time.
              status: progress.completedFiles >= progress.totalFiles ? 'saving' : 'fetching',
            },
          });
        },
      });
      if (signal.aborted) return;

      await saveZipStream(response, `${zipName}.zip`);
      if (signal.aborted) return;
      set({ job: { ...get().job!, status: 'done', failed } });
    } catch (err) {
      if (signal.aborted) return;
      set({ job: { ...get().job!, status: 'error', error: err instanceof Error ? err.message : String(err) } });
    }
  },

  cancel() {
    if (activeSignal) activeSignal.aborted = true;
    set({ job: null });
  },

  dismiss() {
    set({ job: null });
  },
}));
