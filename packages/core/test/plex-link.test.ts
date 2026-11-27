import { afterEach, expect, test } from 'bun:test';
import { PlexLink } from '../src/adapter/plex/link';
import { device, restoreFetch, routeFetch, tokens, type Seen } from './helpers';

afterEach(restoreFetch);
const origin = 'https://ether.example';
async function linked(options: { ether?: boolean; advertised?: boolean; identity?: string; exchange?: Response } = {}) {
  const seen = routeFetch({
    'POST /api/v2/pins': { id: 1, code: '123', expiresAt: '2099-01-01' },
    'GET /api/v2/pins/1': { authToken: 'account-secret' },
    'GET /api/v2/user': { id: 1, username: 'Viewer' },
    'GET /api/v2/resources': [{ name: 'Ether', clientIdentifier: 'machine', accessToken: 'resource-secret', provides: 'server', owned: true, connections: [{ uri: origin, local: false, relay: false, protocol: 'https' }] }],
    'GET /identity': { MediaContainer: { machineIdentifier: options.identity ?? 'machine' } },
    'GET /vela/v0/capabilities': options.ether === false ? new Response('', { status: 404 }) : { protocolVersion: 0, server: { id: 'server', name: 'Ether' }, features: {}, plexAccountSignIn: options.advertised !== false },
    'POST /vela/v0/auth/plex': options.exchange ?? tokens('vela-secret'),
  });
  const link = new PlexLink(device);
  await link.start();
  expect(await link.poll('123', Date.now())).toBe('linked');
  expect(link.servers('123', true).map(s => s.id)).toEqual(['machine']);
  return { link, seen };
}
const signIn = { device, idempotencyKey: 'exchange-key' };
test('Ether exchanges the account token and returns only Vela credentials', async () => {
  const { link, seen } = await linked();
  const chosen = await link.choose('123', 'machine', true, signIn);
  expect(chosen).toMatchObject({ kind: 'ether', tokens: tokens('vela-secret') });
  expect(chosen.accountToken).toBeUndefined();
  const request = seen.find(r => r.url.pathname === '/vela/v0/auth/plex')!;
  expect(request.body).toEqual({ plexToken: 'account-secret', ...signIn });
  expect(request.headers.has('X-Plex-Token')).toBe(false);
  expect(link.servers('123', true)).toEqual([]);
});
test('ordinary PMS keeps its resource token and never exchanges the account token', async () => {
  const { link, seen } = await linked({ ether: false });
  const chosen = await link.choose('123', 'machine', true, signIn);
  // The account token comes back apart from the server's session, kept only to switch Plex Home members.
  expect(chosen).toMatchObject({ kind: 'plex', tokens: { accessToken: 'resource-secret' }, accountToken: 'account-secret' });
  expect(seen.some(r => r.method === 'POST' && r.url.origin === origin)).toBe(false);
});
test('an identity mismatch never receives a Plex account token', async () => {
  const { link, seen } = await linked({ identity: 'other' });
  await expect(link.choose('123', 'machine', true, signIn)).rejects.toThrow('could not be reached');
  expect(seen.some(r => r.url.pathname === '/vela/v0/auth/plex')).toBe(false);
});
test('older Ether falls back to its own sign-in without exchanging or storing Plex credentials', async () => {
  const { link, seen } = await linked({ advertised: false });
  expect(await link.choose('123', 'machine', true, signIn)).toMatchObject({
    kind: 'ether', origin, name: 'Ether', tokens: null,
    note: 'Plex sign-in needs Ether 0.3.16 or later',
  });
  expect(seen.some(r => r.url.pathname === '/vela/v0/auth/plex')).toBe(false);
  expect(link.servers('123', true)).toEqual([]);
});
for (const [status, message] of [[401, 'Link Plex again'], [403, 'have access to this server'], [429, 'Wait'], [503, 'temporarily unavailable']] as const) {
  test(`exchange ${status} stays in server choice with an actionable error`, async () => {
    const { link } = await linked({ exchange: new Response('private diagnostic', { status }) });
    await expect(link.choose('123', 'machine', true, signIn)).rejects.toThrow(message);
    expect(link.servers('123', true)).toHaveLength(1);
  });
}
test('invalid Vela tokens are never accepted as a session', async () => {
  const { link } = await linked({ exchange: Response.json({ accessToken: 'incomplete' }) });
  await expect(link.choose('123', 'machine', true, signIn)).rejects.toThrow('invalid sign-in response');
});

test('retrying an exchange reuses its idempotency key without linking Plex again', async () => {
  const { link, seen } = await linked({ exchange: new Response('', { status: 503 }) });
  await expect(link.choose('123', 'machine', true, signIn)).rejects.toThrow('temporarily unavailable');
  await expect(link.choose('123', 'machine', true, { ...signIn, idempotencyKey: 'new-key' })).rejects.toThrow('temporarily unavailable');
  const exchanges = seen.filter(r => r.url.pathname === '/vela/v0/auth/plex');
  expect(exchanges.map(r => r.body)).toEqual([{ plexToken: 'account-secret', ...signIn }, { plexToken: 'account-secret', ...signIn }]);
});

