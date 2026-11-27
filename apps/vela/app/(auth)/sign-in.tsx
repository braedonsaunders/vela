import { isPlayableDownload } from '@vela/core';
// The signed-out page (/sign-in): the active document's auth route over the selected server's
// sign-in state, or Connect for a signed-out Plex server. Once signed in, home.
import { useVela as useSession, useVelaState } from '@vela/core/react';
import { SignedOut } from '@vela/skin/src/widgets/auth';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { router } from '../../src/router';
import { View } from 'react-native';
import { useVela } from '../../src/vela';
import { safeReturnTo } from '../../src/return-to';

export default function SignIn() {
  const session = useSession();
  const auth = useVelaState(s => s.auth);
  const hasDownloads = useVelaState(s => s.downloads.items.some(isPlayableDownload));
  const servers = useVelaState(s => s.servers);
  const app = useVela();
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  if (auth.phase === 'signed-in') return <Redirect href={safeReturnTo(params.returnTo) as Href} />;
  const host = app.host('auth', 'auth');
  const route = app.doc?.routes.auth;
  if (!host || !route) return <View style={{ flex: 1 }} />;
  return (
    <SignedOut
      host={host}
      route={route}
      auth={auth}
      actions={session.auth}
      servers={servers}
      serverActions={session.servers}
      art={app.authArt}
      onDownloads={hasDownloads ? () => router.push('/downloads') : undefined}
    />
  );
}
