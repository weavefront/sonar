import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { useWallet } from '../wallet/store';
import type { GeneratedWallet } from '../wallet/generate';
import { Modal } from './Modal';

type Status = 'generating' | 'ready' | 'error';

/**
 * The ArDrive-style "new user" path: generate a brand-new Arweave wallet entirely in the browser
 * and hand the person either a 12-word recovery phrase or a downloadable key file — no server, no
 * account, matching this app's existing "nothing is ever saved" philosophy for private-drive
 * passwords. Generation starts the instant this opens (see `CreateWalletDialog`'s call site in
 * `Connect.tsx`) rather than behind a second confirmation click, since the button that opened this
 * dialog already *was* the confirmation.
 *
 * Closing is blocked while `status === 'generating'` — real RSA-4096 generation from a mnemonic
 * takes 30 seconds to 2 minutes (see `wallet/generate.ts`), and letting the dialog close mid-flight
 * would silently discard a wallet whose phrase the user never got to see. Once generation finishes
 * (ready or error) closing is unrestricted again — nothing has been adopted into the wallet store
 * yet at that point, so there's nothing destructive about backing out.
 */
export function CreateWalletDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [status, setStatus] = useState<Status>('generating');
  const [wallet, setWallet] = useState<GeneratedWallet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [continuing, setContinuing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { generateWallet } = await import('../wallet/generate');
        const result = await generateWallet();
        if (!cancelled) {
          setWallet(result);
          setStatus('ready');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const copyPhrase = async () => {
    if (!wallet) return;
    try {
      await navigator.clipboard.writeText(wallet.mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked; the phrase is visible below anyway */
    }
  };

  const downloadKeyfile = () => {
    if (!wallet) return;
    const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(wallet.jwk)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'arweave-keyfile.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  };

  const continueToApp = async () => {
    if (!wallet) return;
    setContinuing(true);
    await useWallet.getState().adoptGeneratedWallet(wallet.jwk);
    onClose();
  };

  return (
    <Modal title={t('createWallet.title')} onClose={status === 'generating' ? () => {} : onClose}>
      {status === 'generating' && (
        <div className="py-4 text-center space-y-3">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full animate-pulse"
            style={{ background: 'var(--accent)' }}
          />
          <p className="text-sm">{t('createWallet.generating')}</p>
          <p className="text-xs text-dim">
            {t('createWallet.generatingNote')}
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--danger)' }}>
            {t('createWallet.error', { error: error ?? '' })}
          </p>
          <button
            onClick={onClose}
            className="w-full min-h-10 rounded-lg border border-app surface-2 text-sm font-medium hover:opacity-80"
          >
            {t('common.close')}
          </button>
        </div>
      )}

      {status === 'ready' && wallet && (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-dim mb-1.5">{t('createWallet.phraseLabel')}</p>
            <div className="grid grid-cols-3 gap-1.5 p-3 rounded-lg border border-app surface-2 font-mono text-sm">
              {wallet.mnemonic.split(' ').map((word, i) => (
                <span key={i} className="flex items-baseline gap-1">
                  <span className="text-dim text-xs w-4 text-right shrink-0">{i + 1}</span>
                  {word}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => void copyPhrase()}
              className="flex-1 min-h-10 rounded-lg border border-app surface-2 text-sm font-medium hover:opacity-80"
            >
              {copied ? t('common.copied') : t('createWallet.copyPhrase')}
            </button>
            <button
              onClick={downloadKeyfile}
              className="flex-1 min-h-10 rounded-lg border border-app surface-2 text-sm font-medium hover:opacity-80"
            >
              {t('createWallet.downloadKeyfile')}
            </button>
          </div>

          <p className="text-xs" style={{ color: 'var(--danger)' }}>
            {t('createWallet.warning')}
          </p>

          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            {t('createWallet.confirmSaved')}
          </label>

          <button
            onClick={() => void continueToApp()}
            disabled={!confirmed || continuing}
            className="w-full min-h-11 rounded-lg accent-fill text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {continuing ? t('createWallet.continuing') : t('createWallet.continueToApp')}
          </button>
        </div>
      )}
    </Modal>
  );
}
