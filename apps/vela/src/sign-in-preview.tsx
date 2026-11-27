// Design review of the signed-out flow (/sign-in-preview?state=…): each state the real flow
// reaches, drawn by the real widgets over fixtures, without a server or a plex.tv account.
// Nothing here signs in; every action is inert. Development and mock builds only.
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { HostContext } from '@vela/skin/src/host';
import { Connect, SignedOut, Stage, type AuthActions, type ServerActions, type ServersView, type SessionAuth } from '@vela/skin/src/widgets/auth';
import type { PlexLink } from '@vela/skin/src/widgets/auth/connect/model';
import { useVela } from './vela';

const idle = async () => ({ id: '', error: '' });
const actions: ServerActions = {
  probe: async url => ({ url, state: 'checking', kind: '', kindLabel: '', name: '', version: '', normalizedUrl: '', message: '' }),
  add: idle, select: idle, remove: idle, plexStart: async () => {}, plexChoose: idle, plexChooseProfile: idle,
  plexCancel: () => {}, jellyfinSignIn: idle, jellyfinQuickStart: async () => {}, jellyfinQuickCancel: () => {},
};
const authActions: AuthActions = {
  retry: async () => {}, signInAgain: async () => {}, signIn: async () => ({}), startPlex: async () => {}, cancelPlex: () => {},
  choosePlexProfile: async () => {}, startQuick: async () => ({}), cancelQuick: () => {}, secureSwitch: async () => ({ url: '', error: '' }),
};
const SERVERS = [
  { id: 'den', name: 'The Den', origin: 'https://den.example.net', basePath: '/', kind: 'ether', kindLabel: 'Ether', selected: true, status: 'ready' as const, viewer: 'Braedon', message: '' },
  { id: 'cabin', name: 'Cabin Plex', origin: 'https://cabin.plex.direct', kind: 'plex', kindLabel: 'Plex', selected: false, status: 'signed-out' as const, viewer: '', message: '' },
  { id: 'jelly', name: 'Basement Jellyfin', origin: 'http://192.168.1.20:8096', kind: 'jellyfin', kindLabel: 'Jellyfin', selected: false, status: 'unreachable' as const, viewer: '', message: '' },
];
const CHOICES = [
  { id: 'a', name: 'Ether On Air Lab', owned: true, connectionLabel: 'Local · plex.direct', recommended: true },
  { id: 'b', name: 'Cabin', owned: true, connectionLabel: 'Remote · relay', recommended: false },
  { id: 'c', name: 'Mum’s Plex', owned: false, connectionLabel: 'Shared with you', recommended: false },
];
const PROFILES = [
  { id: 'p1', name: 'Braedon', protected: false }, { id: 'p2', name: 'Alex', protected: true },
  { id: 'p3', name: 'Kids', protected: false, restricted: true }, { id: 'p4', name: 'Guest', protected: false },
];
const REFUSED = 'This Plex account doesn\'t have access to this server. Sign in with the Plex account that owns it, or ask its owner to share it with you.';
const AUTH: SessionAuth = {
  phase: 'signed-out', serverId: 'den', serverKind: 'ether', passwordAvailable: true, plexAvailable: true, quickAvailable: true,
  secureOrigin: '', error: '', quick: null,
};
const link = (state: PlexLink['state'], extra: Partial<PlexLink> = {}): PlexLink => ({ code: '', linkUrl: '', state, choices: [], ...extra });

export default function SignInPreview() {
  const { state = 'welcome' } = useLocalSearchParams<{ state?: string }>();
  // Each state is a fresh flow, as if the viewer had just arrived there.
  return <Preview key={state} state={state} />;
}

