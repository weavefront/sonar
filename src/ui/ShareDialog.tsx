import { useState } from 'react';
import { useT } from '../i18n';
import { Modal } from './Modal';

/**
 * Generates a read-only link to a public folder — pure client-side URL construction, no signing,
 * no cost, no network call. That's deliberate: sharing shouldn't need a wallet interaction at all.
 * See `ShareRoute.tsx` for what happens when the link is opened.
 */
export function ShareDialog({
  driveId,
  owner,
  folderId,
  folderName,
  onClose,
}: {
  driveId: string;
  owner: string;
  folderId: string;
  folderName: string;
  onClose: () => void;
}) {
  const { t } = useT();
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [copied, setCopied] = useState(false);

  // The `#` is load-bearing, not cosmetic — the app routes on the hash fragment (see main.tsx),
  // so `?scope=folder` has to live *inside* it too, or it'd never reach the router at all.
  const url = `${window.location.origin}${window.location.pathname}#/share/${driveId}/${owner}/${folderId}${includeSubfolders ? '' : '?scope=folder'}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the link is visible below anyway */
    }
  };

  return (
    <Modal title={t('share.title', { name: folderName })} onClose={onClose}>
      <fieldset className="space-y-2">
        <legend className="text-xs text-dim mb-1">{t('share.whatToInclude')}</legend>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="share-scope"
            checked={includeSubfolders}
            onChange={() => setIncludeSubfolders(true)}
          />
          {t('share.thisFolderAndSubfolders')}
        </label>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="radio"
            name="share-scope"
            checked={!includeSubfolders}
            onChange={() => setIncludeSubfolders(false)}
          />
          {t('share.justThisFolder')}
        </label>
      </fieldset>

      <div>
        <label htmlFor="share-link" className="text-xs text-dim block mb-1">
          {t('share.link')}
        </label>
        <div className="flex gap-2">
          <input
            id="share-link"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 min-w-0 min-h-10 px-3 rounded-lg border border-app surface-2 text-xs font-mono"
          />
          <button
            type="button"
            onClick={() => void copyLink()}
            className="min-h-10 px-3 rounded-lg accent-fill text-sm font-medium shrink-0 hover:opacity-90"
          >
            {copied ? t('common.copied') : t('share.copy')}
          </button>
        </div>
      </div>

      <p className="text-xs text-dim">
        {includeSubfolders ? t('share.noteWithSubfolders') : t('share.noteFolderOnly')}
      </p>
    </Modal>
  );
}
