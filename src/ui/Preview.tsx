import { useEffect, useState } from 'react';
import { DEFAULT_DATA_GATEWAYS } from '../arfs/gql';
import { useT } from '../i18n';
import { usePrivateDrives } from '../state/privateDrives';
import type { FileEntity } from '../arfs/types';
import { fileKind, formatBytes } from './format';

const GATEWAY = DEFAULT_DATA_GATEWAYS[0];
/** Don't pull a huge file into the DOM just to preview it. */
const MAX_TEXT_BYTES = 256 * 1024;

/**
 * Resolves a file to a URL every media element below can just `src=` — a direct gateway URL for a
 * public file, or an in-memory `blob:` URL for a decrypted private one. Once a private file is
 * decrypted into a Blob, a `blob:` URL behaves exactly like any other fetchable resource URL
 * (including for `TextPreview`'s own `fetch()` below), so nothing downstream needs to know or care
 * which kind of file it's looking at.
 */
export function usePreviewUrl(file: FileEntity): { url: string | null; loading: boolean; error: string | null } {
  const getDecryptContext = usePrivateDrives((s) => s.getDecryptContext);
  const { t } = useT();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (file.privacy === 'public') {
      setUrl(`${GATEWAY}/${file.dataTxId}`);
      setError(null);
      return;
    }

    setUrl(null);
    setError(null);
    const ctx = getDecryptContext(file.driveId);
    if (!ctx) {
      setError(t('preview.locked'));
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      const { fetchAndDecryptFileData } = await import('../arfs/crypto/fileData');
      const fileKey = await ctx.getFileKey(file.entityId);
      const blob = await fetchAndDecryptFileData(file, fileKey);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch((err: Error) => {
      if (!cancelled) setError(err.message);
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.privacy, file.driveId, file.entityId, file.dataTxId]);

  return { url, loading: file.privacy === 'private' && !url && !error, error };
}

export function Preview({ file }: { file: FileEntity }) {
  const kind = fileKind(file.dataContentType, file.name);
  const { url, loading, error } = usePreviewUrl(file);
  const { t } = useT();

  if (!file.dataTxId) {
    return <Placeholder>{t('preview.noDataTx')}</Placeholder>;
  }
  if (file.height === null) {
    // Just uploaded — Turbo confirms instantly, but real gateway availability lags well behind
    // that, so attempting the fetch now would almost always just show a broken preview.
    return <Placeholder>{t('common.stillConfirming')}</Placeholder>;
  }
  if (error) return <Placeholder>{t('preview.decryptError', { error })}</Placeholder>;
  if (loading) return <div className="skeleton h-32 rounded-lg" />;
  if (!url) return <Placeholder>{t('preview.noInlinePreview')}</Placeholder>;

  // `key={url}` on every case below is load-bearing, not decorative: `Details` stays mounted as
  // the user clicks from file to file, so without a key React reuses the same <img>/<video>/etc
  // DOM node and just updates its `src`. Per spec, a media element keeps showing its *previously
  // decoded* content until the new `src` finishes loading — it does not go blank in between —
  // which is exactly "click another image and the preview still shows the first one" (confirmed
  // live: right after a bare `src` swap, `naturalWidth`/`currentSrc` still reported the OLD
  // image). Keying on `url` forces a fresh element per file, which starts genuinely blank instead
  // of showing a stale frame while the real content loads.
  switch (kind) {
    case 'image':
      return (
        <img
          key={url}
          src={url}
          alt={file.name}
          loading="lazy"
          className="w-full max-h-64 object-contain rounded-lg surface-2"
        />
      );
    case 'video':
      return (
        <video key={url} src={url} controls preload="metadata" className="w-full max-h-64 rounded-lg surface-2" />
      );
    case 'audio':
      return <audio key={url} src={url} controls preload="metadata" className="w-full" />;
    case 'pdf':
      // A private file's `url` is a `blob:` URL, which runs with *this app's own origin*, and its
      // blob type is whatever the file's `dataContentType` says. `fileKind` falls back to the
      // extension, so a file named `x.pdf` whose recorded type is `text/html` would be framed here
      // as live, same-origin HTML — script with full access to the app. Only frame a private blob
      // when its type genuinely is PDF. Public files are served from the gateway's own sandboxed
      // origin, so they can't reach the app either way.
      if (file.privacy === 'private' && file.dataContentType.toLowerCase() !== 'application/pdf') {
        return <Placeholder>{t('preview.noInlinePreview')}</Placeholder>;
      }
      return (
        <iframe key={url} src={url} title={file.name} className="w-full h-64 rounded-lg border border-app" />
      );
    case 'text':
    case 'markdown':
    case 'code':
      return <TextPreview url={url} size={file.size} />;
    default:
      return <Placeholder>{t('preview.noInlinePreview')}</Placeholder>;
  }
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-2 border border-app rounded-lg p-4 text-xs text-dim text-center">{children}</div>
  );
}

function TextPreview({ url, size }: { url: string; size: number }) {
  const { t } = useT();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (size > MAX_TEXT_BYTES) return;
    let cancelled = false;
    setText(null);
    setError(null);

    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`Gateway responded ${res.status}`))))
      .then((body) => {
        if (!cancelled) setText(body.slice(0, MAX_TEXT_BYTES));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (size > MAX_TEXT_BYTES) {
    return <Placeholder>{t('preview.tooLarge', { size: formatBytes(size) })}</Placeholder>;
  }
  if (error) return <Placeholder>{t('preview.loadError', { error })}</Placeholder>;
  if (text === null) return <div className="skeleton h-32 rounded-lg" />;

  return (
    <pre className="surface-2 border border-app rounded-lg p-3 text-xs font-mono max-h-64 overflow-auto whitespace-pre-wrap break-words">
      {text}
    </pre>
  );
}
