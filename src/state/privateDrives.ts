/**
 * Private-drive unlock sessions.
 *
 * Same treatment as the M2 key-file JWK: the password and the derived keys live **in memory
 * only**, keyed by drive ID, never written to `localStorage` or IndexedDB. A page reload drops
 * every session — re-opening a private drive means entering its password again. `clear()` is
 * wired into the same UI call sites that already reset wallet/drive state on disconnect (see
 * `ui/Shell.tsx`), not into `wallet/store.ts` itself, to avoid a circular import between the two.
 */

import { t } from '../i18n/translate';
import { create } from 'zustand';
import { deriveDriveKey, deriveFileKey, type DerivedKey } from '../arfs/crypto/kdf';
import { decryptJson, DecryptionFailedError } from '../arfs/crypto/cipher';
import {
  formatTrace,
  resolveDriveSignature,
  SignatureUnavailableError,
  type SignatureTrace,
} from '../arfs/crypto/signature';
import { fetchBinaryBody } from '../arfs/metadata';
import { ArweaveGql, RESILIENT_DATA_GATEWAYS } from '../arfs/gql';
import { useWallet } from '../wallet/store';
import type { DecryptContext } from '../arfs/metadata';
import type { DriveEntity, DriveJson } from '../arfs/types';

interface UnlockedDrive {
  password: string;
  driveKey: DerivedKey;
  fileKeys: Map<string, DerivedKey>;
}

export type UnlockResult =
  | { status: 'ok'; entity: DriveEntity }
  /** `diagnostic` is a compact fact trace of what the unlock actually did — a wrong key and a
      wrong password are cryptographically indistinguishable, so this is the only way to tell
      "you mistyped it" apart from "we derived the key wrong". See `SignatureTrace`. */
  | { status: 'wrong-password'; diagnostic: string }
  | { status: 'error'; message: string; diagnostic: string };

export interface UnlockOptions {
  gql?: ArweaveGql;
  fetchImpl?: typeof fetch;
}

interface PrivateDrivesState {
  unlocked: Map<string, UnlockedDrive>;
  unlocking: Set<string>;
  unlock: (drive: DriveEntity, password: string, opts?: UnlockOptions) => Promise<UnlockResult>;
  isUnlocked: (driveId: string) => boolean;
  /** Undefined for a locked (or never-attempted) drive — callers fall back to the M1 read path. */
  getDecryptContext: (driveId: string) => DecryptContext | undefined;
  /**
   * Register a drive as unlocked without the ciphertext-verification `unlock()` does — for the one
   * case where there's nothing on chain yet to verify against: a private drive this session just
   * created. The password was just typed to create it, so there's nothing to "unlock."
   */
  adoptUnlocked: (driveId: string, password: string, driveKey: DerivedKey) => void;
  lock: (driveId: string) => void;
  clear: () => void;
}

export const usePrivateDrives = create<PrivateDrivesState>((set, get) => ({
  unlocked: new Map(),
  unlocking: new Set(),

  async unlock(drive, password, opts = {}) {
    const trace: SignatureTrace = {};
    const wallet = useWallet.getState();
    // Recorded separately from the drive's own owner: if these two differ, the session is signing
    // with a different wallet than the one the drive was encrypted against, and no password can work.
    trace.walletAddress = wallet.address ?? 'none';
    if (!wallet.canSign) {
      return {
        status: 'error',
        message: t('error.connectToUnlock'),
        diagnostic: formatTrace(trace),
      };
    }
    if (!drive.cipherIv) {
      return {
        status: 'error',
        message: 'This drive is missing its encryption metadata — cannot unlock it.',
        diagnostic: formatTrace(trace),
      };
    }

    set({ unlocking: new Set(get().unlocking).add(drive.entityId) });
    try {
      const gql = opts.gql ?? new ArweaveGql(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {});
      const { signature } = await resolveDriveSignature(drive, wallet, password, gql, opts.fetchImpl, trace);
      const driveKey = await deriveDriveKey(signature, password);

      // The real "is this the right password" check: try decrypting the drive's own metadata.
      // GCM's auth tag makes a wrong key/password fail loudly here rather than downstream.
      // `RESILIENT_DATA_GATEWAYS`, not the default single gateway: a drive's metadata is one
      // irreplaceable transaction, and `arweave.net` has been observed 404ing on one it had
      // already indexed in GraphQL while Turbo's gateway served it fine. Losing that race here
      // makes the drive unopenable, so this fetch tries both.
      const ciphertext = await fetchBinaryBody(drive.metadataTxId, {
        gateways: RESILIENT_DATA_GATEWAYS,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
      trace.metadataFetchedBytes = ciphertext.length;
      const json = await decryptJson<DriveJson>(drive.cipherIv, driveKey, ciphertext);
      trace.metadataDecrypted = true;

      const entity: DriveEntity = {
        ...drive,
        name: json.name ?? drive.name,
        rootFolderId: json.rootFolderId ?? '',
        isHidden: json.isHidden === true,
      };

      const next = new Map(get().unlocked);
      next.set(drive.entityId, { password, driveKey, fileKeys: new Map() });
      set({ unlocked: next });

      return { status: 'ok', entity };
    } catch (err) {
      const diagnostic = formatTrace(trace);
      // Logged as well as returned: the UI shows a compact line, but a full copy-paste-able record
      // in the console is what actually makes a report like this actionable.
      console.warn('[sonar] private drive unlock failed:', diagnostic, err);
      if (err instanceof DecryptionFailedError) return { status: 'wrong-password', diagnostic };
      const message =
        err instanceof SignatureUnavailableError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return { status: 'error', message, diagnostic };
    } finally {
      const stillUnlocking = new Set(get().unlocking);
      stillUnlocking.delete(drive.entityId);
      set({ unlocking: stillUnlocking });
    }
  },

  isUnlocked(driveId) {
    return get().unlocked.has(driveId);
  },

  getDecryptContext(driveId) {
    const session = get().unlocked.get(driveId);
    if (!session) return undefined;
    return {
      driveKey: session.driveKey,
      getFileKey: async (fileId: string) => {
        const cached = session.fileKeys.get(fileId);
        if (cached) return cached;
        const key = await deriveFileKey(session.driveKey, fileId);
        session.fileKeys.set(fileId, key);
        return key;
      },
    };
  },

  adoptUnlocked(driveId, password, driveKey) {
    const next = new Map(get().unlocked);
    next.set(driveId, { password, driveKey, fileKeys: new Map() });
    set({ unlocked: next });
  },

  lock(driveId) {
    const next = new Map(get().unlocked);
    next.delete(driveId);
    set({ unlocked: next });
  },

  clear() {
    set({ unlocked: new Map(), unlocking: new Set() });
  },
}));
