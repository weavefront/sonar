import { useEffect } from 'react';
import { Route, Switch, useParams } from 'wouter';
import { useT } from './i18n';
import { useWallet } from './wallet/store';
import { Connect } from './ui/Connect';
import { Shell } from './ui/Shell';
import { DriveList } from './ui/DriveList';
import { DriveBrowser } from './ui/DriveBrowser';
import { ShareRoute } from './ui/ShareRoute';

function DriveRoute() {
  const { driveId, folderId } = useParams<{ driveId: string; folderId?: string }>();
  return <DriveBrowser driveId={driveId} {...(folderId ? { folderId } : {})} />;
}

export function App() {
  const { address, restore } = useWallet();
  const { t } = useT();

  // Restore a previous session before first paint decisions are made.
  useEffect(() => {
    restore();
  }, [restore]);

  return (
    <Switch>
      {/* A shared-folder link needs no connected wallet, so it has to match before the gate
          below — everything else in the app still requires one. */}
      <Route path="/share/:driveId/:owner/:folderId" component={ShareRoute} />
      <Route>
        {!address ? (
          <Connect />
        ) : (
          <Shell>
            <Switch>
              <Route path="/d/:driveId/:folderId" component={DriveRoute} />
              <Route path="/d/:driveId" component={DriveRoute} />
              <Route path="/" component={DriveList} />
              <Route>
                <main className="p-8 text-center text-dim">{t('app.notFound')}</main>
              </Route>
            </Switch>
          </Shell>
        )}
      </Route>
    </Switch>
  );
}
