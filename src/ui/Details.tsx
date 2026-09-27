import { useEffect, useRef, useState } from 'react';
import { DEFAULT_DATA_GATEWAYS } from '../arfs/gql';
import { useT } from '../i18n';
import type { DriveTree } from '../arfs/tree';
import { filePath } from '../arfs/tree';
import type { FileEntity, ResolvedEntity } from '../arfs/types';
import { fileKind, formatBytes, formatDateTime } from './format';
import { CheckIcon, CloseIcon, CopyIcon, DownloadIcon, ExpandIcon, LinkIcon } from './icons';
import { Preview, usePreviewUrl } from './Preview';

const GATEWAY = DEFAULT_DATA_GATEWAYS[0];

export function Details({
  file,
  tree,
  onClose,
  onExpand,
}: {
  file: FileEntity;
  tree: DriveTree | null;
  onClose: () => void;
  /** Opens the fullscreen Lightbox for this file — only ever called for an image (see below). */
  onExpand: () => void;
}) {
  const { t, tPlural } = useT();
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  // Same resolved URL Preview renders from — a direct gateway link for a public file, or the
  // decrypted `blob:` URL for a private one. A private file's ciphertext is never linked directly:
  // downloading or "copying the link" to raw ciphertext would silently hand out garbage.
  const { url, loading: decrypting, error: decryptError } = usePreviewUrl(file);
  const revisions = tree?.revisions.get(file.entityId) ?? [];
  const isImage = fileKind(file.dataContentType, file.name) === 'image';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is visible below anyway */
    }
  };

  const triggerDownload = async () => {
    if (!url) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      // The browser's `download` attribute only forces a save prompt for same-origin, blob:, or
      // data: URLs — a cross-origin gateway link (any public file) is spec'd to be ignored and
      // just navigates instead, which is exactly the "opens in a new tab" behavior this works
      // around. A private file's `url` is already a blob: from decryption, so only public needs
      // an actual fetch first to materialize a same-origin blob the browser will treat as a file.
      const blobUrl = file.privacy === 'private' ? url : URL.createObjectURL(await (await fetch(url)).blob());
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      if (file.privacy === 'public') URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      {/* Backdrop for the mobile bottom sheet only. */}
      <div
        onClick={onClose}
        className="lg:hidden fixed inset-0 z-30 bg-black/40"
        aria-hidden
      />
      <aside
        aria-label={t('details.forFile', { name: file.name })}
        className={[
          // Mobile: bottom sheet, capped to 85% of the viewport with its own internal scroll.
          // Desktop: docked right rail — capped to the space below the sticky header (h-14) for
          // the same reason. Without an explicit height here, a file with a long version history
          // grows the panel past the viewport, which grows the whole page, which makes this
          // `static`-positioned panel scroll away with everything else instead of staying put.
          'fixed inset-x-0 bottom-0 z-40 max-h-[85dvh] rounded-t-2xl border-t',
          'lg:static lg:z-auto lg:h-[calc(100dvh-3.5rem)] lg:max-h-none lg:w-96 lg:shrink-0 lg:rounded-none lg:border-t-0 lg:border-l',
          'surface border-app overflow-y-auto',
        ].join(' ')}
      >
        <div className="sticky top-0 surface border-b border-app px-4 py-3 flex items-start gap-2">
          <h2 className="font-medium text-sm break-words min-w-0 flex-1">{file.name}</h2>
          <button
            onClick={onClose}
            aria-label={t('details.close')}
            className="grid place-items-center w-8 h-8 rounded-lg border border-app surface-2 shrink-0 hover:opacity-80"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative">
            <Preview file={file} />
            {isImage && url && file.height !== null && (
              <button
                onClick={onExpand}
                aria-label={t('details.viewExpanded')}
                title={t('details.viewExpanded')}
                className="absolute top-2 right-2 grid place-items-center w-8 h-8 rounded-lg text-white bg-black/50 hover:bg-black/70 transition-colors"
              >
                <ExpandIcon className="w-4 h-4" />
              </button>
            )}
          </div>

          {file.dataTxId && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void triggerDownload()}
                disabled={!url || downloading}
                className="flex-1 min-h-10 rounded-lg accent-fill text-sm font-medium flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-50 disabled:pointer-events-none"
              >
                <DownloadIcon className="w-4 h-4" />
                {decrypting ? t('common.decrypting') : downloading ? t('details.preparingDownload') : t('details.download')}
              </button>
              {/* A blob: URL only exists in this tab's memory for this session — not something
                  worth offering to "copy" as a link, unlike a real gateway URL. */}
              {file.privacy === 'public' && (
                <button
                  onClick={copyLink}
                  className="min-h-10 px-3 rounded-lg border border-app surface-2 text-sm flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                >
                  <LinkIcon className="w-4 h-4" />
                  {copied ? t('common.copied') : t('details.copyLink')}
                </button>
              )}
            </div>
          )}
          {decryptError && (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>
              {decryptError}
            </p>
          )}
          {downloadError && (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>
              {t('details.downloadError', { error: downloadError })}
            </p>
          )}

          <dl className="text-sm space-y-2">
            <Field label={t('details.size')} value={formatBytes(file.size)} />
            <Field label={t('details.type')} value={file.dataContentType || '—'} />
            <Field label={t('details.modified')} value={formatDateTime(file.lastModifiedDate)} />
            <Field label={t('details.uploaded')} value={formatDateTime(file.unixTime * 1000)} />
            {tree && <Field label={t('details.path')} value={filePath(tree, file)} wrap />}
            <Field label={t('details.fileId')} value={file.entityId} mono wrap copyable />
            <Field label={t('details.dataTx')} value={file.dataTxId || '—'} mono wrap copyable={!!file.dataTxId} />
            <Field label={t('details.metadataTx')} value={file.metadataTxId} mono wrap copyable />
            {file.height !== null && <Field label={t('details.block')} value={String(file.height)} />}
            <Field label={t('details.arfs')} value={file.arFsVersion || '—'} />
            {file.pinnedDataOwner && (
              <Field label={t('details.pinnedFrom')} value={file.pinnedDataOwner} mono wrap copyable />
            )}
          </dl>

          {revisions.length > 1 && (
            <Versions
              revisions={revisions}
              currentTx={file.metadataTxId}
              heading={`${t('details.versionHistory')} · ${tPlural('revisions', revisions.length)}`}
              currentLabel={t('details.current')}
              encryptedLabel={t('details.encryptedTag')}
            />
          )}
        </div>
      </aside>
    </>
  );
}

