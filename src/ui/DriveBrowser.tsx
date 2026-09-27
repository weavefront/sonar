import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useT, type MessageKey } from '../i18n';
import { useArfs } from '../state/arfs';
import { usePrivateDrives } from '../state/privateDrives';
import { useDownloadQueue } from '../state/download';
import type { SelectionItem } from '../arfs/download';
import { useWallet } from '../wallet/store';
import { filePath, folderStats, pathTo } from '../arfs/tree';
import type { DriveTree } from '../arfs/tree';
import type { FileEntity, FolderEntity } from '../arfs/types';
import { fileKind, formatBytes, formatRelative, KIND_ICONS } from './format';
import {
  ArrowUpIcon,
  ChevronRight,
  DenseViewIcon,
  DownloadIcon,
  FolderIcon,
  IconViewIcon,
  LinkIcon,
  ListViewIcon,
  RefreshIcon,
  SearchIcon,
} from './icons';
import { Details } from './Details';
import { Lightbox } from './Lightbox';
import { RowThumbnail } from './Thumbnail';
import { UploadDropzone } from './UploadDropzone';
import { CreateFolderDialog } from './CreateFolderDialog';
import { RenameDialog } from './RenameDialog';
import { MoveDialog } from './MoveDialog';
import { HideDialog } from './HideDialog';
import { ShareDialog } from './ShareDialog';
import { RowMenu, type RowAction } from './RowMenu';
import { TILE_PX, useViewPreference, type TileSize, type ViewMode } from './viewPreference';

type EntryRef = { kind: 'file'; file: FileEntity } | { kind: 'folder'; folder: FolderEntity };
type DialogState = { type: 'create-folder' } | { type: RowAction; entry: EntryRef } | null;

export type Entry =
  | { kind: 'folder'; id: string; name: string; folder: FolderEntity }
  | { kind: 'file'; id: string; name: string; file: FileEntity; path?: string };

type SortKey = 'name' | 'size' | 'modified';

const ROW_HEIGHT = 56;
const DENSE_ROW_HEIGHT = 32;
// Explicit breathing room between virtualized rows — rows would otherwise sit exactly
// `ROW_HEIGHT` apart with nothing guaranteeing visible space between them beyond the row icon's
// own internal centering, which reads as crowded once real (visually busy) thumbnails replace the
// plain icon glyphs.
const ROW_GAP = 6;
const ICON_GAP = 16;
const ICON_GUTTER = 16;
const ICON_LABEL_HEIGHT = 34;

function sortEntries(entries: Entry[], key: SortKey, desc: boolean): Entry[] {
  const dir = desc ? -1 : 1;
  return [...entries].sort((a, b) => {
    // Folders always lead within a folder view, regardless of sort column.
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    if (key === 'name') return dir * a.name.localeCompare(b.name, undefined, { numeric: true });
    if (key === 'size') {
      const as = a.kind === 'file' ? a.file.size : -1;
      const bs = b.kind === 'file' ? b.file.size : -1;
      return dir * (as - bs);
    }
    const am = a.kind === 'file' ? a.file.lastModifiedDate : a.folder.unixTime * 1000;
    const bm = b.kind === 'file' ? b.file.lastModifiedDate : b.folder.unixTime * 1000;
    return dir * (am - bm);
  });
}

/**
 * Entries for the current view. With a search query this searches the *whole* drive rather than
 * the current folder — everything is already resolved locally, so there's no reason to make the
 * user navigate to find something.
 */
function useEntries(
  tree: DriveTree | null,
  folderId: string,
  query: string,
  sort: SortKey,
  desc: boolean,
  showHidden: boolean,
): Entry[] {
  return useMemo(() => {
    if (!tree) return [];
    const needle = query.trim().toLowerCase();

    if (needle) {
      const matches: Entry[] = [];
      for (const folder of tree.foldersById.values()) {
        if (folder.entityId === tree.rootFolderId) continue;
        if ((showHidden || !folder.isHidden) && folder.name.toLowerCase().includes(needle)) {
          matches.push({ kind: 'folder', id: folder.entityId, name: folder.name, folder });
        }
      }
      for (const file of tree.filesById.values()) {
        if ((showHidden || !file.isHidden) && file.name.toLowerCase().includes(needle)) {
          matches.push({ kind: 'file', id: file.entityId, name: file.name, file, path: filePath(tree, file) });
        }
      }
      return sortEntries(matches, sort, desc).slice(0, 1000);
    }

    const entries: Entry[] = [];
    for (const folder of tree.childFolders.get(folderId) ?? []) {
      if (showHidden || !folder.isHidden) {
        entries.push({ kind: 'folder', id: folder.entityId, name: folder.name, folder });
      }
    }
    for (const file of tree.childFiles.get(folderId) ?? []) {
      if (showHidden || !file.isHidden) {
        entries.push({ kind: 'file', id: file.entityId, name: file.name, file });
      }
    }
    return sortEntries(entries, sort, desc);
  }, [tree, folderId, query, sort, desc, showHidden]);
}

