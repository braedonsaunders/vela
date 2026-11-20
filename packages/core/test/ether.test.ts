import { afterEach, describe, expect, test } from 'bun:test';
import { refreshIdempotencyKey } from '../src/adapter/ether/transport';
import { EtherAdapter } from '../src/adapter/ether';
import { VelaError } from '../src/adapter/errors';
import { FakeCredentials, restoreFetch, routeFetch, tokens } from './helpers';

afterEach(restoreFetch);

const ORIGIN = 'https://ether.example';
const ether = (credentials = new FakeCredentials(), onRejected?: () => void) => new EtherAdapter(ORIGIN, credentials, 'web-1', onRejected);
const searchAnswer = { query: 'heat', generation: 1, items: [], continuation: 'exhausted' };

describe('EtherAdapter', () => {
  test('versions routes preserve opaque handles and command generations', async () => {
    const answer = { titleId: 'movie/1', selectedVersionId: 'opaque-v2', versions: [{ id: 'opaque-v2', label: '4K Remux', recommended: true, availability: 'instant' }] };
    const plan = { sessionId: 'session/1', sourceGeneration: 2, seekGeneration: 3, selectedVersionId: 'opaque-v2' };
    const seen = routeFetch({
      'GET /vela/v0/titles/movie%2F1/versions': answer,
      'DELETE /vela/v0/titles/movie%2F1/versions/choice': { ...answer, cleared: true },
      'POST /vela/v0/sessions/session%2F1/commands': plan,
    });
    const adapter = ether();
    expect((await adapter.titleVersions('movie/1')).selectedVersionId).toBe('opaque-v2');
    await adapter.clearVersionChoice('movie/1', { scope: 'show', idempotencyKey: 'clear-1' });
    await adapter.switchVersion('session/1', { kind: 'version', versionId: 'opaque-v2', positionSeconds: 42, sourceGeneration: 1, seekGeneration: 1, idempotencyKey: 'switch-1' });
    expect(seen.map(call => [call.method, call.url.pathname])).toEqual([
      ['GET', '/vela/v0/titles/movie%2F1/versions'], ['DELETE', '/vela/v0/titles/movie%2F1/versions/choice'], ['POST', '/vela/v0/sessions/session%2F1/commands'],
    ]);
    expect(seen[1]!.body).toEqual({ scope: 'show', idempotencyKey: 'clear-1' });
    expect(seen[2]!.body).toMatchObject({ kind: 'version', versionId: 'opaque-v2', positionSeconds: 42, sourceGeneration: 1, seekGeneration: 1 });
  });
  test('unsupported routes are probed only once per session', async () => {
    const seen = routeFetch({
      'GET /vela/v0/libraries/l1/collections': new Response('', { status: 405 }),
      'GET /vela/v0/titles/first': { title: { id: 'first' }, cast: [{ id: 'p1', name: 'Person' }] },
      'GET /vela/v0/titles/second': { title: { id: 'second' }, cast: [{ id: 'p1', name: 'Person' }] },
      'GET /vela/v0/people/p1': new Response('', { status: 405 }),
    });
    const adapter = ether();
    await adapter.probeLibraryViews('l1'); await adapter.probeLibraryViews('l1');
    await adapter.detail('first'); await adapter.detail('second');
    expect(seen.filter(call => call.url.pathname.endsWith('/collections'))).toHaveLength(1);
    expect(seen.filter(call => call.url.pathname.endsWith('/people/p1'))).toHaveLength(1);
    expect(adapter.supportsPersonFilmography).toBe(false);
    expect(adapter.supportsLibraryRecommendations).toBe(false);
  });
  test('an unknown person does not disable person support for later credits', async () => {
    const notFound = Response.json({ error: { class: 'not-found', code: 'not_found', message: 'Unknown person', retry: { allowed: false } } }, { status: 404 });
    routeFetch({
      'GET /vela/v0/titles/first': { title: { id: 'first' }, cast: [{ id: 'missing', name: 'Missing' }, { id: 'known', name: 'Known' }] },
      'GET /vela/v0/people/missing': notFound,
      'GET /vela/v0/titles/second': { title: { id: 'second' }, cast: [{ id: 'known', name: 'Known' }] },
      'GET /vela/v0/people/known': { id: 'known', name: 'Known', photo: null, roles: [], knownFor: '' },
      'GET /vela/v0/people/known/titles': { items: [], continuation: 'exhausted' },
    });
    const adapter = ether();
    await adapter.detail('first');
    expect(adapter.supportsPersonFilmography).toBe(true);
    await adapter.detail('second');
    expect(adapter.supportsPersonFilmography).toBe(true);
  });
  test('search posts the fast and descriptive modes under /vela/v0 with bearer and device', async () => {
    const seen = routeFetch({ 'POST /vela/v0/search': searchAnswer });
    const adapter = ether();
    await adapter.search({ query: 'heat', generation: 1, idempotencyKey: 'k1' });
    await adapter.searchByDescription({ query: 'heat', generation: 1, idempotencyKey: 'k2' });
    expect(seen.map(s => s.body)).toEqual([
      { query: 'heat', generation: 1, idempotencyKey: 'k1', mode: 'fast' },
      { query: 'heat', generation: 1, idempotencyKey: 'k2', mode: 'descriptive' },
    ]);
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer token-1');
    expect(seen[0]!.headers.get('x-vela-device-id')).toBe('device-test');
    expect(seen[0]!.headers.get('content-type')).toBe('application/json');
  });

  test('queries drop undefined values, encode path segments and join channel ids', async () => {
    const seen = routeFetch({
      'GET /vela/v0/live/guide': { items: [], continuation: 'exhausted', from: 'a', until: 'b' },
      'GET /vela/v0/titles/a%2Fb': { title: {} },
    });
    const adapter = ether();
    await adapter.guide({ from: '2026-03-10T00:00:00Z', until: '2026-03-11T00:00:00Z', channelIds: ['c1', 'c 2'] });
    expect(seen[0]!.url.search).toBe('?from=2026-03-10T00%3A00%3A00Z&until=2026-03-11T00%3A00%3A00Z&channelIds=c1%2Cc%202');
    await adapter.detail('a/b');
    expect(seen[1]!.url.pathname).toBe('/vela/v0/titles/a%2Fb');
  });

  test('library live list and play preserve the agreed route and wire fields', async () => {
    const list = { library: { id: 'creator' }, items: [{ id: 's1', title: 'Finals', live: true, artwork: [] }], filters: [{ key: 'featured', label: 'Featured' }], continuation: 'exhausted' };
    const plan = { sessionId: 'live-session', libraryId: 'creator', liveItemId: 's1', live: { mode: 'adaptive' } };
    const seen = routeFetch({
      'GET /vela/v0/libraries/creator/live': list,
      'POST /vela/v0/libraries/creator/live/play': plan,
    });
    const adapter = ether();
    expect(await adapter.libraryLive('creator', { tab: 'live-now', query: 'finals', filter: 'featured', cursor: 'next', limit: 50 })).toEqual(list as never);
    expect(await adapter.startLibraryLive('creator', { itemId: 's1', tab: 'live-now', liveMode: 'adaptive', client: {} as never, idempotencyKey: 'play-live' })).toEqual(plan as never);
    expect(Object.fromEntries(seen[0]!.url.searchParams)).toEqual({ tab: 'live-now', query: 'finals', filter: 'featured', cursor: 'next', limit: '50' });
    expect(seen[1]!.body).toMatchObject({ itemId: 's1', tab: 'live-now', liveMode: 'adaptive', idempotencyKey: 'play-live' });
  });

  test('an expired library cursor restarts the Smart View from page one', async () => {
    const first = { library: { id: 'videos' }, items: [], sort: 'lastViewed', direction: 'desc', continuation: 'more', nextCursor: 'fresh' };
    const seen = routeFetch({ 'GET /vela/v0/libraries/videos/items': (request: { url: URL }) => request.url.searchParams.has('cursor')
      ? Response.json({ error: { class: 'conflict', code: 'cursor_expired', message: 'Restart', retry: { allowed: false } } }, { status: 409 })
      : first });
    expect(await ether().library('videos', { tab: 'history', sort: 'lastViewed', direction: 'desc', cursor: 'expired', limit: 100 })).toEqual(first as never);
    expect(seen.map(call => Object.fromEntries(call.url.searchParams))).toEqual([
      { tab: 'history', sort: 'lastViewed', direction: 'desc', cursor: 'expired', limit: '100' },
      { tab: 'history', sort: 'lastViewed', direction: 'desc', limit: '100' },
    ]);
    expect(seen[1]!.headers.has('if-none-match')).toBe(false);
  });

  test('artwork refresh skips the old ETag and replaces the cached bootstrap grants', async () => {
    let calls = 0;
    const seen = routeFetch({ 'GET /vela/v0/bootstrap': () => {
      calls++;
      return calls === 3 ? new Response(null, { status: 304 })
        : Response.json({ heroes: [{ artwork: calls === 1 ? 'expired' : 'fresh' }] }, { headers: { ETag: `"${calls}"` } });
    } });
    const adapter = ether();
    await adapter.home();
    const fresh = await adapter.home(true);
    expect(seen[1]!.headers.has('if-none-match')).toBe(false);
    expect(await adapter.home()).toEqual(fresh);
    expect(seen[2]!.headers.get('if-none-match')).toBe('"2"');
  });

  test('cacheable answers are revalidated with their ETag and reused on 304', async () => {
    let calls = 0;
    const seen = routeFetch({ 'GET /vela/v0/live/channels': () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ items: [{ id: 'c1' }], continuation: 'exhausted' }), { headers: { ETag: '"v1"', 'Content-Type': 'application/json' } })
        : new Response(null, { status: 304 });
    } });
    const adapter = ether();
    const first = await adapter.channels();
    const second = await adapter.channels();
    expect(seen[0]!.headers.has('if-none-match')).toBe(false);
    expect(seen[1]!.headers.get('if-none-match')).toBe('"v1"');
    expect(second).toEqual(first);
    // A new client declaration changes what the server answers: the cache is dropped.
    adapter.setCapabilityContext('web-2');
    routeFetch({ 'GET /vela/v0/live/channels': (r: { headers: Headers }) => { expect(r.headers.has('if-none-match')).toBe(false); return { items: [], continuation: 'exhausted' }; } });
    expect((await adapter.channels()).items).toEqual([]);
  });

  test('a no-store answer is never kept', async () => {
    const seen = routeFetch({ 'GET /vela/v0/titles/t1': () => new Response(JSON.stringify({ partial: true }), { headers: { ETag: 'W/"p"', 'Cache-Control': 'private, no-store' } }) });
    const adapter = ether();
    await adapter.detail('t1');
    await adapter.detail('t1');
    expect(seen[1]!.headers.has('if-none-match')).toBe(false);
  });

  test('a 401 rotates the tokens once and resends', async () => {
    const credentials = new FakeCredentials(tokens('old'));
    const rotated = tokens('new');
    const seen = routeFetch({
      'GET /vela/v0/libraries': (r: { headers: Headers }) => r.headers.get('authorization') === 'Bearer new'
        ? { items: [], continuation: 'exhausted' }
        : new Response('', { status: 401 }),
      'POST /vela/v0/auth/refresh': rotated,
    });
    await ether(credentials).libraries({});
    expect(seen.map(s => `${s.method} ${s.url.pathname}`)).toEqual(['GET /vela/v0/libraries', 'POST /vela/v0/auth/refresh', 'GET /vela/v0/libraries']);
    expect(seen[1]!.body).toEqual({ refreshToken: 'old', device: credentials.device, idempotencyKey: refreshIdempotencyKey('old') });
    expect(seen[1]!.headers.has('authorization')).toBe(false);
    expect(credentials.current).toEqual(rotated);
  });

  test('a refused refresh ends the session', async () => {
    const credentials = new FakeCredentials();
    let rejected = 0;
    routeFetch({
      'GET /vela/v0/libraries': new Response('', { status: 401 }),
      'POST /vela/v0/auth/refresh': Response.json({ error: { class: 'auth', code: 'invalid_refresh', message: 'Refresh invalid', retry: { allowed: false } } }, { status: 401 }),
    });
    const error = await ether(credentials, () => rejected++).libraries({}).catch(e => e);
    expect(error).toBeInstanceOf(VelaError);
    expect(error.detail.code).toBe('invalid_refresh');
    expect(credentials.current).toBeNull();
    expect(rejected).toBe(1);
  });

  test('protocol errors keep their detail and Retry-After', async () => {
    routeFetch({ 'POST /vela/v0/playback': Response.json(
      { error: { class: 'capacity', code: 'capacity_exhausted', message: 'Busy', retry: { allowed: true, afterSeconds: 3 } } },
      { status: 503, headers: { 'Retry-After': '3' } },
    ) });
    const error = await ether().startPlayback({ titleId: 't', idempotencyKey: 'k' } as never).catch(e => e);
    expect(error).toMatchObject({ status: 503, retryAfter: '3', message: 'Busy', detail: { class: 'capacity', code: 'capacity_exhausted' } });
  });

  test('a body that is not a protocol error becomes a transient failure', async () => {
    routeFetch({ 'GET /vela/v0/live/channels': new Response('<html>bad gateway</html>', { status: 502 }) });
    const error = await ether().channels().catch(e => e);
    expect(error).toMatchObject({ status: 502, detail: { class: 'transient', code: 'http_error', message: 'Server returned 502' } });
  });

  test('a home whose cursor expired is read again without revalidation', async () => {
    let calls = 0;
    const seen = routeFetch({ 'GET /vela/v0/bootstrap': () => ++calls === 1
      ? Response.json({ error: { class: 'conflict', code: 'cursor_expired', message: 'Refresh', retry: { allowed: false } } }, { status: 409 })
      : { rows: [] } });
    expect(await ether().home()).toEqual({ rows: [] } as never);
    expect(seen).toHaveLength(2);
  });

  test('signed-out requests that need a session fail before fetching', async () => {
    const seen = routeFetch({});
    await expect(ether(new FakeCredentials(null)).libraries({})).rejects.toThrow('Sign in required');
    expect(seen).toHaveLength(0);
  });
});

