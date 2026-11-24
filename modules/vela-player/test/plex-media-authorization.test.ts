import { afterEach, describe, expect, test } from 'bun:test';
import { PlexAdapter } from '../../../packages/core/src/adapter/plex';
import { randomId } from '../web/engine/random-id';

// The player's media access is type-checked by the web project (DOM fetch); under Bun's types its
// `typeof fetch` members do not compile, so these two are loaded untyped here.
const load = (path: string) => import(path);
const { parseMediaAuthorization } = await load('../web/engine/media-auth');
const { ControllerMediaAccess } = await load('../web/engine/host/controller-access');

const ORIGIN = 'https://192-168-1-20.0123456789abcdef.plex.direct:32400';
const PLATFORMS = ['web', 'ios', 'ipados', 'tvos', 'android', 'androidtv', 'macos', 'windows', 'linux'];

function adapter(platform: string) {
  const device = { id: 'device-1', name: 'Living Room', platform, appVersion: '0.2.60' };
  const tokens = { accessToken: 'server-token', refreshToken: '', expiresAt: '9999-12-31T23:59:59Z', viewer: { id: 'v', name: 'V', policyRevision: 'plex' } };
  return new PlexAdapter({ origin: ORIGIN, clientIdentifier: 'client-1',
    credentials: { device, get: async () => tokens, set: async () => {}, refreshKey: () => 'k' } });
}

// The test shadows the prototype's randomUUID with an own property; removing it restores the real one.
afterEach(() => { delete (crypto as { randomUUID?: unknown }).randomUUID; });

describe('Plex media access in the player', () => {
  // Every player host (web, iOS, Android) refuses a media authorization with a header outside its
  // set, and the web player then never reads a byte of the plan (Vela 0.2.51-0.2.60).
  test('the headers a Plex server hands the player are ones the player accepts, on every platform', async () => {
    for (const platform of PLATFORMS) {
      const headers = await adapter(platform).mediaHeaders();
      const parsed = parseMediaAuthorization(JSON.stringify({ handle: 'h', origin: ORIGIN, pathPrefix: '/', headers }));
      expect(parsed?.headers['X-Plex-Token']).toBe('server-token');
      expect(parsed?.headers['X-Plex-Client-Identifier']).toBe('client-1');
      expect(parsed?.headers['X-Plex-Product']).toBe('Vela');
    }
  });

  // A page opened by LAN address over plain http is not a secure context: randomUUID is absent.
  test('the player takes a server\'s media access on a page without crypto.randomUUID', async () => {
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined });
    const plex = adapter('web');
    const access = new ControllerMediaAccess(() => provider);
    const provider = { handle: 'h', origin: ORIGIN, pathPrefix: '/', headers: () => plex.mediaHeaders(), nativeURL: async (url: string) => url };
    expect(await access.refresh()).toBe(true);
    expect(access.allows(new URL(`${ORIGIN}/video/:/transcode/universal/start.m3u8?session=s`))).toBe(true);
    expect(access.authorization()?.handle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test('random ids are version 4 UUIDs and differ', () => {
    const ids = new Set(Array.from({ length: 64 }, () => randomId()));
    expect(ids.size).toBe(64);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