function Preview({ state }: { state: string }) {
  const app = useVela();
  const host = app.host('auth', 'auth');
  // Servers found one after another, as plex.tv lists them.
  const [arrived, setArrived] = useState(state === 'plex-arrive' ? 0 : CHOICES.length);
  useEffect(() => {
    if (state !== 'plex-arrive') return;
    const timers = CHOICES.map((_, i) => setTimeout(() => setArrived(i + 1), 2600 + i * 450));
    return () => timers.forEach(clearTimeout);
  }, [state]);
  // Sign in with Plex as a browser does it (Plex's own window), then the server refusing the account.
  const [live, setLive] = useState<Partial<SessionAuth>>({});
  const liveActions = useMemo<AuthActions>(() => ({
    ...authActions,
    startPlex: async () => {
      setLive({ error: '', plex: { code: '', linkUrl: '', state: 'waiting', choices: [] } });
      setTimeout(() => setLive({ plex: null, error: REFUSED }), 2500);
    },
    cancelPlex: () => setLive({}),
  }), []);
  if (!host) return <View style={{ flex: 1 }} />;
  const empty: ServersView = { list: [], selectedId: '', plex: null, jellyfinQuick: null };
  const plex = (value: PlexLink) => ({ ...empty, plex: value });
  const connect = (servers: ServersView, plexLink = false, art?: typeof app.authArt) => (
    <HostContext.Provider value={host}>
      <Stage branding={art}>
        <Connect servers={servers} actions={actions} plexLink={plexLink} brandingName={art?.name} />
      </Stage>
    </HostContext.Provider>
  );
  const signedOut = (auth: Partial<SessionAuth>, art?: typeof app.authArt) => (
    <SignedOut host={host} route={app.doc!.routes.auth!} auth={{ ...AUTH, ...auth, ...live }} actions={liveActions} servers={{ ...empty, list: SERVERS.slice(0, 1), selectedId: 'den' }} serverActions={actions} art={art} />
  );
  switch (state) {
    case 'choose': return connect({ ...empty, list: SERVERS, selectedId: 'den' });
    case 'choose-one': return connect({ ...empty, list: SERVERS.slice(0, 1), selectedId: 'den' });
    case 'plex-pin': return connect(plex(link('waiting', { code: 'K7Q2', linkUrl: 'https://plex.tv/link' })), true);
    case 'plex-finding': return connect(plex(link('linked')), true);
    case 'plex-servers': return connect(plex(link('linked', { choices: CHOICES })), true);
    case 'plex-one': return connect(plex(link('linked', { choices: CHOICES.slice(0, 1) })), true);
    case 'plex-arrive': return connect(plex(link('linked', { choices: CHOICES.slice(0, arrived) })), true);
    case 'plex-profiles': return connect(plex(link('profiles', { profiles: PROFILES })), true);
    case 'plex-expired': return connect(plex(link('expired')), true);
    case 'signin': return signedOut({});
    case 'signin-password': return signedOut({ plexAvailable: false });
    case 'signin-jellyfin': return (
      <HostContext.Provider value={host}><Stage><Connect servers={{ ...empty, list: SERVERS, selectedId: 'jelly' }} actions={actions} serverId="jelly" standaloneSignIn /></Stage></HostContext.Provider>
    );
    case 'code-expired': return signedOut({ quick: { code: '482913', expiresLabel: '8:15 PM', status: 'expired' } });
    case 'error': return signedOut({ error: 'That username or password is not right.' });
    case 'code': return signedOut({ quick: { code: '482913', expiresLabel: '8:15 PM', status: 'pending' } });
    case 'reconnecting': return signedOut({ phase: 'offline', error: 'The server did not answer.', retryAt: Date.now() + 20_000, failures: 2 });
    case 'offline': return signedOut({ phase: 'offline', viewerId: 'v1', retryAt: Date.now() + 20_000, failures: 1 });
    case 'connecting': return signedOut({ phase: 'starting' });
    case 'branded': return signedOut({}, { backdrop: 'assets/skins/cinematic.jpg', wordmark: '', name: 'The Den' });
    default: return connect(empty);
  }
}
