/**
 * Wallet connection.
 *
 * M1 was read-only, and reading ArFS needs nothing but an address — so the key file never left
 * this module; we derived the address and discarded the private key. M2 needs to sign, which
 * changes the trust boundary here in a way worth stating plainly:
 *
 *   - **Wander/ArConnect**: signing happens inside the extension. This app never sees key
 *     material — `ArconnectSigner` (in `turbo/client.ts`) wraps `window.arweaveWallet` directly.
 *     Because the key never passed through here in the first place, a restored session can
 *     silently re-check with the extension (`restoreWanderSigning`, `getPermissions` — a
 *     read-only query, never a prompt) and pick signing back up on its own, no re-click needed,
 *     as long as the extension still has this origin permitted for the same address.
 *   - **Key file**: signing needs the private key, so it is now held **in memory only**, never
 *     written to `localStorage` or IndexedDB. A page reload restores the address (read-only, as
 *     before) but not the key — signing actions require re-selecting the file. That's a real UX
 *     cost, and the deliberate trade for not persisting a private key anywhere: there is nothing
 *     to "silently re-check" here the way there is for Wander, since this app never held
 *     anything past the moment the address was derived.
 *   - **Watch-only**: stays permanently read-only. There is no key to sign with.
 */

import { create } from 'zustand';
import { t } from '../i18n/translate';
import { isValidAddress, jwkToAddress, type Jwk } from './address';

export type WalletMode = 'wander' | 'keyfile' | 'watch';

/**
 * Requested once at connect time, rather than incrementally as write features are used — one
 * permission prompt instead of several.
 *
 * Two independent signers need permissions here, not just one:
 *
 *   - Turbo SDK's `ArconnectSigner` (in `turbo/client.ts`, for public writes/uploads) — pinned by
 *     reading its source directly: it calls `getActivePublicKey()` and `signature()`, nothing else.
 *   - `arfs/crypto/signature.ts`'s `v2Signature` (for unlocking any private drive whose
 *     `Signature-Type` is `2` — which is every drive this app itself creates, per M4) calls
 *     `window.arweaveWallet.signDataItem(...)` directly, which Wander gates behind a *separate*
 *     `SIGN_TRANSACTION` permission — `SIGNATURE` alone does not cover it. Originally omitted here
 *     because the permission list was pinned solely against Turbo's signer before the private-drive
 *     v2 path existed; missing it surfaces as `Missing permission(s) for "signDataItem":
 *     SIGN_TRANSACTION` the moment a v2-signature private drive's password is submitted.
 *     `DISPATCH` is still genuinely unused by anything in this app and stays left out.
 *
 * Worth flagging plainly: `signature()` is the API Wander deprecated in ArConnect 1.0.0 (in favor
 * of `signMessage`/`signDataItem`). It still works during the deprecation window, but Turbo SDK
 * hasn't shipped a replacement signer yet — this is upstream's constraint, not a shortcut taken
 * here. If a user's wallet has since removed it entirely, `connectWander` surfaces that as an
 * explicit error rather than a silent failure (see the signing call site in `turbo/client.ts`).
 */
const WANDER_PERMISSIONS = ['ACCESS_ADDRESS', 'ACCESS_PUBLIC_KEY', 'SIGNATURE', 'SIGN_TRANSACTION'] as const;

// `arconnect` (pulled in transitively by @dha-team/arbundles) already declares
// `Window.arweaveWallet` globally with the real, fully-typed extension API — augmenting it again
// here would conflict (TS requires identical modifiers across merged declarations for the same
// property). We rely on that ambient type instead of declaring our own.
//
// Its type says the property always exists, which is only true once the extension has actually
// injected itself; every access below still checks for it at runtime rather than assuming.

const STORAGE_KEY = 'swiftdrive:wallet';

interface Persisted {
  address: string;
  mode: WalletMode;
}

function persist(value: Persisted | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage may be unavailable; session-only connection still works */
  }
}

function readPersisted(): Persisted | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    return isValidAddress(parsed.address) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The extension injects `window.arweaveWallet` asynchronously after the page has already started
 * loading, so a fresh reload can race it — `Connect.tsx` already waits for the same
 * `arweaveWalletLoaded` event for its own "is an extension installed" check; this waits for it too
 * rather than giving up on a session restore just because the check ran a few hundred ms too early.
 */
function waitForExtension(timeoutMs = 2000): Promise<Window['arweaveWallet'] | undefined> {
  if (window.arweaveWallet) return Promise.resolve(window.arweaveWallet);
  return new Promise((resolve) => {
    const onLoaded = () => {
      cleanup();
      resolve(window.arweaveWallet);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(window.arweaveWallet);
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener('arweaveWalletLoaded', onLoaded);
    }
    window.addEventListener('arweaveWalletLoaded', onLoaded);
  });
}

/** A locked extension can leave `getPermissions`/`getActiveAddress` hanging rather than
    rejecting — this is a pure optimistic upgrade, so it must never be able to hang the app. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** The raw parsed key file. Never persisted — see the module comment above. */
export type FullJwk = Jwk & Record<string, unknown>;

