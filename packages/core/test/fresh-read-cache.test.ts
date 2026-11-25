// A fresh read must reach the server with no validator, whatever HTTP cache sits under fetch. On
// Android the native fetch runs on OkHttp with React Native's 10 MB disk cache: a plain GET whose
// earlier answer carried an ETag is revalidated by OkHttp itself, and the server's 304 comes back
// to us as the OLD 200 body. That kept an expired row id after playback (0.2.68, Android TV).
import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { FakeCredentials, restoreFetch } from './helpers';

afterEach(restoreFetch);

const ORIGIN = 'https://ether.example';

/** An Ether whose bootstrap names its rows by snapshot and answers 304 to its current ETag. */
class Server {
  snapshot = 1;
  seen: { path: string; headers: Headers }[] = [];
  answer(path: string, headers: Headers): Response {
    this.seen.push({ path, headers });
    const etag = `"home-${this.snapshot}"`;
    if (headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
    const body = { viewer: { id: 'v', name: 'Viewer' }, heroes: [], capabilities: { skins: [], features: {} }, rows: [{ id: `new@${this.snapshot}` }] };
    return Response.json(body, { headers: { ETag: etag, 'Cache-Control': 'private, no-cache' } });
  }
}

type Platform = 'okhttp' | 'browser';

/**
 * The platform's own HTTP cache in front of `server`. OkHttp (Android) knows only request headers:
 * Cache-Control no-cache or no-store skip its store. The browser also honours `cache`. Both store
 * 200s with an ETag and revalidate a plain GET with it, answering a 304 with the stored body.
 */
function platformFetch(server: Server, platform: Platform) {
  const store = new Map<string, { etag: string; body: string }>();
  const fake = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const headers = new Headers(init.headers);
    const directive = `${headers.get('cache-control') ?? ''},${headers.get('pragma') ?? ''}`;
    const bypass = /no-cache|no-store/i.test(directive) || (platform === 'browser' && ['no-store', 'no-cache', 'reload'].includes(init.cache ?? ''));
    const noStore = /no-store/i.test(directive) || (platform === 'browser' && init.cache === 'no-store');
    const stored = bypass ? undefined : store.get(url.href);
    const ownConditional = headers.has('if-none-match');
    if (stored && !ownConditional) headers.set('If-None-Match', stored.etag);
    const response = server.answer(url.pathname, headers);
    if (response.status === 304 && stored && !ownConditional) return new Response(stored.body, { status: 200, headers: { ETag: stored.etag } });
    const etag = response.headers.get('etag');
    if (response.status === 200 && etag && !noStore) {
      const body = await response.clone().text();
      store.set(url.href, { etag, body });
    }
    return response;
  };
  globalThis.fetch = Object.assign(fake, { preconnect: () => {} }) as typeof fetch;
  return store;
}

for (const platform of ['okhttp', 'browser'] as const) {
  test(`a fresh Home read is never revalidated by the platform cache (${platform})`, async () => {
    const server = new Server();
    platformFetch(server, platform);
    const adapter = new EtherAdapter(ORIGIN, new FakeCredentials(), 'web-1');
    expect((await adapter.home()).rows[0]!.id).toBe('new@1');
    // Playback: the server re-mints the row ids.
    server.snapshot = 2;
    server.seen = [];
    const fresh = await adapter.home(true);
    expect(fresh.rows[0]!.id).toBe('new@2');
    expect(server.seen).toHaveLength(1);
    const sent = server.seen[0]!.headers;
    expect(sent.has('if-none-match')).toBe(false);
    expect(sent.get('cache-control')).toBe('no-cache, no-store');
    expect(sent.get('pragma')).toBe('no-cache');
  });

  test(`a fresh page of Home rows reads past the platform cache too (${platform})`, async () => {
    const server = new Server();
    const seen: Headers[] = [];
    const store = platformFetch(server, platform);
    const real = globalThis.fetch;
    globalThis.fetch = Object.assign(async (input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return real(input, init);
    }, { preconnect: () => {} }) as typeof fetch;
    const adapter = new EtherAdapter(ORIGIN, new FakeCredentials(), 'web-1');
    await adapter.rows({ cursor: 'c', placement: 'home' }, true);
    expect(seen[0]!.get('cache-control')).toBe('no-cache, no-store');
    expect(store.size).toBe(0);
  });
}

test('an ordinary Home read still revalidates with its own ETag and no cache directive', async () => {
  const server = new Server();
  platformFetch(server, 'okhttp');
  const adapter = new EtherAdapter(ORIGIN, new FakeCredentials(), 'web-1');
  await adapter.home();
  await adapter.home();
  // The second plain read revalidated with the transport's own ETag and kept its answer.
  expect(server.seen[1]!.headers.get('if-none-match')).toBe('"home-1"');
  expect(server.seen[1]!.headers.has('cache-control')).toBe(false);
});
