// The signed-out page (/sign-in): the active document's auth route over the selected server's
// sign-in state, or Connect for a signed-out Plex server. Once signed in, home.
import { useVela as useSession, useVelaState } from '@vela/core/react';
import { SignedOut } from '@vela/skin/src/widgets/auth';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useVela } from '../../src/vela';

export default function SignIn() {
  const session = useSession();
  const auth = useVelaState(s => s.auth);
  const servers = useVelaState(s => s.servers);
  const app = useVela();
  if (auth.phase === 'signed-in') return <Redirect href="/" />;
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
    />
  );
}
