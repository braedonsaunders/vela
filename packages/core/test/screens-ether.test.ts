// The Ether adapter's plugin-screen routes against a routed fetch: paths, query shapes, the
// renderer header, the idempotency key, a stale document's 301 and the stream's topics.
import { afterEach, expect, test } from 'bun:test';
import { EtherAdapter } from '../src/adapter/ether';
import { FakeCredentials, restoreFetch, routeFetch } from './helpers';

afterEach(restoreFetch);
const ORIGIN = 'https://ether.example';
const adapter = () => new EtherAdapter(ORIGIN, new FakeCredentials(), '', undefined, 19);
const DOC = { schema: 1, kind: 'screen', renderer: 19, screen: 'sports', page: 'index', version: '2', title: 'Sports', presentation: 'section', sources: {}, tree: { type: 'box' } };

test('a document is read with the renderer header; a stale href follows its 301 inside the server', async () => {
  const seen = routeFetch({
    'GET /vela/v0/screens/sports/pages/index/document': (request: { url: URL }) => request.url.searchParams.get('v') === 'old'
      ? new Response(null, { status: 301, headers: { Location: '/vela/v0/screens/sports/pages/index/document?v=new&r=19&l=en' } })
      : Response.json(DOC, { headers: { ETag: '"new"' } }),
  });
  const read = await adapter().screenDocument('/vela/v0/screens/sports/pages/index/document?v=old&r=19&l=en');
  expect(read.document.screen).toBe('sports');
  expect(read.href).toBe('/vela/v0/screens/sports/pages/index/document?v=new&r=19&l=en');
  expect(seen.map(r => r.url.search)).toEqual(['?v=old&r=19&l=en', '?v=new&r=19&l=en']);
  expect(seen.every(r => r.headers.get('x-vela-screen-renderer') === '19' && r.headers.get('authorization') === 'Bearer token-1')).toBe(true);
  // The same href read fresh is not moved.
  expect((await adapter().screenDocument(`${ORIGIN}/vela/v0/screens/sports/pages/index/document?v=new&r=19&l=en`)).href).toBe(`${ORIGIN}/vela/v0/screens/sports/pages/index/document?v=new&r=19&l=en`);
});

test('a document redirect or href outside the server is refused', async () => {
  routeFetch({ 'GET /vela/v0/screens/x/pages/index/document': new Response(null, { status: 301, headers: { Location: 'https://evil.example/vela/v0/doc' } }) });
  await expect(adapter().screenDocument('/vela/v0/screens/x/pages/index/document?v=1')).rejects.toThrow('outside');
  await expect(adapter().screenDocument('https://evil.example/vela/v0/screens/x/pages/index/document')).rejects.toThrow('this server');
  await expect(adapter().screenDocument('/elsewhere/document')).rejects.toThrow('this server');
});

test('data reads: sources, params and context as p.<name>, the time zone; surfaces at their own path', async () => {
  const data = { rev: 5, sources: { hero: { events: [] } }, records: {}, live: { topic: 'lt1.x' } };
  const seen = routeFetch({ 'GET /vela/v0/screens/sports/pages/index/data': data, 'GET /vela/v0/surfaces/sports.scorebug/data': data });
  const api = adapter();
  expect(await api.screenData({ kind: 'screen', id: 'sports', page: 'index' }, { sources: ['hero', 'standings'], params: { league: 'nfl', date: '2026-11-24' }, tz: 'America/Toronto' })).toEqual(data);
  await api.screenData({ kind: 'screen', id: 'sports', page: 'index' }, { params: {}, tz: 'UTC' });
  await api.screenData({ kind: 'surface', id: 'sports.scorebug' }, { params: {}, context: { event: 'event:a', 'alert.ref': 'event:b' }, tz: 'UTC' });
  expect(seen[0]!.url.searchParams.get('sources')).toBe('hero,standings');
  expect(seen[0]!.url.searchParams.get('p.league')).toBe('nfl');
  expect(seen[0]!.url.searchParams.get('p.date')).toBe('2026-11-24');
  expect(seen[0]!.url.searchParams.get('tz')).toBe('America/Toronto');
  expect(seen[1]!.url.search).toBe('?tz=UTC'); // every source that is not lazy
  expect(seen[2]!.url.pathname).toBe('/vela/v0/surfaces/sports.scorebug/data');
  expect(seen[2]!.url.searchParams.get('p.event')).toBe('event:a');
  expect(seen[2]!.url.searchParams.get('p.alert.ref')).toBe('event:b');
  expect(seen.every(r => r.headers.get('x-vela-screen-renderer') === '19')).toBe(true);
});

