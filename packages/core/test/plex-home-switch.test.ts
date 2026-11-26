// Switching Plex Home members on a directly linked Plex server (no Ether): the account token kept
// beside the server's session lists and switches the Home, and the server's token is read again
// for the new member by the server's machine identifier.
import { afterEach, expect, test } from 'bun:test';
import { PlexAccountRefused } from '../src/adapter/plex/auth';
import { PlexProfileRefusedByServer, PlexProfileWithoutServer, switchPlexServerProfile } from '../src/adapter/plex/home';
import { PlexAdapter } from '../src/adapter/plex';
import { ServerCredentials } from '../src/session/servers';
import { Auth, initialAuth } from '../src/store/auth';
import type { VelaState } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import type { Session } from '../src/store/session';
import { StateBox } from '../src/store/state';
import { MemoryStore, device, restoreFetch, routeFetch, type Seen } from './helpers';

afterEach(restoreFetch);

const origin = 'https://192-168-1-2.abc.plex.direct:32400';
const home = { users: [
  { id: 1, uuid: 'owner', title: 'Owner', admin: true },
  { id: 2, uuid: 'kid', title: 'Kid', restricted: true, protected: true },
  { id: 3, uuid: 'visitor', title: 'Visitor', guest: true },
] };
const resource = (accessToken: string, clientIdentifier = 'machine') => ({ name: 'Plex', clientIdentifier, accessToken, provides: 'server', owned: false,
  connections: [{ uri: 'https://elsewhere.plex.direct:32400', local: false, relay: false, protocol: 'https' }] });
const token = (r: Seen) => r.headers.get('X-Plex-Token');

function plexTv(extra: Record<string, unknown> = {}) {
  return {
    'GET /api/v2/home/users': (r: Seen) => token(r) === 'refused-account' ? new Response('', { status: 401 }) : home,
    'POST /api/v2/home/users/kid/switch': (r: Seen) => r.url.searchParams.get('pin') === '1234' ? { id: 2, uuid: 'kid', title: 'Kid', authToken: 'kid-account' } : new Response('', { status: 401 }),
    'GET /api/v2/resources': (r: Seen) => token(r) === 'kid-account' ? [resource('other-server', 'other'), resource('kid-server')] : [],
    'GET /api/v2/user': (r: Seen) => token(r) === 'kid-account' ? { id: 2, uuid: 'kid', username: 'kid', friendlyName: 'Kid' } : new Response('', { status: 401 }),
    'GET /identity': { MediaContainer: { machineIdentifier: 'machine', version: '1.0' } },
    'GET /': { MediaContainer: { friendlyName: 'Plex' } },
    'GET /library/sections': (r: Seen) => token(r) === 'kid-server' || token(r) === 'owner-server' ? { MediaContainer: { Directory: [] } } : new Response('', { status: 401 }),
    ...extra,
  };
}

test('a switch reads the member\'s token for this server by machine identifier, not address', async () => {
  const seen = routeFetch(plexTv());
  const switched = await switchPlexServerProfile(device, 'owner-account', 'kid', '1234', 'machine', origin);
  expect(switched).toEqual({ accountToken: 'kid-account', tokens: { accessToken: 'kid-server', refreshToken: '', expiresAt: '9999-12-31T23:59:59Z',
    viewer: { id: 'kid', name: 'Kid', policyRevision: 'plex' } } });
  expect(seen.find(r => r.url.pathname.endsWith('/switch'))!.headers.get('X-Plex-Token')).toBe('owner-account');
  expect(seen.find(r => r.url.pathname === '/api/v2/resources')!.headers.get('X-Plex-Token')).toBe('kid-account');
});

test('a member without this server is refused before anything is stored', async () => {
  routeFetch(plexTv());
  await expect(switchPlexServerProfile(device, 'owner-account', 'kid', '1234', 'another-machine', origin)).rejects.toBeInstanceOf(PlexProfileWithoutServer);
});

test('a member token the server turns down never replaces the session', async () => {
  routeFetch(plexTv({ 'GET /library/sections': new Response('', { status: 401 }) }));
  const h = harness('owner-account', 'owner-server');
  await h.ready();
  await h.offered();
  await h.auth.startPlexProfileSwitch();
  await h.auth.choosePlexProfile('kid', '1234');
  expect(h.state().error).toBe(new PlexProfileRefusedByServer().message);
  expect((await h.credentials.get())?.accessToken).toBe('owner-server');
  expect(await h.credentials.plexAccount()).toBe('owner-account');
  expect(h.events).toEqual([]);
});

