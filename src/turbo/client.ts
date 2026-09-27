/**
 * Turbo client construction.
 *
 * Lazy by design: `@ardrive/turbo-sdk/web` pulls in Node-oriented crypto/stream/buffer shims
 * (see `vite.config.ts`), so importing it eagerly would tax every read-only session with weight
 * only a write action needs. This module is never imported from the read path.
 */

import { t } from '../i18n/translate';
import type { WalletState } from '../wallet/store';

export class SigningUnavailableError extends Error {}

/**
 * Build an authenticated Turbo client for the current wallet session.
 *
 * Throws `SigningUnavailableError` for any session that can't sign right now — watch-only, or a
 * restored key-file session whose JWK wasn't kept in memory across the reload. Callers should
 * catch this specifically to prompt "reconnect to enable uploads" rather than show a raw error.
 */
export async function getTurboClient(wallet: Pick<WalletState, 'mode' | 'canSign' | 'jwk'>) {
  if (!wallet.canSign) {
    throw new SigningUnavailableError(
      wallet.mode === 'watch'
        ? t('error.watchOnlySession')
        : t('error.signingUnavailable'),
    );
  }

  const { TurboFactory, ArconnectSigner, ArweaveSigner } = await import('@ardrive/turbo-sdk/web');

  if (wallet.mode === 'wander') {
    if (!window.arweaveWallet) {
      throw new SigningUnavailableError(t('error.extensionGone'));
    }
    // ArconnectSigner ultimately calls the wallet's deprecated signature() API — see the note in
    // wallet/store.ts on WANDER_PERMISSIONS. Constructing the client here can't fail on that; it
    // only surfaces once something actually tries to sign. `explainSigningError` in upload.ts is
    // what turns that failure into a message instead of a stack trace.
    const signer = new ArconnectSigner(window.arweaveWallet);
    return TurboFactory.authenticated({ signer });
  }

  if (wallet.mode === 'keyfile') {
    if (!wallet.jwk) {
      throw new SigningUnavailableError(t('error.keyFileNotLoaded'));
    }
    const signer = new ArweaveSigner(wallet.jwk as never);
    return TurboFactory.authenticated({ signer });
  }

  throw new SigningUnavailableError(t('error.cannotSign'));
}

export type TurboClient = Awaited<ReturnType<typeof getTurboClient>>;
