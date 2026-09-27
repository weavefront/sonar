import { useState } from 'react';
import { useT } from '../i18n';
import { useWriteAction } from '../state/write';
import { usePrivateDrives } from '../state/privateDrives';
import { createFolder, createPrivateFolder } from '../turbo/upload';
import { useWallet } from '../wallet/store';
import { Modal, CostPreview } from './Modal';

export function CreateFolderDialog({
  driveId,
  parentFolderId,
  onClose,
}: {
  driveId: string;
  parentFolderId: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const address = useWallet((s) => s.address)!;
  const { status, costWinc, error, prepare, run } = useWriteAction();

  const trimmed = name.trim();
  const canType = status === 'idle' || status === 'error';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed) return;
    if (status === 'ready') {
      const decryptCtx = usePrivateDrives.getState().getDecryptContext(driveId);
      const result = await run((turbo) =>
        decryptCtx
          ? createPrivateFolder({ turbo, driveId, parentFolderId, name: trimmed, owner: address, driveKey: decryptCtx.driveKey })
          : createFolder({ turbo, driveId, parentFolderId, name: trimmed, owner: address }),
      );
      if (result) onClose();
      return;
    }
    await prepare(trimmed.length + 50);
  };

  return (
    <Modal title={t('createFolder.title')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="folder-name" className="text-xs text-dim block mb-1">
            {t('createFolder.name')}
          </label>
          <input
            id="folder-name"
            autoFocus
            value={name}
            disabled={!canType}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('createFolder.namePlaceholder')}
            className="w-full min-h-10 px-3 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
          />
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
            disabled={!trimmed || status === 'estimating' || status === 'running'}
            className="min-h-9 px-3 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {status === 'running' ? t('common.creating') : status === 'ready' ? t('common.confirmCreate') : t('common.continue')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
