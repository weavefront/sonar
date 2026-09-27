import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useWallet } from '../wallet/store';
import { LockIcon } from './icons';
import { ThemeToggle } from './ThemeToggle';
import { CreateWalletDialog } from './CreateWalletDialog';
import { LanguagePicker } from './LanguagePicker';

export function Connect() {
  const { connectWander, connectKeyfile, watchAddress, connecting, error, hasExtension, detectExtension } =
    useWallet();
  const { t, tParts } = useT();
  const [address, setAddress] = useState('');
  const [creatingWallet, setCreatingWallet] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The extension injects window.arweaveWallet asynchronously, so re-check shortly after mount.
  useEffect(() => {
    const timer = setTimeout(detectExtension, 300);
    window.addEventListener('arweaveWalletLoaded', detectExtension);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('arweaveWalletLoaded', detectExtension);
    };
  }, [detectExtension]);

  return (
    <main className="min-h-dvh flex items-center justify-center p-5">
      <div className="fixed top-4 right-4 flex items-center gap-2">
        <LanguagePicker />
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-7">
          <div className="flex items-baseline gap-1.5">
            <h1 className="text-3xl leading-tight wordmark tracking-wide">Sonar</h1>
            <span className="text-xs text-dim whitespace-nowrap">
              by{' '}
              <a
                href="https://arweave.eth.link/"
                target="_blank"
                rel="noopener noreferrer"
                className="byline-font hover:underline underline-offset-2"
              >
                arweave.eth
              </a>
            </span>
          </div>
          <p className="text-xs text-dim leading-tight mt-1">{t('app.tagline')}</p>
        </div>

        <div className="surface border border-app rounded-xl p-5 space-y-3 mb-4">
          <div>
            <h2 className="font-medium">{t('connect.newToArweave')}</h2>
            <p className="text-sm text-dim mt-1">
              {t('connect.newToArweaveBody')}
            </p>
          </div>
          <button
            onClick={() => setCreatingWallet(true)}
            className="w-full min-h-11 rounded-lg accent-fill font-medium hover:opacity-90 transition-opacity"
          >
            {t('connect.createWallet')}
          </button>
        </div>
        {creatingWallet && <CreateWalletDialog onClose={() => setCreatingWallet(false)} />}

        <div className="surface border border-app rounded-xl p-5 space-y-4">
          <div>
            <h2 className="font-medium">{t('connect.alreadyHaveWallet')}</h2>
            <p className="text-sm text-dim mt-1">
              {t('connect.alreadyHaveWalletBody')}
            </p>
          </div>

          <button
            onClick={connectWander}
            disabled={connecting}
            className="w-full min-h-11 rounded-lg accent-fill font-medium disabled:opacity-60 transition-opacity hover:opacity-90"
          >
            {connecting ? t('connect.connecting') : hasExtension ? t('connect.connectExtension') : t('connect.connectWander')}
          </button>
          {!hasExtension && (
            <p className="text-xs text-dim -mt-2">
              {tParts('connect.noExtension', {
                link: (
                  <a
                    className="underline"
                    style={{ color: 'var(--accent)' }}
                    href="https://www.wander.app"
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    {t('connect.installWander')}
                  </a>
                ),
              })}
            </p>
          )}

          <div className="flex items-center gap-3 text-xs text-dim">
            <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
            {t('common.or')}
            <span className="h-px flex-1" style={{ background: 'var(--border)' }} />
          </div>

          <div className="space-y-2">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={connecting}
              className="w-full min-h-11 rounded-lg border border-app surface-2 font-medium hover:opacity-80 transition-opacity"
            >
              {t('connect.useKeyFile')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void connectKeyfile(file);
                e.target.value = '';
              }}
            />
            <p className="text-xs text-dim">
              {t('connect.keyFileNote')}
            </p>
          </div>

          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              watchAddress(address);
            }}
          >
            <label htmlFor="watch" className="text-sm font-medium block">
              {t('connect.viewAnyAddress')}
            </label>
            <div className="flex gap-2">
              <input
                id="watch"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('connect.addressPlaceholder')}
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                className="flex-1 min-w-0 min-h-11 px-3 rounded-lg border border-app surface-2 text-sm font-mono"
              />
              <button
                type="submit"
                className="min-h-11 px-4 rounded-lg border border-app surface-2 font-medium hover:opacity-80 transition-opacity"
              >
                {t('connect.view')}
              </button>
            </div>
          </form>

          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
              {error}
            </p>
          )}
        </div>

        <p className="text-xs text-dim mt-4 flex items-start gap-2">
          <LockIcon className="w-4 h-4 shrink-0 mt-px" />
          <span>
            {t('connect.privateDrivesNote')}
          </span>
        </p>
      </div>
    </main>
  );
}
