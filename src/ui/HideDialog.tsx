import { useT } from '../i18n';
import { useWriteAction } from '../state/write';
import { usePrivateDrives } from '../state/privateDrives';
import { writeFileRevision, writeFolderRevision, writePrivateFileRevision, writePrivateFolderRevision } from '../turbo/upload';
import type { FileEntity, FolderEntity } from '../arfs/types';
import { Modal, CostPreview } from './Modal';

/** Hide and unhide are both "write a new revision with isHidden flipped" — same confirm-then-spend shape as everything else. */
export function HideDialog({
  entry,
  onClose,
}: {
  entry: { kind: 'file'; file: FileEntity } | { kind: 'folder'; folder: FolderEntity };
  onClose: () => void;
}) {
  const current = entry.kind === 'file' ? entry.file : entry.folder;
  const nextHidden = !current.isHidden;
  const { status, costWinc, error, prepare, run } = useWriteAction();
  const { t } = useT();

  const onConfirm = async () => {
    if (status === 'ready') {
      const decryptCtx = usePrivateDrives.getState().getDecryptContext(current.driveId);
      const result = await run(async (turbo) => {
        if (decryptCtx) {
          return entry.kind === 'file'
            ? writePrivateFileRevision({
                turbo,
                file: entry.file,
                isHidden: nextHidden,
                fileKey: await decryptCtx.getFileKey(entry.file.entityId),
              })
            : writePrivateFolderRevision({ turbo, folder: entry.folder, isHidden: nextHidden, driveKey: decryptCtx.driveKey });
        }
        return entry.kind === 'file'
          ? writeFileRevision({ turbo, file: entry.file, isHidden: nextHidden })
          : writeFolderRevision({ turbo, folder: entry.folder, isHidden: nextHidden });
      });
      if (result) onClose();
      return;
    }
    await prepare(200);
  };

  return (
    <Modal
      title={
        nextHidden
          ? entry.kind === 'file'
            ? t('hide.hideFileTitle')
            : t('hide.hideFolderTitle')
          : entry.kind === 'file'
            ? t('hide.unhideFileTitle')
            : t('hide.unhideFolderTitle')
      }
      onClose={onClose}
    >
      <p className="text-sm">
        {nextHidden
          ? t('hide.willHide', { name: current.name })
          : t('hide.willUnhide', { name: current.name })}
      </p>

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
          type="button"
          onClick={() => void onConfirm()}
          disabled={status === 'estimating' || status === 'running'}
          className="min-h-9 px-3 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90"
        >
          {status === 'running'
            ? t('hide.saving')
            : status === 'ready'
              ? nextHidden
                ? t('hide.confirmHide')
                : t('hide.confirmUnhide')
              : t('common.continue')}
        </button>
      </div>
    </Modal>
  );
}
