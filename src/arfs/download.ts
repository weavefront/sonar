/**
 * Batch download — bundling several selected files, or whole folders, into a single ZIP.
 *
 * Speed comes from three things working together: `client-zip`'s `downloadZip()` streams its
 * output lazily as it's read rather than buffering the archive (so a huge batch doesn't blow the
 * tab's memory the way JSZip does), `streamPool` (`./pool.ts`) keeps a bounded number of file
 * fetches in flight so later files are already downloading while earlier ones are being written
 * into the zip, and files are stored rather than deflated (the default) — most of what a media
 * drive holds is already-compressed images/video, so spending CPU to "compress" it again would
 * only slow things down for no size benefit.
 */

import { downloadZip } from 'client-zip';
import { fetchAndDecryptFileData } from './crypto/fileData';
import { RESILIENT_DATA_GATEWAYS } from './gql';
import type { DecryptContext } from './metadata';
import { fetchBinaryBody, MAX_CONCURRENCY } from './metadata';
import { streamPool } from './pool';
import type { AbortToken } from './sync';
import type { DriveTree } from './tree';
import type { FileEntity, FolderEntity } from './types';

/** What the caller has checked — a plain, non-React shape so this module stays UI-free. */
export type SelectionItem = { kind: 'file'; file: FileEntity } | { kind: 'folder'; folder: FolderEntity };

export interface DownloadItem {
  file: FileEntity;
  /** Slash-separated path inside the zip, already de-duplicated against every other entry. */
  zipPath: string;
}

/**
 * `fetchBinaryBody`'s own `bodyGate` (an `AdaptiveGate`, shared process-wide) is what actually
 * throttles real request concurrency against the gateway — this pool just needs to stay at or
 * above its ceiling so it's never the artificial bottleneck. Same "wider than the gate, on
 * purpose" reasoning `metadata.ts`'s `fetchBinaryBodies` already uses for the same kind of
 * concurrent-binary-fetch pool; a hardcoded lower number here would just leave adaptive-gate
 * capacity unused whenever the gateway is healthy.
 */
const CONCURRENCY = MAX_CONCURRENCY;

/**
 * Upper bound on file bytes held in memory at once — files being fetched plus fetched files the
 * zip writer hasn't consumed yet. The count limit above alone isn't a memory bound: 32 concurrent
 * *whole files* is fine for photos but would be 32GB for a folder of 1GB videos. With a byte budget,
 * a folder of small photos still downloads highly in parallel while large videos go through a few
 * (or one) at a time. A single file larger than this still downloads — alone.
 */
const MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;

/**
 * Makes one path segment safe to put in a zip entry name. Two jobs:
 *
 * 1. Characters most filesystems reject (`/\:*?"<>|`) and control characters become `_`.
 * 2. **`.` and `..` become `_`** — a security fix, not cosmetics. Names come straight from on-chain
 *    ArFS metadata, which whoever owns a drive fully controls, and the read-only share view lets
 *    anyone batch-download *someone else's* public drive. A shared drive with folders named `..`
 *    used to yield a zip entry like `../../.bashrc` (confirmed), the classic "Zip Slip" path: a
 *    careless extractor writes that outside the folder the user chose. Mainstream extractors
 *    refuse `..`, but plenty of scripts and libraries don't, so the archive must never contain it.
 */
function safeSegment(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[/\\:*?"<>|\x00-\x1f\x7f]/g, '_').trim();
  if (!cleaned || cleaned === '.' || cleaned === '..') return '_';
  return cleaned;
}

/**
 * Resolves a name collision by numbering, matching Explorer/Finder convention: `photo.jpg` ->
 * `photo (2).jpg`. ArFS doesn't enforce unique names within a folder, and a flat multi-select can
 * independently collide the same way, so every path — folder-recursed or not — runs through this
 * same shared `used` set.
 */
function dedupe(path: string, used: Set<string>): string {
  if (!used.has(path)) {
    used.add(path);
    return path;
  }
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const splitAt = dot > slash ? dot : path.length;
  const base = path.slice(0, splitAt);
  const ext = path.slice(splitAt);
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) candidate = `${base} (${++n})${ext}`;
  used.add(candidate);
  return candidate;
}

function collectFolder(tree: DriveTree, folder: FolderEntity, prefix: string, out: DownloadItem[], used: Set<string>) {
  for (const file of tree.childFiles.get(folder.entityId) ?? []) {
    if (!file.dataTxId) continue; // still confirming, or a body that never resolved — nothing to fetch
    out.push({ file, zipPath: dedupe(`${prefix}${safeSegment(file.name)}`, used) });
  }
  for (const child of tree.childFolders.get(folder.entityId) ?? []) {
    collectFolder(tree, child, `${prefix}${safeSegment(child.name)}/`, out, used);
  }
}

