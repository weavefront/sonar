import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useT } from '../i18n';
import { useArfs } from '../state/arfs';
import { usePrivateDrives } from '../state/privateDrives';
import { useWallet } from '../wallet/store';
import { formatRelative } from './format';
import { ChevronRight, DriveIcon, LockIcon, PlusIcon, RefreshIcon } from './icons';
import { CreateDriveDialog } from './CreateDriveDialog';
import { PasswordDialog } from './PasswordDialog';
import type { DriveEntity } from '../arfs/types';

export function DriveList() {
  const address = useWallet((s) => s.address)!;
  const canWrite = useWallet((s) => s.canSign);
  const { drives, drivesProgress, loadDrives } = useArfs();
  const { t } = useT();
  const unlockedIds = usePrivateDrives((s) => s.unlocked);
  const [creatingDrive, setCreatingDrive] = useState(false);
  const [unlockingDrive, setUnlockingDrive] = useState<DriveEntity | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    void loadDrives(address);
  }, [address, loadDrives]);

  const syncing = drivesProgress !== null && drivesProgress.phase !== 'done' && drivesProgress.phase !== 'error';
  const publicDrives = drives.filter((d) => d.privacy === 'public');
  const privateDrives = drives.filter((d) => d.privacy === 'private');

  return (
    <main className="mx-auto w-full max-w-3xl px-3 sm:px-5 py-6 sm:py-8">
      <div className="flex items-center gap-3 mb-5">
        <h1 className="text-xl font-semibold">{t('driveList.title')}</h1>
        {syncing && <span className="text-sm text-dim">{t('driveList.searching')}</span>}
        <div className="flex-1" />
        {canWrite && (
          <button
            onClick={() => setCreatingDrive(true)}
            className="flex items-center gap-1.5 text-sm px-3 min-h-9 rounded-lg accent-fill font-medium hover:opacity-90 transition-opacity"
          >
            <PlusIcon className="w-4 h-4" />
            <span className="hidden sm:inline">{t('driveList.newDrive')}</span>
          </button>
        )}
        <button
          onClick={() => void loadDrives(address, true)}
          className="flex items-center gap-1.5 text-sm px-3 min-h-9 rounded-lg border border-app surface-2 hover:opacity-80 transition-opacity"
        >
          <RefreshIcon className="w-4 h-4" />
          <span className="hidden sm:inline">{t('driveList.refresh')}</span>
        </button>
      </div>

      {creatingDrive && <CreateDriveDialog onClose={() => setCreatingDrive(false)} />}
      {unlockingDrive && (
        <PasswordDialog
          drive={unlockingDrive}
          onClose={() => setUnlockingDrive(null)}
          onUnlocked={(entity) => navigate(`/d/${entity.entityId}`)}
        />
      )}

      {drivesProgress?.phase === 'error' && (
        <p role="alert" className="text-sm mb-4" style={{ color: 'var(--danger)' }}>
          {drivesProgress.error}
        </p>
      )}

      {!drives.length && syncing && (
        <ul className="space-y-2" aria-label={t('driveList.loading')}>
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </ul>
      )}

      {!drives.length && !syncing && (
        <div className="surface border border-app rounded-xl p-8 text-center">
          <p className="font-medium">{t('driveList.empty')}</p>
          <p className="text-sm text-dim mt-1">
            {t('driveList.emptyBody')}
          </p>
        </div>
      )}

      {publicDrives.length > 0 && (
        <ul className="space-y-2">
          {publicDrives.map((drive) => (
            <li key={drive.entityId}>
              <Link
                href={`/d/${drive.entityId}`}
                className="surface border border-app rounded-xl p-4 flex items-center gap-3 hover:opacity-85 transition-opacity"
              >
                <span
                  className="grid place-items-center w-10 h-10 rounded-lg shrink-0"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <DriveIcon className="w-5 h-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium truncate">{drive.name}</span>
                  <span className="block text-xs text-dim">
                    {t('driveList.createdWithVersion', {
                      date: formatRelative(drive.unixTime * 1000),
                      version: drive.arFsVersion || '—',
                    })}
                  </span>
                </span>
                <ChevronRight className="w-5 h-5 text-dim shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {privateDrives.length > 0 && (
        <section className="mt-7">
          <h2 className="text-sm font-medium text-dim mb-2">{t('driveList.privateDrives')}</h2>
          <ul className="space-y-2">
            {privateDrives.map((drive) => {
              const unlocked = unlockedIds.has(drive.entityId);
              const onOpen = () => {
                if (!canWrite) return;
                if (unlocked) navigate(`/d/${drive.entityId}`);
                else setUnlockingDrive(drive);
              };
              return (
                <li key={drive.entityId}>
                  <button
                    onClick={onOpen}
                    disabled={!canWrite}
                    className={[
                      'w-full text-left surface border border-app rounded-xl p-4 flex items-center gap-3',
                      canWrite ? 'hover:opacity-85 transition-opacity' : 'opacity-70',
                    ].join(' ')}
                  >
                    <span className="grid place-items-center w-10 h-10 rounded-lg surface-2 text-dim shrink-0">
                      <LockIcon className="w-5 h-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium truncate font-mono text-sm">
                        {unlocked ? drive.name : `${drive.entityId.slice(0, 8)}…`}
                      </span>
                      <span className="block text-xs text-dim">
                        {unlocked
                          ? t('driveList.unlockedCreated', { date: formatRelative(drive.unixTime * 1000) })
                          : t('driveList.encryptedCreated', { date: formatRelative(drive.unixTime * 1000) })}
                      </span>
                    </span>
                    <span
                      className={
                        canWrite
                          ? 'text-xs font-medium rounded-lg px-3 py-1.5 shrink-0 accent-fill'
                          : 'text-xs text-dim border border-app rounded px-2 py-1 shrink-0'
                      }
                    >
                      {canWrite ? (unlocked ? t('driveList.open') : t('driveList.unlock')) : t('driveList.needsSigning')}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-dim mt-2">
            {canWrite
              ? t('driveList.privateHintCanSign')
              : t('driveList.privateHintWatchOnly')}
          </p>
        </section>
      )}
    </main>
  );
}
