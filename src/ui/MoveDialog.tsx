import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useArfs } from '../state/arfs';
import { useWriteAction } from '../state/write';
import { usePrivateDrives } from '../state/privateDrives';
import { writeFileRevision, writeFolderRevision, writePrivateFileRevision, writePrivateFolderRevision } from '../turbo/upload';
import { descendantFolderIds, listFoldersForPicker } from '../arfs/tree';
import type { FileEntity, FolderEntity } from '../arfs/types';
import { Modal, CostPreview } from './Modal';

export function MoveDialog({
  entry,
  onClose,
}: {
  entry: { kind: 'file'; file: FileEntity } | { kind: 'folder'; folder: FolderEntity };
  onClose: () => void;
}) {
  const tree = useArfs((s) => s.tree);
  const { t } = useT();
  const { status, costWinc, error, prepare, run } = useWriteAction();
  const current = entry.kind === 'file' ? entry.file : entry.folder;
  const [targetId, setTargetId] = useState<string>(current.parentFolderId ?? '');

  // A folder can't be moved into itself or anything inside itself — that would make the moved
  // subtree unreachable from the drive root forever.
  const blocked = useMemo(
    () => (tree && entry.kind === 'folder' ? descendantFolderIds(tree, entry.folder.entityId) : new Set<string>()),
    [tree, entry],
  );
  const options = useMemo(
    () => (tree ? listFoldersForPicker(tree).filter((o) => !blocked.has(o.folder.entityId)) : []),
    [tree, blocked],
  );

  if (!tree) return null;

  const unchanged = targetId === current.parentFolderId;
  const canPick = status === 'idle' || status === 'error';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId || unchanged) return;
    if (status === 'ready') {
      const decryptCtx = usePrivateDrives.getState().getDecryptContext(current.driveId);
      const result = await run(async (turbo) => {
        if (decryptCtx) {
          return entry.kind === 'file'
            ? writePrivateFileRevision({
                turbo,
                file: entry.file,
                parentFolderId: targetId,
                fileKey: await decryptCtx.getFileKey(entry.file.entityId),
              })
            : writePrivateFolderRevision({ turbo, folder: entry.folder, parentFolderId: targetId, driveKey: decryptCtx.driveKey });
        }
        return entry.kind === 'file'
          ? writeFileRevision({ turbo, file: entry.file, parentFolderId: targetId })
          : writeFolderRevision({ turbo, folder: entry.folder, parentFolderId: targetId });
      });
      if (result) onClose();
      return;
    }
    await prepare(250);
  };

  return (
    <Modal
      title={t('move.title', { name: entry.kind === 'file' ? entry.file.name : entry.folder.name })}
      onClose={onClose}
    >
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="move-target" className="text-xs text-dim block mb-1">
            {t('move.destination')}
          </label>
          <select
            id="move-target"
            value={targetId}
            disabled={!canPick}
            onChange={(e) => setTargetId(e.target.value)}
            className="w-full min-h-10 px-2 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
          >
            {options.map(({ folder, depth }) => (
              <option key={folder.entityId} value={folder.entityId}>
                {'　'.repeat(depth)}
                {depth === 0 ? tree.drive?.name ?? folder.name : folder.name}
              </option>
            ))}
          </select>
        </div>

        <CostPreview status={status} costWinc={costWinc} error={error} />

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 px-3 rounded-lg border border-app surface-2 text-sm hover:opacity-80"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!targetId || unchanged || status === 'estimating' || status === 'running'}
            className="min-h-9 px-3 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {status === 'running' ? t('move.moving') : status === 'ready' ? t('move.confirm') : t('common.continue')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
