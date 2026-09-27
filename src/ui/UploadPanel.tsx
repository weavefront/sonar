import { useMemo } from 'react';
import { useT } from '../i18n';
import { useUploadQueue } from '../state/write';
import { formatBalance, formatBytes } from './format';
import { CloseIcon, FileIcon, RefreshIcon } from './icons';

/** Persistent panel docked to the bottom-right, listing every staged/running/finished upload. */
export function UploadPanel() {
  const { items, confirmUpload, remove, clearFinished } = useUploadQueue();
  const { t, tPlural } = useT();

  const ready = items.filter((i) => i.status === 'ready');
  const totalCostWinc = useMemo(() => {
    if (!ready.length) return null;
    const total = ready.reduce((sum, i) => sum + Number(i.costWinc ?? 0), 0);
    return Number.isFinite(total) ? String(total) : null;
  }, [ready]);

  if (!items.length) return null;

  const anyEstimating = items.some((i) => i.status === 'estimating');
  const anyUploading = items.some((i) => i.status === 'uploading');
  const anyDone = items.some((i) => i.status === 'done');

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] surface border border-app rounded-xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app">
        <h2 className="text-sm font-medium">
          {t('upload.panelTitle')} {items.length > 0 && <span className="text-dim">({items.length})</span>}
        </h2>
        {anyDone && (
          <button onClick={clearFinished} className="text-xs text-dim hover:opacity-70 underline underline-offset-2">
            {t('upload.clearFinished')}
          </button>
        )}
      </div>

      <ul className="max-h-64 overflow-y-auto divide-y divide-app">
        {items.map((item) => (
          <li key={item.id} className="px-3 py-2 flex items-center gap-2">
            <FileIcon className="w-4 h-4 text-dim shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium truncate">
                {item.relativePath ? `${item.relativePath}/` : ''}
                {item.file.name}
              </p>
              <p className="text-[11px] text-dim truncate">
                {item.status === 'estimating' && t('upload.estimating')}
                {item.status === 'ready' && item.costWinc && `${formatBytes(item.file.size)} · ${formatBalance(item.costWinc)}`}
                {item.status === 'uploading' &&
                  (item.progress
                    ? `${Math.round((item.progress.processedBytes / Math.max(1, item.progress.totalBytes)) * 100)}%`
                    : t('upload.uploading'))}
                {item.status === 'done' && t('upload.done')}
                {item.status === 'error' && <span style={{ color: 'var(--danger)' }}>{item.error}</span>}
              </p>
            </div>
            {item.status !== 'uploading' && (
              <button
                onClick={() => remove(item.id)}
                aria-label={t('upload.remove', { name: item.file.name })}
                className="shrink-0 grid place-items-center w-6 h-6 rounded border border-app hover:opacity-70"
              >
                <CloseIcon className="w-3 h-3" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {ready.length > 0 && (
        <div className="p-3 border-t border-app space-y-2">
          {totalCostWinc && <p className="text-xs text-dim">{t('upload.total', { amount: formatBalance(totalCostWinc) })}</p>}
          <button
            onClick={() => void confirmUpload()}
            disabled={anyEstimating || anyUploading}
            className="w-full min-h-9 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5 hover:opacity-90"
          >
            {anyUploading ? (
              <>
                <RefreshIcon className="w-4 h-4 animate-spin" />
                {t('upload.uploading')}
              </>
            ) : (
              tPlural('confirmUpload', ready.length)
            )}
          </button>
        </div>
      )}
    </div>
  );
}
