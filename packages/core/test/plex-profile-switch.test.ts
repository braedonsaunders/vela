import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { Auth, initialAuth } from '../src/store/auth';
import type { VelaState } from '../src/store';
import type { VelaPlatform } from '../src/store/platform';
import type { Session } from '../src/store/session';
import { StateBox } from '../src/store/state';
import { FakeCredentials, device, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);

function harness(routes: Parameters<typeof routeFetch>[0]) {
  const events: string[] = [];
  const credentials = new FakeCredentials(tokens('old-access', 'owner'));
  const originalSet = credentials.set.bind(credentials);
  credentials.set = async next => { await originalSet(next); events.push(`saved:${next?.viewer.id ?? ''}`); };
  const adapter = new EtherAdapter('https://ether.example', credentials, '');
  const connection = { record: { id: 'ether', kind: 'ether', origin: 'https://ether.example' }, adapter, credentials };
  const session = { epoch: 4, device, names: new Map(), servers: { standalone: false }, key: () => 'once', onReset() {},
    selected: () => connection, resetSession() { events.push('reset'); this.epoch++; } };
  const box = new StateBox({ auth: { ...initialAuth, phase: 'signed-in', serverId: 'ether', serverKind: 'ether', viewer: 'Owner', viewerId: 'owner', plexHomeAvailable: true } } as VelaState);
  const auth = new Auth(box, session as unknown as Session, {} as VelaPlatform);
  const seen = routeFetch(routes);
  return { auth, state: () => box.get().auth, credentials, events, seen };
}

const selection = { selectionToken: 'switch-once', expiresAt: '2099-01-01T00:00:00Z', profiles: [
  { id: 'owner', name: 'Owner', protected: false }, { id: 'kids', name: 'Kids', protected: true },
] };

test('profile switching saves new credentials before rotating the session for viewer-scoped reloads', async () => {
  const next = tokens('new-access', 'kids');
  const h = harness({ 'POST /vela/v0/auth/plex/profiles/challenge': selection, 'POST /vela/v0/auth/plex/profile': next });
  await h.auth.startPlexProfileSwitch();
  expect(h.state()).toMatchObject({ plexSwitching: true, plex: { state: 'profiles', profiles: selection.profiles } });
  await h.auth.choosePlexProfile('kids', '1234');
  expect(h.credentials.current).toEqual(next);
  expect(h.events).toEqual(['saved:kids', 'reset']);
});

test('switching maps profile-selection errors without dropping the current session', async () => {
  const cases = [
    ['invalid_pin', 401, 'That Plex Home PIN was not accepted.', true],
    ['profile_ineligible', 403, 'This Plex Home profile is not available on this server.', true],
    ['selection_consumed', 409, 'This profile selection was already used. Start again.', false],
    ['selection_expired', 410, 'This profile selection expired. Start again.', false],
  ] as const;
  for (const [code, status, expected, retainsSelection] of cases) {
    const response = Response.json({ error: { class: 'auth', code, message: code, retry: { allowed: true } } }, { status });
    const h = harness({ 'POST /vela/v0/auth/plex/profiles/challenge': selection, 'POST /vela/v0/auth/plex/profile': response });
    await h.auth.startPlexProfileSwitch();
    await h.auth.choosePlexProfile('kids', '0000');
    expect(h.state().error).toBe(expected);
    expect(h.state().plex?.state === 'profiles').toBe(retainsSelection);
    expect(h.events).toEqual([]);
  }
});
