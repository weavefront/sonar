import { useRef, useState, type DragEvent } from 'react';
import { useT } from '../i18n';
import { useUploadQueue } from '../state/write';
import { UploadIcon, PlusIcon, FolderPlusIcon } from './icons';

/**
 * Drag-and-drop surface plus the "Upload files" / "Upload folder" / "New folder" toolbar buttons.
 *
 * Drag-and-drop only ever yields flat files (no directory structure) here — the browser's native
 * drag events don't expose a webkitRelativePath. Folder structure upload goes through the
 * `webkitdirectory` file input instead, which does.
 */
export function UploadDropzone({
  driveId,
  parentFolderId,
  onNewFolder,
  children,
}: {
  driveId: string;
  parentFolderId: string;
  onNewFolder: () => void;
  children: React.ReactNode;
}) {
  const { t } = useT();
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const stageFiles = useUploadQueue((s) => s.stageFiles);
  const stageFileList = useUploadQueue((s) => s.stageFileList);

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current++;
    if (e.dataTransfer.types.includes('Files')) setDragging(true);
  };
  const onDragOver = (e: DragEvent) => e.preventDefault();
  const onDragLeave = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) stageFiles(files, driveId, parentFolderId);
  };

  return (
    <main
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex-1 flex flex-col min-w-0 min-h-0"
    >
      {children}

      {dragging && (
        <div
          className="absolute inset-0 z-30 grid place-items-center border-2 border-dashed rounded-lg m-2 pointer-events-none"
          style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}
        >
          <div className="flex flex-col items-center gap-2" style={{ color: 'var(--accent)' }}>
            <UploadIcon className="w-8 h-8" />
            <p className="font-medium text-sm">{t('upload.dropToUpload')}</p>
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) stageFiles(Array.from(e.target.files), driveId, parentFolderId);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error -- non-standard but universally supported attribute for folder pickers
        webkitdirectory=""
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) stageFileList(e.target.files, driveId, parentFolderId);
          e.target.value = '';
        }}
      />

      <UploadToolbar
        onUploadFiles={() => fileInputRef.current?.click()}
        onUploadFolder={() => folderInputRef.current?.click()}
        onNewFolder={onNewFolder}
      />
    </main>
  );
}

function UploadToolbar({
  onUploadFiles,
  onUploadFolder,
  onNewFolder,
}: {
  onUploadFiles: () => void;
  onUploadFolder: () => void;
  onNewFolder: () => void;
}) {
  // The upload queue panel docks bottom-right and, on narrow screens, is nearly full width —
  // wide enough to sit directly under this centered toolbar and cover it. Lifting the toolbar
  // clear of the panel's approximate height while it has items keeps both usable at once.
  const hasQueueItems = useUploadQueue((s) => s.items.length > 0);
  const { t } = useT();

  return (
    <div
      className={[
        'absolute left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5',
        'surface border border-app rounded-full shadow-lg px-1.5 py-1.5',
        'transition-[bottom]',
        hasQueueItems ? 'bottom-72' : 'bottom-4',
      ].join(' ')}
    >
      <ToolbarButton onClick={onUploadFiles} label={t('upload.uploadFiles')} icon={<UploadIcon className="w-4 h-4" />} primary />
      <ToolbarButton onClick={onUploadFolder} label={t('upload.uploadFolder')} icon={<FolderPlusIcon className="w-4 h-4" />} />
      <ToolbarButton onClick={onNewFolder} label={t('upload.newFolder')} icon={<PlusIcon className="w-4 h-4" />} />
    </div>
  );
}

function ToolbarButton({
  onClick,
  label,
  icon,
  primary,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={[
        'flex items-center gap-1.5 min-h-9 px-3 rounded-full text-sm font-medium transition-opacity hover:opacity-90',
        primary ? 'accent-fill' : 'surface-2 border border-app',
      ].join(' ')}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