function Field({
  label,
  value,
  mono,
  wrap,
  copyable,
}: {
  label: string;
  value: string;
  mono?: boolean;
  wrap?: boolean;
  /** Adds a one-click copy button — for IDs a user realistically needs to paste elsewhere. */
  copyable?: boolean;
}) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const valueRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      return;
    } catch {
      // The async Clipboard API can be denied outright — embedded webviews and some locked-down
      // browsers refuse `clipboard-write` even on a real click (confirmed in the desktop app's own
      // browser pane: NotAllowedError). Fall through to the legacy path below.
    }
    // Select the value, then try the legacy copy command, which works in many places the async API
    // is blocked. Even if that fails too, the value is left selected, so Cmd/Ctrl+C still works —
    // the button never silently does nothing.
    const node = valueRef.current;
    const selection = window.getSelection();
    if (!node || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    let legacyWorked = false;
    try {
      legacyWorked = document.execCommand('copy');
    } catch {
      /* unsupported */
    }
    if (legacyWorked) {
      selection.removeAllRanges();
      setCopied(true);
    }
  };

  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 items-baseline">
      <dt className="text-dim text-xs">{label}</dt>
      <dd className="flex items-start gap-1.5 min-w-0">
        <span
          ref={valueRef}
          className={[
            'min-w-0 flex-1 select-all',
            mono ? 'font-mono text-xs' : 'text-sm',
            wrap ? 'break-all' : 'truncate',
          ].join(' ')}
        >
          {value}
        </span>
        {copyable && (
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? t('common.copied') : t('details.copyValue', { label })}
            title={copied ? t('common.copied') : t('details.copyValue', { label })}
            className="shrink-0 -my-0.5 grid place-items-center w-6 h-6 rounded border border-app surface-2 hover:opacity-80 transition-opacity"
          >
            {copied ? (
              <CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 text-dim" />
            )}
          </button>
        )}
      </dd>
    </div>
  );
}

/**
 * ArFS keeps every revision permanently, so a file genuinely has history — including older data
 * transactions that are all still retrievable.
 */
function Versions({
  revisions,
  currentTx,
  heading,
  currentLabel,
  encryptedLabel,
}: {
  revisions: ResolvedEntity[];
  currentTx: string;
  heading: string;
  currentLabel: string;
  encryptedLabel: string;
}) {
  return (
    <section>
      <h3 className="text-xs font-medium text-dim mb-2">
        {heading}
      </h3>
      <ol className="space-y-1.5">
        {revisions.map((revision) => {
          const isCurrent = revision.metadataTxId === currentTx;
          const dataTxId = revision.entityType === 'file' ? revision.dataTxId : '';
          return (
            <li
              key={revision.metadataTxId}
              className="border border-app rounded-lg p-2 text-xs"
              style={isCurrent ? { borderColor: 'var(--accent)', background: 'var(--accent-soft)' } : undefined}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{formatDateTime(revision.unixTime * 1000)}</span>
                {isCurrent && <span style={{ color: 'var(--accent)' }}>{currentLabel}</span>}
                <div className="flex-1" />
                {revision.height !== null && <span className="text-dim">#{revision.height}</span>}
              </div>
              {dataTxId && revision.privacy === 'public' && (
                <a
                  href={`${GATEWAY}/${dataTxId}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-dim break-all hover:underline"
                >
                  {dataTxId}
                </a>
              )}
              {/* Not a link: that tx id is ciphertext on the gateway, and clicking through would
                  just show garbage rather than decrypted content. */}
              {dataTxId && revision.privacy === 'private' && (
                <span className="font-mono text-dim break-all">
                  {dataTxId} {encryptedLabel}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
