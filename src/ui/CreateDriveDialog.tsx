import { useState } from 'react';
import { useLocation } from 'wouter';
import { useT } from '../i18n';
import { useWriteAction } from '../state/write';
import { usePrivateDrives } from '../state/privateDrives';
import { createDrive, createPrivateDrive } from '../turbo/upload';
import { useWallet } from '../wallet/store';
import type { DriveEntity, ResolvedEntity } from '../arfs/types';
import { Modal, CostPreview } from './Modal';

/**
 * One button doing double duty: the first click estimates cost and shows it, the second actually
 * signs and spends. Keeps the dialog to a single control instead of a separate "next" step, while
 * still never spending before the user has seen a number.
 */
export function CreateDriveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const address = useWallet((s) => s.address)!;
  const { status, costWinc, error, prepare, run } = useWriteAction<ResolvedEntity[]>();
  const [, navigate] = useLocation();

  const trimmed = name.trim();
  const canType = status === 'idle' || status === 'error';
  const passwordsMismatch = isPrivate && confirmPassword.length > 0 && password !== confirmPassword;
  const passwordReady = !isPrivate || (password.length > 0 && password === confirmPassword);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || !passwordReady) return;
    if (status === 'ready') {
      const result = await run(async (turbo) => {
        if (isPrivate) {
          const { drive, rootFolder, driveKey } = await createPrivateDrive({
            turbo,
            wallet: useWallet.getState(),
            name: trimmed,
            password,
            owner: address,
          });
          // Nothing to "unlock" — the password was just typed to create this drive.
          usePrivateDrives.getState().adoptUnlocked(drive.entityId, password, driveKey);
          return [drive, rootFolder];
        }
        const { drive, rootFolder } = await createDrive({ turbo, name: trimmed, owner: address });
        return [drive, rootFolder];
      });
      const drive = result?.find((e): e is DriveEntity => e.entityType === 'drive');
      if (drive) {
        onClose();
        navigate(`/d/${drive.entityId}`);
      }
      return;
    }
    // Rough estimate: the drive + root-folder JSON bodies are both small and roughly proportional
    // to the name length; encryption overhead (a 16-byte auth tag per body) is negligible here.
    await prepare(trimmed.length * 2 + 150);
  };

  return (
    <Modal title={t('createDrive.title')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="drive-name" className="text-xs text-dim block mb-1">
            {t('createDrive.name')}
          </label>
          <input
            id="drive-name"
            autoFocus
            value={name}
            disabled={!canType}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('createDrive.namePlaceholder')}
            className="w-full min-h-10 px-3 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
          />
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isPrivate}
            disabled={!canType}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          {t('createDrive.makePrivate')}
        </label>

        {isPrivate && (
          <div className="space-y-2 pl-1 border-l-2 border-app">
            <div className="pl-3 space-y-2">
              <div>
                <label htmlFor="drive-password" className="text-xs text-dim block mb-1">
                  {t('createDrive.password')}
                </label>
                <input
                  id="drive-password"
                  type="password"
                  value={password}
                  disabled={!canType}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-10 px-3 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
                />
              </div>
              <div>
                <label htmlFor="drive-password-confirm" className="text-xs text-dim block mb-1">
                  {t('createDrive.confirmPassword')}
                </label>
                <input
                  id="drive-password-confirm"
                  type="password"
                  value={confirmPassword}
                  disabled={!canType}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full min-h-10 px-3 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
                />
              </div>
              {passwordsMismatch && (
                <p className="text-xs" style={{ color: 'var(--danger)' }}>
                  {t('createDrive.passwordMismatch')}
                </p>
              )}
              <p className="text-xs" style={{ color: 'var(--danger)' }}>
                {t('createDrive.noRecovery')}
              </p>
            </div>
          </div>
        )}

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
            disabled={!trimmed || !passwordReady || status === 'estimating' || status === 'running'}
            className="min-h-9 px-3 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {status === 'running' ? t('common.creating') : status === 'ready' ? t('common.confirmCreate') : t('common.continue')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