test('older Ether child details resolve the series name through showId for any kind', async () => {
  routeFetch({
    'GET /vela/v0/titles/episode': { title: { id: 'episode', kind: 'episode', showId: 'show', seasonNumber: 0, episodeNumber: 3 } },
    'GET /vela/v0/titles/show': { title: { id: 'show', name: 'Severance' } },
  });
  expect((await ether().detail('episode')).title).toMatchObject({ showName: 'Severance', seasonNumber: 0, episodeNumber: 3 });
  routeFetch({
    'GET /vela/v0/titles/plugin': { title: { id: 'plugin', kind: 'plugin-item', showId: 'show' } },
    'GET /vela/v0/titles/show': { title: { id: 'show', name: 'Severance' } },
  });
  expect((await ether().detail('plugin')).title.showName).toBe('Severance');
});

test('a missing Ether parent leaves the episode detail available', async () => {
  routeFetch({
    'GET /vela/v0/titles/episode': { title: { id: 'episode', kind: 'episode', showId: 'removed-show', seasonNumber: 1, episodeNumber: 3 } },
    'GET /vela/v0/titles/removed-show': () => Response.json({ error: { class: 'not-found', code: 'not_found', message: 'Show removed', retry: { allowed: false } } }, { status: 404 }),
  });
  expect((await ether().detail('episode')).title.id).toBe('episode');
});

