import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useWallet } from '../wallet/store';
import { getTurboClient } from '../turbo/client';
import { getBalance } from '../turbo/upload';
import { formatBalance } from './format';

/**
 * Turbo balance when this session can sign; otherwise a way to enable signing. A restored
 * (page-reload) session is read-only until the user re-proves they can sign — see the note in
 * wallet/store.ts on why the key material is never persisted.
 */
export function TurboBalance() {
  const wallet = useWallet();
  const { t } = useT();
  const [winc, setWinc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!wallet.canSign) {
      setWinc(null);
      return;
    }
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const turbo = await getTurboClient(wallet);
        const balance = await getBalance(turbo);
        if (!cancelled) setWinc(balance.winc);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // wallet.jwk intentionally omitted: identity (mode/address) is what should retrigger this,
    // not every render of the wallet store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.canSign, wallet.mode, wallet.address]);

  if (wallet.mode === 'watch') return null;

  if (wallet.canSign) {
    return (
      <span
        className="text-xs text-dim shrink-0"
        title={error ?? (winc !== null ? `${Number(winc).toLocaleString()} winc` : undefined)}
      >
        {error ? t('turbo.balanceUnavailable') : winc !== null ? formatBalance(winc) : t('turbo.loadingBalance')}
      </span>
    );
  }

  return (
    <>
      {error && (
        <span className="text-xs shrink-0" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
      <button
        onClick={() => {
          setError(null);
          if (wallet.mode === 'wander') void wallet.connectWander();
          else fileRef.current?.click();
        }}
        className="text-xs px-2.5 min-h-8 rounded-lg border border-app surface-2 hover:opacity-80 transition-opacity shrink-0"
      >
        {t('turbo.enableUploads')}
      </button>
      {wallet.mode === 'keyfile' && (
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;

            // A page reload keeps only the address, not the key — re-enabling must be the SAME
            // wallet. Without this check, selecting a different key file here would silently
            // start signing as a different account while still browsing this one's drives.
            const expectedAddress = wallet.address;
            await wallet.connectKeyfile(file);
            if (expectedAddress && useWallet.getState().address !== expectedAddress) {
              setError(t('turbo.wrongKeyFile'));
              useWallet.getState().watchAddress(expectedAddress);
            }
          }}
        />
      )}
    </>
  );
}