/**
 * Expands a selection into the flat file list a zip needs. A directly-checked file gets a flat
 * path; a checked folder recurses into `folderName/.../fileName`. Pure tree traversal — no network
 * calls, since the whole hierarchy is already synced client-side.
 */
export function filesUnderSelection(items: readonly SelectionItem[], tree: DriveTree): DownloadItem[] {
  const out: DownloadItem[] = [];
  const used = new Set<string>();
  for (const item of items) {
    if (item.kind === 'file') {
      if (!item.file.dataTxId) continue;
      out.push({ file: item.file, zipPath: dedupe(safeSegment(item.file.name), used) });
    } else {
      collectFolder(tree, item.folder, `${safeSegment(item.folder.name)}/`, out, used);
    }
  }
  return out;
}

export interface DownloadProgress {
  completedFiles: number;
  totalFiles: number;
  completedBytes: number;
}

/**
 * Builds the zip's `Response` and starts the underlying fetches immediately.
 *
 * `failed` is a shared array, not a resolved value: `downloadZip()`'s stream is only *fully*
 * generated once something actually reads `response.body` to the end (i.e. once
 * `saveZipStream()`'s caller awaits it), and only at that point has every item either succeeded or
 * been recorded as failed. That ordering is exactly what makes reading `failed` after `await
 * saveZipStream(...)` safe, and reading it any earlier wrong.
 *
 * A failed individual file (bad decrypt, gateway exhausted) is recorded and skipped, not fatal to
 * the batch — the same "don't let one bad entity take down the whole operation" rule `sync.ts`
 * already applies to unresolved entities. Cancellation (`signal`) is cooperative, matching this
 * app's existing convention (`sync.ts`'s `AbortToken`): it stops new fetches from being queued and
 * ends the zip early with whatever finished, rather than hard-aborting in-flight requests.
 */
export function downloadAsZip(
  items: readonly DownloadItem[],
  opts: { decrypt?: DecryptContext; onProgress?: (progress: DownloadProgress) => void; signal?: AbortToken } = {},
): { response: Response; failed: string[] } {
  const failed: string[] = [];
  let completedFiles = 0;
  let completedBytes = 0;

  async function fetchOne(item: DownloadItem): Promise<{ name: string; input: Uint8Array | Blob }> {
    try {
      const input = opts.decrypt
        ? await fetchAndDecryptFileData(item.file, await opts.decrypt.getFileKey(item.file.entityId))
        : await fetchBinaryBody(item.file.dataTxId, { gateways: RESILIENT_DATA_GATEWAYS });
      completedBytes += item.file.size;
      return { name: item.zipPath, input };
    } catch {
      failed.push(item.zipPath);
      throw new Error('skip'); // caught by streamPool, which excludes this item from the zip
    } finally {
      completedFiles++;
      opts.onProgress?.({ completedFiles, totalFiles: items.length, completedBytes });
    }
  }

  async function* entries() {
    const pool = streamPool(items, CONCURRENCY, fetchOne, {
      weight: (item) => item.file.size,
      budget: MEMORY_BUDGET_BYTES,
    });
    for await (const entry of pool) {
      // Throw, don't `return`: returning ends the generator *normally*, so client-zip finalizes a
      // perfectly valid archive of whatever finished so far — and `saveZipStream` then saves it
      // (or, on the Blob path, pops a download) right after the user pressed Cancel. Throwing
      // errors the zip stream instead, so the File System Access writable is aborted (partial file
      // discarded) and the Blob path rejects before it ever triggers a download.
      if (opts.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
      yield entry;
    }
    // The pool can also finish (every remaining item failed) with Cancel already pressed.
    if (opts.signal?.aborted) throw new DOMException('Download cancelled', 'AbortError');
  }

  return { response: downloadZip(entries()), failed };
}

/**
 * Saves a zip `Response` to disk. Chromium streams straight through to a file handle with no
 * memory ceiling; Firefox/Safari don't implement `showSaveFilePicker` at all (confirmed — no
 * workaround exists), so they fall back to buffering the full archive as a `Blob` and triggering
 * the same `<a download>` sequence `Details.tsx` already uses for single-file downloads.
 */
export async function saveZipStream(response: Response, suggestedName: string): Promise<void> {
  if (window.showSaveFilePicker && response.body) {
    let handle: FileSystemFileHandle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'ZIP archive', accept: { 'application/zip': ['.zip'] } }],
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return; // user closed the save dialog
      throw err;
    }
    const writable = await handle.createWritable();
    await response.body.pipeTo(writable);
    return;
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(blobUrl);
}
