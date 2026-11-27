// Choosing a Plex server checks each of its published addresses by reading that address's
// /identity. No token goes to an address before it proves to be the chosen server, and only a
// well-formed address the server publishes is read at all.
import { afterEach, expect, test } from 'bun:test';
import { PlexLink } from '../src/adapter/plex/link';
import { device, restoreFetch, routeFetch, type Seen } from './helpers';

afterEach(restoreFetch);

type Connection = { uri: string; local: boolean; relay: boolean; protocol: string };
const signIn = { device, idempotencyKey: 'k' };
const stale = 'http://192.168.1.50:32400';
const real = 'https://server.example:32400';

async function choosing(connections: Connection[], identity: (origin: string) => string, pageSecure = false) {
  const seen = routeFetch({
    'POST /api/v2/pins': { id: 1, code: '123', expiresAt: '2099-01-01' },
    'GET /api/v2/pins/1': { authToken: 'account-secret' },
    'GET /api/v2/user': { id: 1, username: 'Viewer' },
    'GET /api/v2/resources': [{ name: 'Home', clientIdentifier: 'machine', accessToken: 'resource-secret', provides: 'server', owned: true, connections }],
    'GET /identity': (r: Seen) => ({ MediaContainer: { machineIdentifier: identity(r.url.origin) } }),
    'GET /vela/v0/capabilities': new Response('', { status: 404 }),
  });
  const link = new PlexLink(device);
  await link.start();
  expect(await link.poll('123', Date.now())).toBe('linked');
  const chosen = await link.choose('123', 'machine', pageSecure, signIn).catch((error: Error) => error);
  const toServers = seen.filter(r => r.url.hostname !== 'plex.tv' && !r.url.hostname.endsWith('.plex.tv'));
  return { chosen, toServers };
}

test('an address that answers for another machine never receives the server token', async () => {
  const { chosen, toServers } = await choosing([
    { uri: stale, local: true, relay: false, protocol: 'http' },
    { uri: real, local: false, relay: false, protocol: 'https' },
  ], origin => (origin === stale ? 'someone-else' : 'machine'));
  expect(chosen).toMatchObject({ kind: 'plex', origin: real, tokens: { accessToken: 'resource-secret' } });
  expect(toServers.filter(r => r.url.origin === stale).map(r => r.url.pathname)).toEqual(['/identity']);
  for (const r of toServers) expect(r.headers.has('X-Plex-Token')).toBe(false);
});

test('local, remote and relay addresses each still link', async () => {
  for (const connection of [
    { uri: 'http://192.168.1.20:32400', local: true, relay: false, protocol: 'http' },
    { uri: 'https://192-168-1-20.0123456789abcdef.plex.direct:32400', local: true, relay: false, protocol: 'https' },
    { uri: 'https://203-0-113-7.0123456789abcdef.plex.direct:32400', local: false, relay: false, protocol: 'https' },
    { uri: 'https://198-51-100-9.0123456789abcdef.plex.direct:8443', local: false, relay: true, protocol: 'https' },
  ]) {
    const { chosen, toServers } = await choosing([connection], () => 'machine');
    expect(chosen).toMatchObject({ kind: 'plex', origin: new URL(connection.uri).origin, tokens: { accessToken: 'resource-secret' } });
    expect(toServers.find(r => r.url.pathname === '/identity')!.headers.has('X-Plex-Token')).toBe(false);
  }
});

test('an address whose scheme contradicts its published protocol is never read', async () => {
  const { chosen, toServers } = await choosing([
    { uri: 'http://server.example:32400', local: true, relay: false, protocol: 'https' },
    { uri: real, local: false, relay: false, protocol: 'https' },
  ], () => 'machine');
  expect(chosen).toMatchObject({ origin: real });
  expect(toServers.some(r => r.url.origin === 'http://server.example:32400')).toBe(false);
});