test('the kept Plex account goes with the server\'s session and touches no other server', async () => {
  const store = new MemoryStore();
  const a = new ServerCredentials(store, device, () => 'k', 'a'), b = new ServerCredentials(store, device, () => 'k', 'b');
  await a.set({ accessToken: 'a-server', refreshToken: '', expiresAt: '9999-12-31T23:59:59Z', viewer: { id: 'o', name: 'O', policyRevision: 'plex' } });
  await a.setPlexAccount('a-account');
  await b.setPlexAccount('b-account');
  expect(await a.plexAccount()).toBe('a-account');
  expect(store.get('vela.server-sessions')).not.toContain('a-account');
  await a.set(null);
  expect(await a.plexAccount()).toBeNull();
  expect(await b.plexAccount()).toBe('b-account');
});

function harness(account: string | null, serverToken = 'owner-account') {
  const store = new MemoryStore();
  const credentials = new ServerCredentials(store, device, () => 'k', 'plex-1');
  const events: string[] = [];
  const adapter = new PlexAdapter({ origin, credentials, clientIdentifier: device.id });
  const connection = { record: { id: 'plex-1', kind: 'plex', origin, basePath: '/', name: 'Plex' }, adapter, credentials };
  const session = { epoch: 1, device, names: new Map(), servers: { standalone: true }, key: () => 'once', onReset() {},
    selected: () => connection, resetSession() { events.push('reset'); this.epoch++; } };
  const box = new StateBox({ auth: { ...initialAuth, phase: 'signed-in', serverId: 'plex-1', serverKind: 'plex', viewer: 'Owner', viewerId: 'owner' } } as VelaState);
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  return { auth, credentials, events, state: () => box.get().auth,
    async ready() {
      await credentials.set({ accessToken: serverToken, refreshToken: '', expiresAt: '9999-12-31T23:59:59Z', viewer: { id: 'owner', name: 'Owner', policyRevision: 'plex' } });
      if (account) await credentials.setPlexAccount(account);
    },
    /** What Auth's refresh would offer once plex.tv has answered. */
    async offered() {
      const ask = () => (auth as unknown as { plexHomePolicy(c: unknown): Promise<{ offered: boolean } | undefined> }).plexHomePolicy(connection);
      await ask();
      await new Promise(resolve => setTimeout(resolve, 0));
      return (await ask())?.offered ?? false;
    },
  };
}

test('a directly linked Plex server switches members and keeps the member\'s account for the next switch', async () => {
  routeFetch(plexTv());
  const h = harness('owner-account', 'owner-server');
  await h.ready();
  expect(await h.offered()).toBe(true);
  expect(h.state().plexHomeAvailable).toBe(true);
  await h.auth.startPlexProfileSwitch();
  // Guests never appear; a protected member is marked for its PIN.
  expect(h.state().plex?.profiles).toEqual([{ id: 'owner', name: 'Owner', protected: false }, { id: 'kid', name: 'Kid', protected: true, restricted: true }]);
  await h.auth.choosePlexProfile('kid', '0000');
  expect(h.state().error).toBe('That Plex Home PIN was not accepted.');
  expect(h.state().plex?.state).toBe('profiles');
  expect(h.events).toEqual([]);
  await h.auth.choosePlexProfile('kid', '1234');
  expect((await h.credentials.get())?.accessToken).toBe('kid-server');
  expect(await h.credentials.plexAccount()).toBe('kid-account');
  expect(h.events).toEqual(['reset']);
  expect(h.state().plexSwitching).toBe(false);
});

test('a server linked before accounts were kept switches with its own token when that is the account\'s', async () => {
  routeFetch(plexTv());
  const h = harness(null);
  await h.ready();
  expect(await h.offered()).toBe(true);
  await h.auth.startPlexProfileSwitch();
  await h.auth.choosePlexProfile('kid', '1234');
  expect(await h.credentials.plexAccount()).toBe('kid-account');
});

test('a shared server\'s own token is not an account: no Switch profile', async () => {
  routeFetch(plexTv());
  const h = harness(null, 'refused-account');
  await h.ready();
  expect(await h.offered()).toBe(false);
});

test('an account plex.tv refuses offers to link Plex again instead of retrying', async () => {
  routeFetch(plexTv());
  const h = harness('refused-account');
  await h.ready();
  expect(await h.offered()).toBe(true);
  h.auth['box'].update('auth', auth => ({ ...auth, plexHomeAvailable: true }));
  await h.auth.startPlexProfileSwitch();
  expect(h.state()).toMatchObject({ plexSwitching: true, plexRelink: true, plex: null, error: new PlexAccountRefused().message });
  h.auth.cancelPlex();
  expect(h.state().plexRelink).toBe(false);
});