test('Ether passes plugin title names, logos and context through without kind-based substitution', async () => {
  const { detailModel } = await import('../src/discovery/models');
  const title = { id: 'plugin', kind: 'plugin-audiobook', name: 'A plugin title', showName: 'A series', seasonNumber: 2, episodeNumber: 3, genres: [], summary: '', artwork: [
    { id: 'logo', kind: 'logo', tag: '', sizes: [{ width: 500, height: 120, url: 'https://ether.example/logo.png' }] },
  ] };
  routeFetch({ 'GET /vela/v0/titles/plugin': { title, extras: [], chapters: [], cast: [] } });
  const model = detailModel(await ether().detail('plugin')).title[0]!;
  expect(model.name).toBe('A plugin title');
  expect(model.logo).toBe('https://ether.example/logo.png');
  expect(model.episodeContext).toBe('A series · Season 2, Episode 3');
});

test('Ether forwards advertised plugin IDs in both search modes', async () => {
  const seen = routeFetch({ 'POST /vela/v0/search': searchAnswer });
  const request = { query: 'portal', generation: 2, idempotencyKey: 'plugin', sort: 'play_time', direction: 'desc' as const, kind: 'game', library: 'games', cursor: 'page2' };
  await ether().search(request);
  await ether().searchByDescription(request);
  expect(seen.map(x => x.body)).toEqual([{ ...request, mode: 'fast' }, { ...request, mode: 'descriptive' }]);
});

