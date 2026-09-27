import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n';
import { CloseIcon } from './icons';
import { formatBalance } from './format';

/** Shared dialog chrome for the create/rename/move flows — centered, Escape-to-close, backdrop click-to-close. */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div onClick={onClose} className="absolute inset-0 bg-black/40" aria-hidden />
      <div className="relative w-full max-w-sm surface border border-app rounded-xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-app">
          <h2 className="font-medium text-sm">{title}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close')}
            className="grid place-items-center w-7 h-7 rounded-lg border border-app surface-2 hover:opacity-80"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
      </div>
    </div>
  );
}

/** Cost preview + confirm row shared by every write dialog. */
export function CostPreview({
  status,
  costWinc,
  error,
}: {
  status: 'idle' | 'estimating' | 'ready' | 'running' | 'error';
  costWinc: string | null;
  error: string | null;
}) {
  const { t } = useT();

  if (status === 'error') {
    return (
      <p className="text-xs" style={{ color: 'var(--danger)' }}>
        {error}
      </p>
    );
  }
  if (status === 'estimating') return <p className="text-xs text-dim">{t('modal.estimatingCost')}</p>;
  if (status === 'ready' && costWinc) {
    // AR, not raw winc — see formatBalance's own comment on why that's safe here: the AR/winc
    // ratio is a fixed protocol constant, not a guessed price, so this loses no real precision.
    return <p className="text-xs text-dim">{t('modal.cost', { amount: formatBalance(costWinc) })}</p>;
  }
  return null;
}