test('refreshing a linked account discovers a late server without a new PIN', async () => {
  const { link } = await linked();
  let ready = false;
  const seen = routeFetch({
    'GET /api/v2/resources': () => ready ? [{ name: 'Late Ether', clientIdentifier: 'late', accessToken: 'resource-secret', provides: 'server', owned: true, connections: [{ uri: origin, local: false, relay: false, protocol: 'https' }] }] : [],
    'GET /vela/v0/capabilities': { protocolVersion: 0, server: { id: 'late', name: 'Late Ether' }, features: {} },
  });
  await link.refreshServers('123');
  expect(link.servers('123', true)).toEqual([]);
  ready = true;
  await link.refreshServers('123');
  expect(link.servers('123', true).map(s => s.name)).toEqual(['Late Ether']);
  expect(await link.hasEtherServer('123', true)).toBe(true);
  const reads = seen.filter(r => r.url.pathname === '/api/v2/resources');
  expect(reads.every(r => r.headers.get('X-Plex-Token') === 'account-secret')).toBe(true);
});

// Plex Home: plex.tv lists the Home's members (GET /api/v2/home/users) and switching to one
// (POST /api/v2/home/users/:uuid/switch, with the member's PIN) answers with their own token.
const home = { id: 7, name: 'Home', users: [
  { id: 1, uuid: 'owner-uuid', title: 'Owner', admin: true, protected: false, thumb: 'https://plex.tv/users/owner/avatar' },
  { id: 2, uuid: 'kid-uuid', title: 'Kid', protected: true, restricted: true },
  { id: 3, uuid: 'guest-uuid', title: 'Guest', guest: true },
] };
function homeRoutes(switchAnswer: (pin: string | null) => Response | object) {
  return routeFetch({
    'POST /api/v2/pins': { id: 1, code: '123', expiresAt: '2099-01-01' },
    'GET /api/v2/pins/1': { authToken: 'owner-secret' },
    'GET /api/v2/home/users': home,
    'POST /api/v2/home/users/kid-uuid/switch': (r: Seen) => switchAnswer(r.url.searchParams.get('pin')),
    'GET /api/v2/user': (r: Seen) => ({ id: r.headers.get('X-Plex-Token') === 'kid-secret' ? 2 : 1, uuid: r.headers.get('X-Plex-Token') === 'kid-secret' ? 'kid-uuid' : 'owner-uuid', username: 'u', title: r.headers.get('X-Plex-Token') === 'kid-secret' ? 'Kid' : 'Owner' }),
    'GET /api/v2/resources': (r: Seen) => r.headers.get('X-Plex-Token') === 'kid-secret'
      ? [{ name: 'Shared', clientIdentifier: 'shared', accessToken: 'kid-server-secret', provides: 'server', owned: false, connections: [{ uri: 'https://pms.example', local: false, relay: false, protocol: 'https' }] }]
      : [],
  });
}
test('a Plex Home asks who is signing in before listing servers; guests are not offered', async () => {
  homeRoutes(() => ({}));
  const link = new PlexLink(device);
  await link.start();
  expect(await link.poll('123', Date.now())).toBe('profiles');
  expect(link.profiles('123')).toEqual([
    { id: 'owner-uuid', name: 'Owner', protected: false, avatarUrl: 'https://plex.tv/users/owner/avatar' },
    { id: 'kid-uuid', name: 'Kid', protected: true, restricted: true },
  ]);
  expect(link.servers('123', true)).toEqual([]);
  // Polling again keeps the choice open rather than asking plex.tv anew.
  expect(await link.poll('123', Date.now())).toBe('profiles');
});
test('choosing a protected member sends their PIN and lists that member\'s servers with their token', async () => {
  const seen = homeRoutes(pin => pin === '4321' ? { id: 2, uuid: 'kid-uuid', title: 'Kid', authToken: 'kid-secret' } : new Response('', { status: 403 }));
  const link = new PlexLink(device);
  await link.start();
  await link.poll('123', Date.now());
  await expect(link.chooseProfile('123', 'kid-uuid', '0000')).rejects.toThrow('PIN was not accepted');
  expect(await link.chooseProfile('123', 'kid-uuid', '4321')).toBe('linked');
  const switched = seen.filter(r => r.url.pathname === '/api/v2/home/users/kid-uuid/switch').at(-1)!;
  expect([switched.method, switched.headers.get('X-Plex-Token')]).toEqual(['POST', 'owner-secret']);
  expect(link.servers('123', true).map(s => [s.id, s.owned])).toEqual([['shared', false]]);
  expect(await link.poll('123', Date.now())).toBe('linked');
});
test('an account outside a Home goes straight to its servers', async () => {
  routeFetch({
    'POST /api/v2/pins': { id: 1, code: '123', expiresAt: '2099-01-01' },
    'GET /api/v2/pins/1': { authToken: 'solo' },
    'GET /api/v2/home/users': { users: [{ id: 1, uuid: 'solo-uuid', title: 'Solo' }] },
    'GET /api/v2/user': { id: 1, username: 'Solo' },
    'GET /api/v2/resources': [],
  });
  const link = new PlexLink(device);
  await link.start();
  expect(await link.poll('123', Date.now())).toBe('linked');
});