export function DriveBrowser({
  driveId,
  folderId,
  owner,
  rootFolderId,
  readOnly = false,
  subfoldersHidden = false,
}: {
  driveId: string;
  folderId?: string;
  /** Overrides the connected wallet's address — a shared-folder link has no wallet at all, so its
      owner has to come from the URL instead. See `ShareRoute.tsx`. */
  owner?: string;
  /** Navigation floor for a shared link: breadcrumbs/the "up" button never go above this folder. */
  rootFolderId?: string;
  /** Forces every write affordance off, unconditionally — see the `canWrite` comment below. */
  readOnly?: boolean;
  /** Share scope "just this folder": hides every folder entry so there's no way to descend further. */
  subfoldersHidden?: boolean;
}) {
  const { t, tPlural } = useT();
  const walletAddress = useWallet((s) => s.address);
  const address = owner ?? walletAddress!;
  const { tree, driveProgress, loadDrive, pollPending, activeDriveId } = useArfs();
  const [, navigate] = useLocation();
  const downloadJob = useDownloadQueue((s) => s.job);
  const startDownload = useDownloadQueue((s) => s.start);
  const downloadActive = downloadJob !== null && downloadJob.status !== 'done' && downloadJob.status !== 'error';

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [desc, setDesc] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const { viewMode, setViewMode, tileSize, setTileSize } = useViewPreference();
  const [selected, setSelected] = useState<Entry | null>(null);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [lightboxFile, setLightboxFile] = useState<FileEntity | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [sharing, setSharing] = useState(false);
  const canSign = useWallet((s) => s.canSign);
  const unlockedForWrite = usePrivateDrives((s) => (tree?.drive?.entityId ? s.unlocked.has(tree.drive.entityId) : false));
  // A private drive can only be unlocked by a session that can already sign (`privateDrives.unlock`
  // refuses otherwise), so "unlocked" already implies signing is available — writes into it go
  // through the encrypted turbo/upload.ts functions (M4), same confirm-then-spend shape as public.
  // `!readOnly` is first and unconditional: a shared-link *visitor* may well have their own,
  // separate wallet connected (`canSign` genuinely true for them), but they're looking at someone
  // else's drive — without this override they'd see write UI that would just sign with their own
  // key, fail the drive's `owners:[owner]` anti-spoof filter on sync, and burn their own Turbo
  // balance on a transaction the real owner never sees.
  const canWrite = !readOnly && canSign && (tree?.drive?.privacy !== 'private' || unlockedForWrite);

  useEffect(() => {
    if (activeDriveId !== driveId) void loadDrive(driveId, address);
  }, [driveId, address, loadDrive, activeDriveId]);

  // A freshly-uploaded file/folder shows as "Processing" (height: null) until a real sync sees it
  // mined. Rather than make the user click Resync to find out, poll quietly in the background
  // while anything in the drive is still pending, and stop as soon as nothing is.
  const hasPending =
    tree != null &&
    (tree.drive?.height === null ||
      [...tree.foldersById.values()].some((f) => f.height === null) ||
      [...tree.filesById.values()].some((f) => f.height === null));

  useEffect(() => {
    if (!hasPending) return;
    const interval = setInterval(() => {
      void pollPending(driveId, address);
    }, 15_000);
    return () => clearInterval(interval);
  }, [hasPending, driveId, address, pollPending]);

  // Deferred, not the raw keystroke value: on a large drive, a search re-scans and re-sorts every
  // folder and file in memory (see useEntries), which is real work at thousands of entries. Typing
  // stays instant either way (the input below is bound to `query`, not this), but React can now
  // let the expensive re-render lag a keystroke behind instead of blocking every keypress on it.
  const deferredQuery = useDeferredValue(query);
  const currentFolderId = folderId || tree?.rootFolderId || '';
  const rawEntries = useEntries(tree, currentFolderId, readOnly ? '' : deferredQuery, sort, desc, readOnly ? false : showHidden);
  const entries = subfoldersHidden ? rawEntries.filter((e) => e.kind !== 'folder') : rawEntries;
  const trueTrail = useMemo(() => (tree ? pathTo(tree, currentFolderId) : []), [tree, currentFolderId]);
  // `rootFolderId` (a share link's floor) may not be resolved into the trail yet mid-sync, or —
  // for a hand-edited URL — may genuinely not be an ancestor of `currentFolderId` at all. Either
  // way `floorIndex === -1`; only treat it as a real error once the drive has finished syncing.
  const floorIndex = rootFolderId ? trueTrail.findIndex((f) => f.entityId === rootFolderId) : 0;
  const floorFolderId = rootFolderId ?? tree?.rootFolderId ?? '';
  const trail = rootFolderId && floorIndex >= 0 ? trueTrail.slice(floorIndex) : trueTrail;

  // Batch-selection is orthogonal to `selected` (which only drives the Details panel) — cleared
  // whenever the listed entries themselves change, same trigger the scroll-reset effect below uses
  // for folder/query, but deliberately not for a view-mode toggle: switching between List/Icon/Dense
  // while a selection is in progress shouldn't lose it.
  useEffect(() => {
    setCheckedIds(new Set());
  }, [currentFolderId, deferredQuery]);

  const isCheckable = (entry: Entry) => (entry.kind === 'folder' ? entry.folder : entry.file).unresolved !== true;
  const checkableEntries = useMemo(() => entries.filter(isCheckable), [entries]);
  const allChecked = checkableEntries.length > 0 && checkableEntries.every((e) => checkedIds.has(e.kind + e.id));

  const toggleChecked = (entry: Entry) => {
    const key = entry.kind + entry.id;
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setCheckedIds(allChecked ? new Set() : new Set(checkableEntries.map((e) => e.kind + e.id)));
  };

  const downloadEntries = (list: readonly Entry[]) => {
    if (!tree || downloadActive) return false;
    const items: SelectionItem[] = list.map((e) =>
      e.kind === 'file' ? { kind: 'file' as const, file: e.file } : { kind: 'folder' as const, folder: e.folder },
    );
    if (!items.length) return false;
    const zipName = trail[trail.length - 1]?.name ?? tree.drive?.name ?? t('driveBrowser.drive');
    void startDownload(items, tree, driveId, zipName, { includeHidden: !readOnly });
    return true;
  };

  const downloadSelected = () => {
    if (downloadEntries(entries.filter((e) => checkedIds.has(e.kind + e.id)))) setCheckedIds(new Set());
  };

  // A share visitor's one-click "everything here". `checkableEntries` is already scoped the way
  // the page is: without subfolders for a `?scope=folder` link, and without hidden or unresolved
  // items, so the zip holds exactly what the visitor can see (recursing into folders if shown).
  const downloadAll = () => downloadEntries(checkableEntries);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (viewMode === 'dense' ? DENSE_ROW_HEIGHT : ROW_HEIGHT),
    // The virtualizer's own `gap` — not baked into `estimateSize` and subtracted back out at
    // render time. That first approach measured correctly on a fresh mount but went stale on a
    // later dense<->list toggle: this library caches each row's *size* per index and only calls
    // `estimateSize` again for indices it hasn't already cached, so a later change to the formula
    // silently had no effect on already-rendered rows. `gap` is tracked as its own dependency
    // internally, so changing it actually invalidates and repositions rows — dense view's whole
    // point is rows nearly touching, so it gets none of this.
    gap: viewMode === 'dense' ? 0 : ROW_GAP,
    overscan: 12,
  });

  // Reset scroll when the folder or query changes, or when switching view (row/tile sizes differ
  // enough between modes that carrying over a pixel scroll offset would land somewhere odd).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [currentFolderId, deferredQuery, viewMode, tileSize]);

  const syncing = driveProgress !== null && !['done', 'error'].includes(driveProgress.phase);
  const parentId = trail.length > 1 ? trail[trail.length - 2]!.entityId : null;
  const floorValid = !rootFolderId || floorIndex >= 0;
  const privacyBlocked = readOnly && tree?.drive?.privacy === 'private';

  // In share mode, in-app navigation (folder clicks, breadcrumbs, "up") has to stay on
  // `/share/...` URLs — with the scope preserved — rather than the normal `/d/...` ones, or the
  // visitor would land on a route that requires a connected wallet. `id ?? floorFolderId` is what
  // keeps the leftmost breadcrumb ("driveName") from escaping the shared folder: `Breadcrumbs`
  // calls `onNavigate(null)` for that crumb, same as it does for the real drive root normally.
  const buildPath = (id: string | null) =>
    readOnly
      ? `/share/${driveId}/${address}/${id ?? floorFolderId}${subfoldersHidden ? '?scope=folder' : ''}`
      : id
        ? `/d/${driveId}/${id}`
        : `/d/${driveId}`;

  const open = (entry: Entry) => {
    if (entry.kind === 'folder') {
      setQuery('');
      setSelected(null);
      navigate(buildPath(entry.folder.entityId));
    } else {
      setSelected(entry);
    }
  };

  const onRowAction = (entry: Entry, action: RowAction) => {
    const ref: EntryRef = entry.kind === 'file' ? { kind: 'file', file: entry.file } : { kind: 'folder', folder: entry.folder };
    setDialog({ type: action, entry: ref });
  };

  if (privacyBlocked) {
    return <main className="flex-1 p-8 text-center text-dim">{t('driveBrowser.privateCantShare')}</main>;
  }
  if (!floorValid && !syncing) {
    return <main className="flex-1 p-8 text-center text-dim">{t('driveBrowser.notPartOfShare')}</main>;
  }

  return (
    <div className="flex-1 flex min-h-0">
      <UploadDropzoneOrPlain canWrite={canWrite} driveId={driveId} parentFolderId={currentFolderId} onNewFolder={() => setDialog({ type: 'create-folder' })}>
        {/* Toolbar */}
        <div className="surface border-b border-app px-3 sm:px-5 py-2.5 space-y-2.5">
          <div className="flex items-center gap-2">
            {parentId !== null && (
              <button
                onClick={() => navigate(buildPath(parentId))}
                aria-label={t('driveBrowser.goToParent')}
                className="grid place-items-center w-9 h-9 rounded-lg border border-app surface-2 shrink-0 hover:opacity-80 transition-opacity"
              >
                <ArrowUpIcon className="w-4 h-4" />
              </button>
            )}
            <Breadcrumbs
              driveName={
                rootFolderId
                  ? (trail[0]?.name ?? t('driveBrowser.sharedFolder'))
                  : (tree?.drive?.name ?? t('driveBrowser.drive'))
              }
              trail={trail}
              driveId={driveId}
              rootFolderId={floorFolderId}
              onNavigate={(id) => {
                setQuery('');
                setSelected(null);
                navigate(buildPath(id));
              }}
            />
            <div className="flex-1" />
            {readOnly && checkedIds.size === 0 && (
              <button
                onClick={downloadAll}
                // Disabled mid-sync: the tree may not hold every file yet, and a zip that silently
                // misses some is worse than a few seconds' wait.
                disabled={downloadActive || syncing || !checkableEntries.length}
                title={syncing ? t('download.waitForLoad') : undefined}
                className="flex items-center gap-2 h-9 px-4 rounded-lg accent-fill text-sm font-semibold shrink-0 disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                <DownloadIcon className="w-4 h-4" />
                {t('download.downloadAll')}
              </button>
            )}
            {checkedIds.size > 0 && (
              <button
                onClick={downloadSelected}
                disabled={downloadActive}
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg accent-fill text-xs font-medium shrink-0 disabled:opacity-50 hover:opacity-90 transition-opacity"
              >
                <DownloadIcon className="w-4 h-4" />
                {tPlural('confirmDownload', checkedIds.size)}
              </button>
            )}
            {!readOnly && tree?.drive?.privacy !== 'private' && (
              <button
                onClick={() => setSharing(true)}
                aria-label={t('driveBrowser.shareFolder')}
                title={t('driveBrowser.shareFolder')}
                className="grid place-items-center w-9 h-9 rounded-lg border border-app surface-2 shrink-0 hover:opacity-80 transition-opacity"
              >
                <LinkIcon className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => void loadDrive(driveId, address, true)}
              aria-label={t('driveBrowser.resync')}
              title={t('driveBrowser.resyncTitle')}
              className="grid place-items-center w-9 h-9 rounded-lg border border-app surface-2 shrink-0 hover:opacity-80 transition-opacity"
            >
              <RefreshIcon className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {!readOnly && (
              <div className="relative flex-1 min-w-0">
                <SearchIcon className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('driveBrowser.search')}
                  aria-label={t('driveBrowser.search')}
                  spellCheck={false}
                  className="w-full min-h-10 pl-9 pr-3 rounded-lg border border-app surface-2 text-sm"
                />
              </div>
            )}
            <select
              aria-label={t('driveBrowser.sortBy')}
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="min-h-10 px-2 rounded-lg border border-app surface-2 text-sm shrink-0"
            >
              <option value="name">{t('driveBrowser.sortName')}</option>
              <option value="size">{t('driveBrowser.sortSize')}</option>
              <option value="modified">{t('driveBrowser.sortModified')}</option>
            </select>
            <button
              onClick={() => setDesc((d) => !d)}
              aria-label={desc ? t('driveBrowser.sortAscending') : t('driveBrowser.sortDescending')}
              className="grid place-items-center w-10 h-10 rounded-lg border border-app surface-2 shrink-0 text-sm hover:opacity-80 transition-opacity"
            >
              {desc ? '↓' : '↑'}
            </button>
          </div>

          <div className="flex items-center justify-end flex-wrap gap-2">
            {viewMode === 'icon' && <TileSizeSwitcher tileSize={tileSize} onChange={setTileSize} />}
            <ViewModeSwitcher viewMode={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {readOnly && (
          <div
            className="px-3 sm:px-5 py-1.5 text-xs text-center border-b border-app"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
          >
            {t('driveBrowser.readOnlyBanner')}
          </div>
        )}

        <StatusBar
          syncing={syncing}
          progress={driveProgress}
          count={entries.length}
          searching={Boolean(deferredQuery.trim())}
          tree={tree}
          folderId={currentFolderId}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden((v) => !v)}
          hideControls={readOnly}
          checkableCount={checkableEntries.length}
          checkedCount={checkedIds.size}
          allChecked={allChecked}
          onToggleSelectAll={toggleSelectAll}
        />

        {/* Rows */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden pt-4">
          {!entries.length && !syncing && (
            <p className="text-center text-dim py-16 px-5">
              {deferredQuery.trim()
                ? t('driveBrowser.noMatches', { query: deferredQuery.trim() })
                : t('driveBrowser.emptyFolder')}
            </p>
          )}
          {!entries.length && syncing && !deferredQuery.trim() && (
            // On a very large drive the root can be known before its children arrive; saying
            // "empty" here would be actively wrong.
            <p className="text-center text-dim pt-6 px-5 text-sm">{t('driveBrowser.loadingDrive')}</p>
          )}
          {!entries.length && syncing && (
            <ul className="p-3 space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <li key={i} className="skeleton h-12 rounded-lg" />
              ))}
            </ul>
          )}

          {viewMode === 'icon' ? (
            <IconView
              entries={entries}
              selected={selected}
              canWrite={canWrite}
              tileSize={tileSize}
              scrollRef={scrollRef}
              checkedIds={checkedIds}
              showCheckboxes={checkedIds.size > 0}
              onOpen={open}
              onSelect={setSelected}
              onAction={onRowAction}
              onToggleCheck={toggleChecked}
              onExpandFile={setLightboxFile}
            />
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((row) => {
                const entry = entries[row.index]!;
                return (
                  <div
                    key={entry.kind + entry.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: row.size,
                      transform: `translateY(${row.start}px)`,
                    }}
                  >
                    <Row
                      entry={entry}
                      dense={viewMode === 'dense'}
                      selected={selected?.id === entry.id && selected.kind === entry.kind}
                      canWrite={canWrite}
                      checked={checkedIds.has(entry.kind + entry.id)}
                      showCheckbox={checkedIds.size > 0}
                      onToggleCheck={() => toggleChecked(entry)}
                      onOpen={() => open(entry)}
                      onSelect={() => setSelected(entry)}
                      onAction={(action) => onRowAction(entry, action)}
                      onExpand={(file) => {
                        setSelected(entry);
                        setLightboxFile(file);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </UploadDropzoneOrPlain>

      {selected?.kind === 'file' && (
        <Details
          file={selected.file}
          tree={tree}
          onClose={() => setSelected(null)}
          onExpand={() => setLightboxFile(selected.file)}
        />
      )}

      {lightboxFile && <Lightbox file={lightboxFile} onClose={() => setLightboxFile(null)} />}

      {dialog?.type === 'create-folder' && (
        <CreateFolderDialog driveId={driveId} parentFolderId={currentFolderId} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'rename' && <RenameDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
      {dialog?.type === 'move' && <MoveDialog entry={dialog.entry} onClose={() => setDialog(null)} />}
      {dialog?.type === 'hide' && <HideDialog entry={dialog.entry} onClose={() => setDialog(null)} />}

      {sharing && (
        <ShareDialog
          driveId={driveId}
          owner={address}
          folderId={currentFolderId}
          folderName={trail[trail.length - 1]?.name ?? tree?.drive?.name ?? t('driveBrowser.folder')}
          onClose={() => setSharing(false)}
        />
      )}
    </div>
  );
}

/** Only offers upload affordances (dropzone, toolbar) when this session can actually sign. */
function UploadDropzoneOrPlain({
  canWrite,
  driveId,
  parentFolderId,
  onNewFolder,
  children,
}: {
  canWrite: boolean;
  driveId: string;
  parentFolderId: string;
  onNewFolder: () => void;
  children: React.ReactNode;
}) {
  if (!canWrite) return <main className="flex-1 flex flex-col min-w-0 min-h-0">{children}</main>;
  return (
    <UploadDropzone driveId={driveId} parentFolderId={parentFolderId} onNewFolder={onNewFolder}>
      {children}
    </UploadDropzone>
  );
}

function Breadcrumbs({
  driveName,
  trail,
  rootFolderId,
  onNavigate,
}: {
  driveName: string;
  trail: FolderEntity[];
  driveId: string;
  rootFolderId: string;
  onNavigate: (folderId: string | null) => void;
}) {
  const { t } = useT();

  // Horizontally scrollable so a deep path never widens the page on mobile.
  return (
    <nav
      aria-label={t('driveBrowser.breadcrumb')}
      className="flex items-center gap-0.5 min-w-0 overflow-x-auto text-sm whitespace-nowrap"
    >
      <button onClick={() => onNavigate(null)} className="px-1.5 py-1 rounded font-medium shrink-0 hover:opacity-70">
        {driveName}
      </button>
      {trail
        .filter((f) => f.entityId !== rootFolderId)
        .map((folder) => (
          <span key={folder.entityId} className="flex items-center shrink-0">
            <ChevronRight className="w-4 h-4 text-dim" />
            <button onClick={() => onNavigate(folder.entityId)} className="px-1.5 py-1 rounded hover:opacity-70">
              {folder.name}
            </button>
          </span>
        ))}
    </nav>
  );
}

// Labels are message *keys*, not strings — this array is module-level, so resolving it at
// definition time would freeze whatever locale happened to be active when the module first ran.
const VIEW_MODES: { mode: ViewMode; labelKey: MessageKey; icon: React.ComponentType<{ className?: string }> }[] = [
  { mode: 'list', labelKey: 'driveBrowser.listView', icon: ListViewIcon },
  { mode: 'icon', labelKey: 'driveBrowser.iconView', icon: IconViewIcon },
  { mode: 'dense', labelKey: 'driveBrowser.denseView', icon: DenseViewIcon },
];

function ViewModeSwitcher({ viewMode, onChange }: { viewMode: ViewMode; onChange: (mode: ViewMode) => void }) {
  const { t } = useT();

  return (
    <div role="group" aria-label={t('driveBrowser.layout')} className="flex items-center gap-1 shrink-0">
      {VIEW_MODES.map(({ mode, labelKey, icon: Icon }) => (
        <button
          key={mode}
          onClick={() => onChange(mode)}
          aria-label={t(labelKey)}
          aria-pressed={viewMode === mode}
          title={t(labelKey)}
          className="grid place-items-center w-9 h-9 rounded-lg border border-app surface-2 hover:opacity-80 transition-opacity"
          style={
            viewMode === mode ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : undefined
          }
        >
          <Icon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}

const TILE_SIZES: { size: TileSize; labelKey: MessageKey }[] = [
  { size: 'sm', labelKey: 'driveBrowser.tilesSmall' },
  { size: 'md', labelKey: 'driveBrowser.tilesMedium' },
  { size: 'lg', labelKey: 'driveBrowser.tilesLarge' },
];

function TileSizeSwitcher({ tileSize, onChange }: { tileSize: TileSize; onChange: (size: TileSize) => void }) {
  const { t } = useT();

  return (
    <div role="group" aria-label={t('driveBrowser.tileSize')} className="flex items-center gap-1 shrink-0">
      {TILE_SIZES.map(({ size, labelKey }) => (
        <button
          key={size}
          onClick={() => onChange(size)}
          aria-label={t(labelKey)}
          aria-pressed={tileSize === size}
          title={t(labelKey)}
          className="grid place-items-center w-9 h-9 rounded-lg border border-app surface-2 text-xs font-medium hover:opacity-80 transition-opacity"
          style={
            tileSize === size ? { background: 'var(--accent-soft)', borderColor: 'var(--accent)' } : undefined
          }
        >
          {size.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function StatusBar({
  syncing,
  progress,
  count,
  searching,
  tree,
  folderId,
  showHidden,
  onToggleHidden,
  hideControls = false,
  checkableCount,
  checkedCount,
  allChecked,
  onToggleSelectAll,
}: {
  syncing: boolean;
  progress: { phase: string; found: number; resolved: number; error?: string } | null;
  count: number;
  searching: boolean;
  tree: DriveTree | null;
  folderId: string;
  showHidden: boolean;
  onToggleHidden: () => void;
  /** Suppresses the "Show hidden" toggle for a read-only shared view — a curated view shouldn't
      surface a control for content the owner deliberately hid from their own regular browsing. */
  hideControls?: boolean;
  /** How many currently-listed entries are eligible for batch selection (unresolved ones aren't). */
  checkableCount: number;
  checkedCount: number;
  allChecked: boolean;
  onToggleSelectAll: () => void;
}) {
  const { t, tPlural } = useT();
  const stats = useMemo(() => (tree ? folderStats(tree, folderId) : null), [tree, folderId]);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = checkedCount > 0 && !allChecked;
  }, [checkedCount, allChecked]);

  return (
    <div className="px-3 sm:px-5 py-1.5 flex items-center gap-3 text-xs text-dim border-b border-app">
      {checkableCount > 0 && (
        <input
          ref={selectAllRef}
          type="checkbox"
          checked={allChecked}
          onChange={onToggleSelectAll}
          aria-label={t('download.selectAll')}
        />
      )}
      <span>
        {searching ? tPlural('matches', count) : tPlural('items', count)}
        {stats && !searching && stats.files > 0 && ` · ${formatBytes(stats.bytes)}`}
      </span>
      {syncing && progress && (
        <span className="flex items-center gap-1.5 animate-pulse">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--accent)' }} />
          {progress.phase === 'cached'
            ? t('driveBrowser.checkingUpdates')
            : t('driveBrowser.syncing', { resolved: progress.resolved, found: progress.found })}
        </span>
      )}
      {progress?.phase === 'error' && (
        <span style={{ color: 'var(--danger)' }} title={progress.error}>
          {t('driveBrowser.syncFailed')}
        </span>
      )}
      {tree && tree.orphans.length > 0 && !syncing && (
        <span title={t('driveBrowser.orphanedTitle')}>{tPlural('orphaned', tree.orphans.length)}</span>
      )}
      <div className="flex-1" />
      {!hideControls && (
        <button onClick={onToggleHidden} className="underline underline-offset-2 hover:opacity-70">
          {showHidden ? t('driveBrowser.hideHidden') : t('driveBrowser.showHidden')}
        </button>
      )}
    </div>
  );
}

function Row({
  entry,
  selected,
  canWrite,
  dense,
  checked,
  showCheckbox,
  onToggleCheck,
  onOpen,
  onSelect,
  onAction,
  onExpand,
}: {
  entry: Entry;
  selected: boolean;
  canWrite: boolean;
  /** Compact single-line row — no thumbnail/icon slot; metadata sits inline next to the name
      instead of stacked on its own line below it, same info as the regular row just denser. */
  dense: boolean;
  checked: boolean;
  /** Sticky once anything in the folder is checked — otherwise reveal-on-hover only. */
  showCheckbox: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
  onSelect: () => void;
  onAction: (action: RowAction) => void;
  onExpand: (file: FileEntity) => void;
}) {
  const { t } = useT();
  const isFolder = entry.kind === 'folder';
  const kind = isFolder ? null : fileKind(entry.file.dataContentType, entry.file.name);
  const current = isFolder ? entry.folder : entry.file;
  const unresolved = current.unresolved === true;
  // Just written by this session, not yet seen mined by a real sync — not an error, just not
  // final yet. Distinct from `unresolved` (a real fetch failure) even though both can coexist in
  // theory; `pollPending` in DriveBrowser clears this automatically once a sync confirms it.
  const pending = current.height === null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onDoubleClick={() => {
        // A double-click shortcut straight to the fullscreen view — only for images, only once
        // the entity's real metadata is known (an unresolved placeholder has no dataTxId to
        // preview yet), and only once it's actually fetchable (see the "Processing" badge below).
        if (!isFolder && kind === 'image' && !unresolved && !pending) onExpand(entry.file);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
        if (e.key === 'i') onSelect();
      }}
      className="group h-full mx-2 sm:mx-3 px-2 sm:px-3 rounded-lg flex items-center gap-3 cursor-pointer border transition-colors"
      style={{
        background: selected ? 'var(--accent-soft)' : 'transparent',
        borderColor: selected ? 'var(--accent)' : 'transparent',
      }}
    >
      {!unresolved && (
        <input
          type="checkbox"
          checked={checked}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleCheck}
          aria-label={t('download.selectItem', { name: entry.name })}
          className={showCheckbox || checked ? 'shrink-0' : 'shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100'}
        />
      )}

      {!dense && (
        <span className="shrink-0 w-8 h-8 grid place-items-center rounded-md surface-2 text-base overflow-hidden">
          {isFolder ? (
            <FolderIcon className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
          ) : kind === 'image' ? (
            // displayPx 32 = this slot's own `w-8 h-8`. A 480px on-chain variant covers that
            // comfortably even at DPR 3, so list rows never trigger a local upgrade.
            <RowThumbnail file={entry.file} fallback={KIND_ICONS[kind]} displayPx={32} />
          ) : (
            KIND_ICONS[kind!]
          )}
        </span>
      )}

      <span className={dense ? 'min-w-0 flex-1 flex items-baseline gap-2 overflow-hidden' : 'min-w-0 flex-1'}>
        <span
          className={dense ? 'truncate text-sm font-medium' : 'block truncate text-sm font-medium'}
          style={unresolved ? { color: 'var(--text-dim)', fontStyle: 'italic' } : undefined}
        >
          {entry.name}
        </span>
        <span className={dense ? 'shrink-0 text-xs text-dim' : 'block truncate text-xs text-dim'}>
          {unresolved ? (
            // Deliberately not "will retry and succeed": the body may be genuinely unretrievable
            // from this gateway (HTTP 404), not merely rate limited.
            t('driveBrowser.unresolvedMeta')
          ) : entry.kind === 'file' ? (
            <>
              {entry.path ? `${entry.path} · ` : ''}
              {formatBytes(entry.file.size)} · {formatRelative(entry.file.lastModifiedDate)}
              {entry.file.privacy === 'private' && ` · ${t('driveBrowser.encrypted')}`}
            </>
          ) : (
            t('driveBrowser.folderWithDate', { date: formatRelative(entry.folder.unixTime * 1000) })
          )}
        </span>
      </span>

      {pending && !unresolved && (
        dense ? (
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse shrink-0"
            style={{ background: 'var(--warning)' }}
            title={t('driveBrowser.processingTitle')}
          />
        ) : (
          <span
            className="flex items-center gap-1.5 text-[11px] shrink-0"
            style={{ color: 'var(--warning)' }}
            title={t('driveBrowser.processingTitle')}
          >
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--warning)' }} />
            {t('driveBrowser.processing')}
          </span>
        )
      )}

      {entry.kind === 'file' && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="text-xs px-2 py-1 rounded border border-app text-dim shrink-0 hover:opacity-70"
        >
          {t('driveBrowser.details')}
        </button>
      )}

      {/* Metadata is a placeholder for an unresolved entity — renaming/hiding from a guessed
          current state would risk writing the wrong thing, so the menu is withheld until it's known. */}
      {canWrite && !unresolved && <RowMenu isHidden={current.isHidden} onAction={onAction} />}

      {entry.kind === 'folder' && <ChevronRight className="w-4 h-4 text-dim shrink-0" />}
    </div>
  );
}

/**
 * Large-tile browsing, virtualized the same way the row list is — grouped into virtual "grid
 * rows" of `columns` tiles each, since `@tanstack/react-virtual` has no dedicated 2D API and this
 * needs no more than that. Column count is derived from the shared scroll container's measured
 * width (via `ResizeObserver`) and the current tile size, so it reflows on resize or a size change.
 */
function IconView({
  entries,
  selected,
  canWrite,
  tileSize,
  scrollRef,
  checkedIds,
  showCheckboxes,
  onOpen,
  onSelect,
  onAction,
  onToggleCheck,
  onExpandFile,
}: {
  entries: Entry[];
  selected: Entry | null;
  canWrite: boolean;
  tileSize: TileSize;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  checkedIds: Set<string>;
  showCheckboxes: boolean;
  onOpen: (entry: Entry) => void;
  onSelect: (entry: Entry) => void;
  onAction: (entry: Entry, action: RowAction) => void;
  onToggleCheck: (entry: Entry) => void;
  onExpandFile: (file: FileEntity) => void;
}) {
  const tilePx = TILE_PX[tileSize];
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([observed]) => {
      if (observed) setWidth(observed.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  const availableWidth = Math.max(0, width - ICON_GUTTER * 2);
  const columns = Math.max(1, Math.floor((availableWidth + ICON_GAP) / (tilePx + ICON_GAP)));
  // Redistribute the row's actual available width evenly across exactly `columns` tiles, rather
  // than rendering every tile at the raw nominal size — the nominal size was only ever a target
  // for deciding *how many* columns fit, and using it directly as the rendered width leaves
  // whatever `floor()` left over as a dead strip on the right of every row, full or not. This way
  // a full row's tiles always sum to exactly `availableWidth`, edge to edge; only a genuinely
  // under-full trailing row (fewer items than `columns`) leaves blank space, same as any icon view.
  // `Math.floor`, not a raw fraction: a fractional tile width (measured: 236.8px) makes the
  // browser resample every thumbnail across half-pixel boundaries, which softens the image on top
  // of any other quality loss. Flooring costs at most `columns - 1` px of unused width on the
  // right — invisible — and buys pixel-aligned image boxes.
  const effectiveTileSize = Math.max(48, Math.floor((availableWidth - (columns - 1) * ICON_GAP) / columns));
  const rowCount = width ? Math.ceil(entries.length / columns) : 0;

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => effectiveTileSize + ICON_LABEL_HEIGHT + ICON_GAP,
    overscan: 4,
  });

  // Nothing to lay out yet on the very first render, before the ResizeObserver reports a width —
  // rendering with columns=1 for a tick would just flash a single wide column first.
  if (!width) return null;

  return (
    <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((row) => {
        const rowEntries = entries.slice(row.index * columns, row.index * columns + columns);
        return (
          <div
            key={row.index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: row.size,
              transform: `translateY(${row.start}px)`,
              display: 'flex',
              gap: ICON_GAP,
              padding: `0 ${ICON_GUTTER}px`,
            }}
          >
            {rowEntries.map((entry) => (
              <IconTile
                key={entry.kind + entry.id}
                entry={entry}
                selected={selected?.id === entry.id && selected.kind === entry.kind}
                canWrite={canWrite}
                tilePx={effectiveTileSize}
                checked={checkedIds.has(entry.kind + entry.id)}
                showCheckbox={showCheckboxes}
                onToggleCheck={() => onToggleCheck(entry)}
                onOpen={() => onOpen(entry)}
                onSelect={() => onSelect(entry)}
                onAction={(action) => onAction(entry, action)}
                onExpand={(file) => {
                  onSelect(entry);
                  onExpandFile(file);
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function IconTile({
  entry,
  selected,
  canWrite,
  tilePx,
  checked,
  showCheckbox,
  onToggleCheck,
  onOpen,
  onSelect,
  onAction,
  onExpand,
}: {
  entry: Entry;
  selected: boolean;
  canWrite: boolean;
  tilePx: number;
  checked: boolean;
  showCheckbox: boolean;
  onToggleCheck: () => void;
  onOpen: () => void;
  onSelect: () => void;
  onAction: (action: RowAction) => void;
  onExpand: (file: FileEntity) => void;
}) {
  const { t } = useT();
  const isFolder = entry.kind === 'folder';
  const kind = isFolder ? null : fileKind(entry.file.dataContentType, entry.file.name);
  const current = isFolder ? entry.folder : entry.file;
  const unresolved = current.unresolved === true;
  const pending = current.height === null;
  const iconFontSize = Math.round(tilePx * 0.34);

  return (
    <div className="group shrink-0 flex flex-col items-center" style={{ width: tilePx }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onDoubleClick={() => {
          // Same rule as the list row's double-click: only a resolvable image jumps straight to
          // the fullscreen Lightbox.
          if (!isFolder && kind === 'image' && !unresolved && !pending) onExpand(entry.file);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
          if (e.key === 'i') onSelect();
        }}
        className="relative w-full aspect-square rounded-lg overflow-hidden cursor-pointer border grid place-items-center surface-2 transition-colors"
        style={{
          borderColor: selected ? 'var(--accent)' : 'transparent',
          background: selected ? 'var(--accent-soft)' : undefined,
        }}
      >
        {!isFolder && kind === 'image' ? (
          <RowThumbnail
            file={entry.file}
            fallback={<span style={{ fontSize: iconFontSize }}>{KIND_ICONS.image}</span>}
            displayPx={tilePx}
          />
        ) : isFolder ? (
          <FolderIcon style={{ width: iconFontSize, height: iconFontSize, color: 'var(--accent)' }} />
        ) : (
          <span style={{ fontSize: iconFontSize }}>{KIND_ICONS[kind!]}</span>
        )}

        {pending && !unresolved && (
          <span
            className="absolute bottom-1.5 left-1.5 w-2 h-2 rounded-full animate-pulse"
            style={{ background: 'var(--warning)' }}
            title={t('driveBrowser.processingTitle')}
          />
        )}

        {canWrite && !unresolved && (
          <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            <RowMenu isHidden={current.isHidden} onAction={onAction} />
          </div>
        )}

        {!unresolved && (
          <div
            className={
              // A bare checkbox has no backing of its own, so laid directly over a photo
              // thumbnail it can vanish against a light image or blend into a dark one — unlike
              // RowMenu's "⋮" trigger just across from it, which is legible over any thumbnail
              // only because its own button chrome (border + surface-2 fill) gives it contrast.
              // Same fix here: a small solid chip behind the checkbox, not the bare input.
              (showCheckbox || checked
                ? 'absolute top-1.5 left-1.5'
                : 'absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity') +
              ' grid place-items-center w-6 h-6 rounded-md border border-app surface-2 shadow-sm'
            }
          >
            <input
              type="checkbox"
              checked={checked}
              onClick={(e) => e.stopPropagation()}
              onChange={onToggleCheck}
              aria-label={t('download.selectItem', { name: entry.name })}
              className="w-3.5 h-3.5"
            />
          </div>
        )}
      </div>

      <span
        className="mt-1.5 w-full text-xs text-center truncate"
        style={unresolved ? { color: 'var(--text-dim)', fontStyle: 'italic' } : undefined}
        title={entry.name}
      >
        {entry.name}
      </span>
    </div>
  );
}
