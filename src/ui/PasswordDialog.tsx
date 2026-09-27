import { useState } from 'react';
import { useT } from '../i18n';
import { usePrivateDrives } from '../state/privateDrives';
import { useArfs } from '../state/arfs';
import type { DriveEntity } from '../arfs/types';
import { Modal } from './Modal';

type Status = 'idle' | 'unlocking' | 'wrong-password' | 'error';

export function PasswordDialog({
  drive,
  onClose,
  onUnlocked,
}: {
  drive: DriveEntity;
  onClose: () => void;
  onUnlocked: (entity: DriveEntity) => void;
}) {
  const { t, tParts } = useT();
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || status === 'unlocking') return;
    setStatus('unlocking');
    setDiagnostic(null);

    const result = await usePrivateDrives.getState().unlock(drive, password);
    if (result.status !== 'ok') setDiagnostic(result.diagnostic);
    if (result.status === 'ok') {
      // Splice the now-decrypted drive straight into state — the same optimistic-entity path M2
      // uses for a freshly-written entity. The tree reducer doesn't care where an entity came
      // from, only that it has a real height-or-null and the right shape.
      useArfs.getState().applyLocalMutation([result.entity]);
      onUnlocked(result.entity);
      onClose();
      return;
    }
    if (result.status === 'wrong-password') {
      setStatus('wrong-password');
      return;
    }
    setStatus('error');
    setErrorMessage(result.message);
  };

  return (
    <Modal title={t('password.title')} onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-3">
        <p className="text-sm text-dim">
          {tParts('password.prompt', { name: <span className="font-medium">{drive.name}</span> })}
        </p>

        <input
          type="password"
          autoFocus
          value={password}
          disabled={status === 'unlocking'}
          onChange={(e) => {
            setPassword(e.target.value);
            if (status === 'wrong-password' || status === 'error') setStatus('idle');
          }}
          placeholder={t('password.placeholder')}
          className="w-full min-h-10 px-3 rounded-lg border border-app surface-2 text-sm disabled:opacity-60"
        />

        {status === 'wrong-password' && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            {t('password.wrong')}
          </p>
        )}
        {status === 'error' && (
          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            {errorMessage}
          </p>
        )}
        {/* A wrong key and a wrong password are cryptographically indistinguishable, so when this
            fails there is no way to tell a typo from a bug in our own derivation without the facts
            behind it. Shown rather than buried in the console so it can simply be copied. */}
        {diagnostic && (
          <details className="text-xs">
            <summary className="cursor-pointer text-dim">{t('password.technicalDetails')}</summary>
            <pre className="mt-1 p-2 rounded surface-2 border border-app overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px]">
              {diagnostic}
            </pre>
          </details>
        )}

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
            disabled={!password || status === 'unlocking'}
            className="min-h-9 px-3 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90"
          >
            {status === 'unlocking' ? t('password.unlocking') : t('password.unlock')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