test('actions post {page, params, args} with an idempotency key; settings put {enabled}', async () => {
  const seen = routeFetch({
    'POST /vela/v0/screens/sports/actions/ether.favorite': { records: { 'entity:x': { rev: 2, value: { favourite: true } } }, refresh: ['yours'] },
    'POST /vela/v0/surfaces/sports.alert/actions/ether.reveal': new Response(null, { status: 204 }),
    'PUT /vela/v0/surfaces/sports.ticker/setting': new Response(null, { status: 204 }),
  });
  const api = adapter();
  const answer = await api.screenAction({ kind: 'screen', id: 'sports', page: 'index' }, 'ether.favorite', { page: 'index', params: { league: 'nfl' }, args: { ref: 'entity:x', on: 'true' } }, { idempotencyKey: 'k1' });
  expect(answer.refresh).toEqual(['yours']);
  expect(seen[0]!.body).toEqual({ page: 'index', params: { league: 'nfl' }, args: { ref: 'entity:x', on: 'true' }, idempotencyKey: 'k1' });
  expect(seen[0]!.headers.get('idempotency-key')).toBe('k1');
  expect(await api.screenAction({ kind: 'surface', id: 'sports.alert' }, 'ether.reveal', { page: '', params: {}, args: {}, context: { 'alert.ref': 'event:a' } }, { idempotencyKey: 'k2' })).toEqual({});
  await api.setSurfaceSetting('sports.ticker', false, { idempotencyKey: 'k3' });
  expect(seen[2]!.body).toEqual({ enabled: false, idempotencyKey: 'k3' });
  expect(seen[2]!.headers.get('idempotency-key')).toBe('k3');
  expect(seen.every(r => r.headers.get('x-vela-screen-renderer') === '19')).toBe(true);
});

test('the stream follows repeated topics since the lowest rev, with the time zone and alerts', async () => {
  const seen = routeFetch({ 'GET /vela/v0/live/stream': new Response('event: heartbeat\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }) });
  const events: string[] = [];
  await adapter().streamScreens({ topics: ['lt1.a', 'lt1.b'], since: 41, alerts: true }, 'Europe/London', event => { events.push(event.event); });
  expect(seen[0]!.url.searchParams.getAll('topic')).toEqual(['lt1.a', 'lt1.b']);
  expect(seen[0]!.url.searchParams.get('since')).toBe('41');
  expect(seen[0]!.url.searchParams.get('tz')).toBe('Europe/London');
  expect(seen[0]!.url.searchParams.get('alerts')).toBe('1');
  expect(seen[0]!.url.searchParams.has('events')).toBe(false);
  expect(seen[0]!.headers.get('x-vela-screen-renderer')).toBe('19');
  expect(events).toEqual(['heartbeat']);
});

test('bootstrap carries the renderer header', async () => {
  const seen = routeFetch({ 'GET /vela/v0/bootstrap': { viewer: { id: 'v', name: 'V' }, capabilities: { features: {} }, defaultSkinId: 'x', rows: [] } });
  await adapter().home(true);
  expect(seen[0]!.headers.get('x-vela-screen-renderer')).toBe('19');
  // A client that does not say its renderer gets no screens (Ether's hard cut), and sends no header.
  await new EtherAdapter(ORIGIN, new FakeCredentials(), '').home(true);
  expect(seen[1]!.headers.has('x-vela-screen-renderer')).toBe(false);
});
