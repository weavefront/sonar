import { useEffect } from 'react';
import { useT } from '../i18n';
import type { FileEntity } from '../arfs/types';
import { usePreviewUrl } from './Preview';
import { CloseIcon } from './icons';

/**
 * Fullscreen expanded view for an image — triggered from the expand button in Details, or a
 * double-click on an image row. Resolves its own URL rather than taking one as a prop, since the
 * double-click trigger has no pre-resolved URL to hand it (Row never calls `usePreviewUrl`); for
 * the Details-triggered path this means a small duplicate decrypt for private images, traded for
 * one hook covering both entry points.
 */
export function Lightbox({ file, onClose }: { file: FileEntity; onClose: () => void }) {
  const { url, loading, error } = usePreviewUrl(file);
  const { t } = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/90 grid place-items-center p-4 sm:p-8"
    >
      <button
        onClick={onClose}
        aria-label={t('lightbox.close')}
        className="absolute top-4 right-4 grid place-items-center w-10 h-10 rounded-lg text-white bg-white/10 hover:bg-white/20 transition-colors"
      >
        <CloseIcon className="w-5 h-5" />
      </button>

      {file.height === null ? (
        <p className="text-white/70 text-sm px-4 text-center">{t('common.stillConfirming')}</p>
      ) : (
        <>
          {loading && <p className="text-white/70 text-sm">{t('common.decrypting')}</p>}
          {error && (
            <p className="text-white/70 text-sm px-4 text-center">{t('lightbox.loadError', { error })}</p>
          )}
        </>
      )}
      {file.height !== null && url && (
        // Stop propagation so clicking the image itself doesn't close the lightbox — only the
        // backdrop and the explicit close button do. The box is sized to a fixed fraction of the
        // viewport (not just `max-w-full max-h-full`, which only ever *caps* an <img>'s own
        // intrinsic size and never grows it) so `object-contain` actually scales a small source
        // image up to fill the available space, not just centers it at its native pixel size.
        // `key={url}` — same reasoning as `Preview.tsx`'s image case: without it, switching to a
        // different file while the lightbox stays open would reuse this `<img>` node and show the
        // previous file's decoded frame until the new one finishes loading.
        <img
          key={url}
          src={url}
          alt={file.name}
          onClick={(e) => e.stopPropagation()}
          className="w-[90vw] h-[90vh] object-contain"
        />
      )}
    </div>
  );
}
