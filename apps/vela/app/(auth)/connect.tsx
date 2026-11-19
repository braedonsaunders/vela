// Connect a server (/connect), opened from the profile menu: add a Jellyfin, Emby or Plex
// server, or switch to one of yours. A switch, or a sign-in to the server just added, goes home,
// where a server that still needs a sign-in shows its signed-out page.
import { useVela as useSession, useVelaState } from '@vela/core/react';
import { Connect, Stage } from '@vela/skin/src/widgets/auth';
import { HostContext } from '@vela/skin/src/host';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useVela } from '../../src/vela';

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function ConnectServer() {
  const session = useSession();
  const servers = useVelaState(s => s.servers);
  const auth = useVelaState(s => s.auth);
  const app = useVela();
  const host = app.host('auth', 'connect');
  if (!host) return <View style={{ flex: 1 }} />;
  return (
    <HostContext.Provider value={host}>
      <Stage>
        <Connect servers={servers} actions={session.servers} auth={auth} authActions={session.auth} onClose={leave} />
      </Stage>
    </HostContext.Provider>
  );
}
