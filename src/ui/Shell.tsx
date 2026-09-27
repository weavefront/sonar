import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { useT } from '../i18n';
import { useWallet } from '../wallet/store';
import { shortAddress } from '../wallet/address';
import { useArfs } from '../state/arfs';
import { usePrivateDrives } from '../state/privateDrives';
import { LanguagePicker } from './LanguagePicker';
import { ThemeToggle } from './ThemeToggle';
import { TurboBalance } from './TurboBalance';
import { UploadPanel } from './UploadPanel';
import { DownloadPanel } from './DownloadPanel';

export function Shell({ children }: { children: ReactNode }) {
  const { address, mode, disconnect } = useWallet();
  const reset = useArfs((s) => s.reset);
  const { t } = useT();

  return (
    // `h-dvh`, not `min-h-dvh`: the whole point of DriveBrowser's internal scroll areas (the file
    // list, the Details panel) is that THEY scroll while the page itself never grows past the
    // viewport. `min-h-dvh` only sets a floor, not a ceiling — content taller than the viewport
    // just grew the whole page instead of being contained by any of those `overflow-y-auto`
    // areas, which is why selecting a file scrolled deep in a long list opened Details back at
    // the top of the (now taller-than-viewport) page instead of in place. A real height cap here
    // is what makes the `flex-1 min-h-0` chain below actually bound child heights instead of
    // being neutralized by unconstrained growth.
    <div className="h-dvh flex flex-col">
      <header className="sticky top-0 z-20 surface border-b border-app">
        <div className="px-3 sm:px-5 h-14 flex items-center gap-3">
          {/* Byline sits beside the home link, not inside it: it's a link of its own now, and
              an <a> nested in an <a> is invalid HTML with inconsistent click behavior. */}
          <div className="flex items-baseline gap-1.5 shrink-0">
            <Link href="/" className="font-semibold" onClick={() => reset()}>
              <span className="wordmark text-2xl tracking-wide">Sonar</span>
            </Link>
            <span className="text-[11px] text-dim whitespace-nowrap">
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

          <div className="flex-1" />

          <LanguagePicker />
          <ThemeToggle />

          {address && (
            <div className="flex items-center gap-2 min-w-0">
              {mode === 'watch' && (
                <span className="text-[11px] px-1.5 py-0.5 rounded border border-app text-dim shrink-0">
                  {t('shell.watching')}
                </span>
              )}
              <TurboBalance />
              <span className="text-sm font-mono text-dim truncate" title={address}>
                {shortAddress(address)}
              </span>
              <button
                onClick={() => {
                  reset();
                  // Private-drive sessions (password + derived keys) are in-memory only, same as
                  // the key-file JWK — disconnecting clears them rather than leaving them live
                  // under whatever wallet connects next.
                  usePrivateDrives.getState().clear();
                  void disconnect();
                }}
                className="text-sm px-2.5 min-h-9 rounded-lg border border-app surface-2 hover:opacity-80 transition-opacity shrink-0"
              >
                {t('shell.exit')}
              </button>
            </div>
          )}
        </div>
      </header>

      {/* overflow-y-auto here is a fallback for routes with no internal scroll area of their own
          (the plain drive list, the connect screen) — DriveBrowser manages its own scrolling
          internally, so for that route this container's overflow never actually engages. */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">{children}</div>
      {/* `flex-col-reverse`, not `flex-col`: anchoring at bottom-4 means new panels must stack
          *upward* from that fixed point, not downward past it — reverse order does that regardless
          of how many of Upload/DownloadPanel end up rendered at once. */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col-reverse gap-3 items-end">
        <UploadPanel />
        <DownloadPanel />
      </div>
    </div>
  );
}