export interface WalletState {
  address: string | null;
  mode: WalletMode | null;
  connecting: boolean;
  error: string | null;
  hasExtension: boolean;
  /** In-memory only. Present only in 'keyfile' mode, and only for the current session. */
  jwk: FullJwk | null;
  /** True once this session can actually sign — false right after a restored (reload) session. */
  canSign: boolean;
  connectWander: () => Promise<void>;
  connectKeyfile: (file: File) => Promise<void>;
  /** Adopts a freshly-generated wallet (see `wallet/generate.ts`) exactly like an uploaded key
      file — same in-memory-only `jwk`, same `mode: 'keyfile'`, same reload behavior. */
  adoptGeneratedWallet: (jwk: FullJwk) => Promise<void>;
  watchAddress: (address: string) => void;
  disconnect: () => Promise<void>;
  restore: () => void;
  /** Best-effort, silent upgrade from a restored (read-only) Wander session back to a signing one
      — see the module doc comment. A no-op for every other mode. Called automatically by
      `restore()`; exposed separately so it can also be retried (e.g. from a "Reconnect" affordance)
      without re-deriving the address from scratch. */
  restoreWanderSigning: () => Promise<void>;
  detectExtension: () => void;
}

export const useWallet = create<WalletState>((set, get) => {
  // Shared by `connectKeyfile` and `adoptGeneratedWallet` — both end up holding a raw JWK and
  // need identical resulting state: derive the address, mark the session signing-capable, keep
  // the key in memory only, and persist just the address+mode, never the key itself.
  async function adoptJwk(jwk: FullJwk) {
    const address = await jwkToAddress(jwk);
    set({ address, mode: 'keyfile', connecting: false, canSign: true, jwk });
    persist({ address, mode: 'keyfile' });
  }

  return {
    address: null,
    mode: null,
    connecting: false,
    error: null,
    hasExtension: typeof window !== 'undefined' && Boolean(window.arweaveWallet),
    jwk: null,
    canSign: false,

    detectExtension() {
      set({ hasExtension: typeof window !== 'undefined' && Boolean(window.arweaveWallet) });
    },

    async connectWander() {
      set({ connecting: true, error: null });
      try {
        const api = window.arweaveWallet;
        if (!api) throw new Error(t('error.noExtension'));
        // Idempotent: if permissions were already granted (e.g. re-enabling after a reload), the
        // extension does not re-prompt.
        await api.connect([...WANDER_PERMISSIONS], { name: 'Sonar' });
        const address = await api.getActiveAddress();
        if (!isValidAddress(address)) throw new Error('Wallet returned an unrecognised address.');
        set({ address, mode: 'wander', connecting: false, canSign: true, jwk: null });
        persist({ address, mode: 'wander' });
      } catch (err) {
        set({ connecting: false, error: err instanceof Error ? err.message : String(err) });
      }
    },

    async connectKeyfile(file: File) {
      set({ connecting: true, error: null });
      try {
        const jwk = JSON.parse(await file.text()) as FullJwk;
        await adoptJwk(jwk);
      } catch (err) {
        set({
          connecting: false,
          error: err instanceof Error ? t('error.readKeyFile', { message: err.message }) : String(err),
        });
      }
    },

    async adoptGeneratedWallet(jwk: FullJwk) {
      await adoptJwk(jwk);
    },

    watchAddress(address: string) {
      const trimmed = address.trim();
      if (!isValidAddress(trimmed)) {
        set({ error: t('error.badAddress') });
        return;
      }
      set({ address: trimmed, mode: 'watch', error: null, canSign: false, jwk: null });
      persist({ address: trimmed, mode: 'watch' });
    },

    async disconnect() {
      if (get().mode === 'wander') await window.arweaveWallet?.disconnect().catch(() => undefined);
      set({ address: null, mode: null, error: null, canSign: false, jwk: null });
      persist(null);
    },

    restore() {
      const saved = readPersisted();
      if (!saved) return;
      // The key material (a key file's JWK) is never restored, so a reloaded key-file session
      // stays read-only until the user re-selects the file. Wander is different — see
      // `restoreWanderSigning`, fired automatically right below for that one mode.
      set({ address: saved.address, mode: saved.mode, canSign: false, jwk: null });
      if (saved.mode === 'wander') void get().restoreWanderSigning();
    },

    async restoreWanderSigning() {
      const { mode, address } = get();
      if (mode !== 'wander' || !address) return;

      const api = await waitForExtension();
      if (!api) return; // extension not installed (or slow enough to miss the wait) — stay read-only

      try {
        const granted = await withTimeout(api.getPermissions(), 5000);
        const hasAllPermissions = WANDER_PERMISSIONS.every((p) => granted.includes(p));
        if (!hasAllPermissions) return;

        // The extension can be unlocked with a *different* account active than the one this
        // session is showing (switched since last visit, or a shared machine) — silently signing
        // as whichever account happens to be active, instead of the one on screen, would be a
        // real correctness problem, not just an inconvenience. Only restore if they still match.
        const activeAddress = await withTimeout(api.getActiveAddress(), 5000);
        if (activeAddress === address) set({ canSign: true });
      } catch {
        /* locked extension, user dismissed an unlock prompt, timed out, etc. — stay read-only;
           the existing "Enable uploads" affordance still works as a manual fallback */
      }
    },
  };
});
