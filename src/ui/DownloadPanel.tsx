import { useT } from '../i18n';
import { useDownloadQueue } from '../state/download';
import { formatBytes } from './format';
import { CloseIcon, DownloadIcon, RefreshIcon } from './icons';

/**
 * Persistent panel docked to the bottom-right, mirroring `UploadPanel`'s dock/header/body shape
 * rather than sharing an abstraction with it — download and upload are conceptually opposite
 * operations, and this project's stated style is small duplication over a premature shared piece.
 */
export function DownloadPanel() {
  const { job, cancel, dismiss } = useDownloadQueue();
  const { t } = useT();

  if (!job) return null;

  const active = job.status === 'collecting' || job.status === 'fetching' || job.status === 'saving';
  const pct = job.totalFiles > 0 ? Math.round((job.completedFiles / job.totalFiles) * 100) : 0;
  const succeeded = job.totalFiles - job.failed.length;

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] surface border border-app rounded-xl shadow-xl overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-app">
        <h2 className="text-sm font-medium flex items-center gap-1.5">
          <DownloadIcon className="w-4 h-4 text-dim" />
          {t('download.panelTitle')}
        </h2>
        {!active && (
          <button
            onClick={dismiss}
            aria-label={t('common.close')}
            className="shrink-0 grid place-items-center w-6 h-6 rounded border border-app hover:opacity-70"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="p-3 space-y-2">
        <p className="text-xs flex items-center gap-1.5">
          {active && <RefreshIcon className="w-3.5 h-3.5 text-dim animate-spin shrink-0" />}
          <span className={job.status === 'error' ? '' : 'text-dim'} style={job.status === 'error' ? { color: 'var(--danger)' } : undefined}>
            {job.status === 'collecting' && t('download.collecting')}
            {job.status === 'fetching' && t('download.fetchingProgress', { completed: job.completedFiles, total: job.totalFiles })}
            {job.status === 'saving' && t('download.saving')}
            {job.status === 'done' &&
              (job.failed.length > 0
                ? t('download.partialFailure', { succeeded, total: job.totalFiles })
                : t('download.done'))}
            {job.status === 'error' && job.error}
          </span>
        </p>

        {active && job.totalFiles > 0 && (
          <>
            <div className="h-1.5 rounded-full surface-2 overflow-hidden">
              <div className="h-full accent-fill transition-all" style={{ width: `${pct}%` }} />
            </div>
            {job.totalBytes > 0 && (
              <p className="text-[11px] text-dim">
                {formatBytes(job.completedBytes)} / {formatBytes(job.totalBytes)}
              </p>
            )}
          </>
        )}

        {active && (
          <button
            onClick={cancel}
            className="w-full min-h-8 rounded-lg border border-app text-xs font-medium hover:opacity-70"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </div>
  );
}
