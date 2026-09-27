import { useState } from 'react';
import { useT } from '../i18n';
import { useWriteAction } from '../state/write';
import { usePrivateDrives } from '../state/privateDrives';
import { writeFileRevision, writeFolderRevision, writePrivateFileRevision, writePrivateFolderRevision } from '../turbo/upload';
import type { FileEntity, FolderEntity } from '../arfs/types';
import { Modal, CostPreview } from './Modal';

export function RenameDialog({
  entry,
  onClose,
}: {
  entry: { kind: 'file'; file: FileEntity } | { kind: 'folder'; folder: FolderEntity };
  onClose: () => void;
}) {
  const current = entry.kind === 'file' ? entry.file : entry.folder;
  const [name, setName] = useState(current.name);
  const { status, costWinc, error, prepare, run } = useWriteAction();
  const { t } = useT();

  const trimmed = name.trim();
  const unchanged = trimmed === current.name;
  const canType = status === 'idle' || status === 'error';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || unchanged) return;
    if (status === 'ready') {
      const decryptCtx = usePrivateDrives.getState().getDecryptContext(current.driveId);
      const result = await run(async (turbo) => {
        if (decryptCtx) {
          return entry.kind === 'file'
            ? writePrivateFileRevision({
                turbo,
                file: entry.file,
                name: trimmed,
                fileKey: await decryptCtx.getFileKey(entry.file.entityId),
              })
            : writePrivateFolderRevision({ turbo, folder: entry.folder, name: trimmed, driveKey: decryptCtx.driveKey });
        }
        return entry.kind === 'file'
          ? writeFileRevision({ turbo, file: entry.file, name: trimmed })
          : writeFolderRevision({ turbo, folder: entry.folder, name: trimmed });
      });
      if (result) onClose();
      return;
    }
    await prepare(trimmed.length + 200);
  };

  return (
    <Modal title={entry.kind === 'file' ? t('rename.fileTitle') : t('rename.folderTitle')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <input
          autoFocus
          value={name}
          disabled={!canType}
          onChange={(e) => setName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full min-h-10 px-3 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
        />

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
            disabled={!trimmed || unchanged || status === 'estimating' || status === 'running'}
            className="min-h-9 px-3 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {status === 'running' ? t('rename.renaming') : status === 'ready' ? t('rename.confirm') : t('common.continue')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
