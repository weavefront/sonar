import { useParams } from 'wouter';
import { useT } from '../i18n';
import { isValidAddress } from '../wallet/address';
import { Shell } from './Shell';
import { DriveBrowser } from './DriveBrowser';

/**
 * Landing page for a shared-folder link (`/share/:driveId/:owner/:folderId`) — reachable with no
 * wallet connected at all (see `App.tsx`, which matches this route *before* the normal
 * connect-or-browse gate). `owner` has to travel in the URL itself: ArFS entities are only
 * trustworthy when queried scoped to the real owner's address (`arfs/sync.ts`'s `owners: [owner]`
 * filter is an anti-spoofing measure, not just an optimization), so there's no way to resolve it
 * from `driveId` alone.
 */
export function ShareRoute() {
  const { t } = useT();
  const { driveId, owner, folderId } = useParams<{ driveId: string; owner: string; folderId: string }>();
  // `scope=folder` means "just this folder, no subfolders" — anything else (including absent)
  // means the share includes everything nested inside. Read once; this route only ever loads
  // fresh from a pasted/clicked link, never navigates here with a changing query string in place.
  //
  // Deliberately NOT `window.location.search`: with hash-based routing (see main.tsx), the query
  // string ShareDialog appends lives *inside* the `#` fragment — `.../#/share/x/y/z?scope=folder`
  // — which `location.search` can never see, since that only ever reflects what's before the `#`.
  const hashQuery = window.location.hash.split('?')[1] ?? '';
  const subfoldersHidden = new URLSearchParams(hashQuery).get('scope') === 'folder';

  if (!isValidAddress(owner)) {
    return (
      <Shell>
        <main className="p-8 text-center text-dim">{t('shareRoute.invalid')}</main>
      </Shell>
    );
  }

  return (
    <Shell>
      <DriveBrowser
        driveId={driveId}
        folderId={folderId}
        owner={owner}
        rootFolderId={folderId}
        readOnly
        subfoldersHidden={subfoldersHidden}
      />
    </Shell>
  );
}
