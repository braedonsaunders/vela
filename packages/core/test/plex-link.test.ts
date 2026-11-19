import { afterEach, expect, test } from 'bun:test';
import { PlexLink } from '../src/adapter/plex/link';
import { device, restoreFetch, routeFetch, tokens } from './helpers';

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
  const link = new PlexLink('client');
  await link.start();
  expect(await link.poll('123', Date.now())).toBe('linked');
  expect(link.servers('123', true).map(s => s.id)).toEqual(['machine']);
  return { link, seen };
}
const signIn = { device, idempotencyKey: 'exchange-key' };
test('Ether exchanges the account token and returns only Vela credentials', async () => {
  const { link, seen } = await linked();
  expect(await link.choose('123', 'machine', true, signIn)).toMatchObject({ kind: 'ether', tokens: tokens('vela-secret') });
  const request = seen.find(r => r.url.pathname === '/vela/v0/auth/plex')!;
  expect(request.body).toEqual({ plexToken: 'account-secret', ...signIn });
  expect(request.headers.has('X-Plex-Token')).toBe(false);
  expect(link.servers('123', true)).toEqual([]);
});
test('ordinary PMS keeps its resource token and never exchanges the account token', async () => {
  const { link, seen } = await linked({ ether: false });
  expect(await link.choose('123', 'machine', true, signIn)).toMatchObject({ kind: 'plex', tokens: { accessToken: 'resource-secret' } });
  expect(seen.some(r => r.method === 'POST' && r.url.origin === origin)).toBe(false);
});
test('an identity mismatch never receives a Plex account token', async () => {
  const { link, seen } = await linked({ identity: 'other' });
  await expect(link.choose('123', 'machine', true, signIn)).rejects.toThrow('could not be reached');
  expect(seen.some(r => r.url.pathname === '/vela/v0/auth/plex')).toBe(false);
});
test('older Ether cannot silently become an authenticated PMS session', async () => {
  const { link } = await linked({ advertised: false });
  await expect(link.choose('123', 'machine', true, signIn)).rejects.toThrow('enable Sign in with Plex');
});
for (const [status, message] of [[401, 'Link Plex again'], [403, 'share this server'], [429, 'Wait'], [503, 'temporarily unavailable']] as const) {
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