test('collection requests fill a grid page and retain tab and page size on continuation', async () => {
  const seen = routeFetch({ 'GET /vela/v0/libraries/movies/collections': { items: [], continuation: 'exhausted' } });
  const adapter = ether();
  await adapter.libraryCollections('movies', undefined, 'studio-sets');
  await adapter.libraryCollections('movies', 'opaque-next', 'studio-sets');
  expect(seen.map(call => Object.fromEntries(call.url.searchParams))).toEqual([
    { tab: 'studio-sets', limit: '100' },
    { cursor: 'opaque-next', tab: 'studio-sets', limit: '100' },
  ]);
});


test('collection search query is retained unchanged on cursor continuation', async () => {
  const seen = routeFetch({ 'GET /vela/v0/libraries/movies/collections': { items: [], continuation: 'exhausted' } });
  const adapter = ether();
  await adapter.libraryCollections('movies', undefined, 'studios', 'Jo & José');
  await adapter.libraryCollections('movies', 'opaque-next', 'studios', 'Jo & José');
  expect(seen.map(call => Object.fromEntries(call.url.searchParams))).toEqual([
    { tab: 'studios', query: 'Jo & José', limit: '100' },
    { cursor: 'opaque-next', tab: 'studios', query: 'Jo & José', limit: '100' },
  ]);
});
