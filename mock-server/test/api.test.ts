import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';

const CHANNELS = 24;
const device: V.Device = { id: 'test-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
let mock: RunningMock;
let keys = 0;
const key = () => `test-${++keys}`;

beforeAll(async () => { mock = await launchMock({ VELA_MOCK_CHANNELS: String(CHANNELS) }); });
afterAll(async () => { await mock?.stop(); });

const call = (path: string, init: RequestInit = {}) => fetch(`${mock.url}/vela/v0${path}`, init);
const post = (path: string, body: object, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const authed = (t: V.Tokens) => ({ Authorization: `Bearer ${t.accessToken}`, 'X-Vela-Device-Id': device.id });
async function signIn(): Promise<V.Tokens> {
  const response = await post('/auth/sign-in', { username: 'demo', password: 'vela', device, idempotencyKey: key() });
  expect(response.status).toBe(200);
  return response.json() as Promise<V.Tokens>;
}
const errorCode = async (response: Response) => ((await response.json()) as V.ErrorResponse).error.code;

describe('mock server: public and auth', () => {
  test('capabilities are cacheable by ETag', async () => {
    const first = await call('/capabilities');
    expect(first.status).toBe(200);
    const body = await first.json() as V.ServerCapabilities;
    expect(body.protocolVersion).toBe(0);
    expect(body.features.liveTV.available).toBe(true);
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const again = await call('/capabilities', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
  });

  test('mutations need an idempotency key and JSON', async () => {
    expect(await errorCode(await post('/auth/sign-in', { username: 'demo', password: 'vela', device }))).toBe('idempotency_required');
    const bad = await call('/auth/sign-in', { method: 'POST', body: '{nope' });
    expect(bad.status).toBe(400);
    expect(await errorCode(bad)).toBe('invalid_json');
  });

  test('sign-in refuses wrong credentials', async () => {
    const response = await post('/auth/sign-in', { username: 'demo', password: 'wrong', device, idempotencyKey: key() });
    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe('invalid_credentials');
  });

  test('a session needs both the bearer and its device id', async () => {
    const tokens = await signIn();
    expect((await call('/libraries')).status).toBe(401);
    expect((await call('/libraries', { headers: { Authorization: `Bearer ${tokens.accessToken}` } })).status).toBe(401);
    expect((await call('/libraries', { headers: authed(tokens) })).status).toBe(200);
  });

  test('refresh rotates both tokens and retires the old access token', async () => {
    const tokens = await signIn();
    const response = await post('/auth/refresh', { refreshToken: tokens.refreshToken, device, idempotencyKey: key() });
    const next = await response.json() as V.Tokens;
    expect(next.accessToken).not.toBe(tokens.accessToken);
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect((await call('/libraries', { headers: authed(tokens) })).status).toBe(401);
    expect((await call('/libraries', { headers: authed(next) })).status).toBe(200);
    const reused = await post('/auth/refresh', { refreshToken: tokens.refreshToken, device, idempotencyKey: key() });
    expect(await errorCode(reused)).toBe('invalid_refresh');
  });

  test('revoking ends the session', async () => {
    const tokens = await signIn();
    const revoke = await post('/auth/revoke', { refreshToken: tokens.refreshToken, idempotencyKey: key() }, authed(tokens));
    expect(await revoke.json()).toEqual({ accepted: true });
    expect((await call('/libraries', { headers: authed(tokens) })).status).toBe(401);
  });

  test('a reused idempotency key replays the answer, or conflicts with another body', async () => {
    const tokens = await signIn();
    const same = key();
    const body = { query: 'news', generation: 1, mode: 'fast', idempotencyKey: same };
    const first = await (await post('/search', body, authed(tokens))).json();
    const replay = await (await post('/search', body, authed(tokens))).json();
    expect(replay).toEqual(first);
    const conflict = await post('/search', { ...body, query: 'drama' }, authed(tokens));
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe('idempotency_conflict');
  });

  test('unknown endpoints are protocol 404s once authenticated', async () => {
    expect((await call('/nowhere')).status).toBe(401);
    const response = await call('/nowhere', { headers: authed(await signIn()) });
    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe('endpoint_not_found');
    expect((await fetch(`${mock.url}/elsewhere`)).status).toBe(404);
  });
});

describe('mock server: catalogue and live', () => {
  let tokens: V.Tokens;
  beforeAll(async () => { tokens = await signIn(); });
  const get = async <T>(path: string) => {
    const response = await call(path, { headers: authed(tokens) });
    expect(response.status).toBe(200);
    return response.json() as Promise<T>;
  };

  test('VELA_MOCK_CHANNELS sizes the lineup', async () => {
    const page = await get<V.Page<V.Channel>>('/live/channels?limit=100');
    expect(page.items).toHaveLength(CHANNELS);
    expect(page.continuation).toBe('exhausted');
    expect(page.items.slice(0, 2).map(c => [c.id, c.number, c.name])).toEqual([['channel-1', '101', 'World News'], ['channel-2', '102', 'Field & Forest']]);
    expect(page.items.filter(c => c.favorite)).toHaveLength(6);
  });

  test('cursors walk every page and refuse tampering', async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page: V.Page<V.Channel> = await get(`/live/channels?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      ids.push(...page.items.map(c => c.id));
      cursor = page.nextCursor;
      pages++;
      expect(page.continuation).toBe(cursor ? 'more' : 'exhausted');
    } while (cursor);
    expect(pages).toBe(3);
    expect(new Set(ids).size).toBe(CHANNELS);
    const first = await get<V.Page<V.Channel>>('/live/channels?limit=10');
    const [payload, signature] = first.nextCursor!.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), offset: 0 })).toString('base64url');
    const refused = await call(`/live/channels?limit=10&cursor=${forged}.${signature}`, { headers: authed(tokens) });
    expect(refused.status).toBe(409);
    expect(await errorCode(refused)).toBe('cursor_expired');
  });

  test('page limits are bounded', async () => {
    for (const limit of ['0', '101', 'x']) {
      const response = await call(`/live/channels?limit=${limit}`, { headers: authed(tokens) });
      expect(response.status).toBe(400);
    }
  });

  test('the guide answers a bounded window, filtered by channel', async () => {
    const from = Date.parse('2026-03-10T00:00:00Z'), until = from + 6 * 3600_000;
    const window = `from=${new Date(from).toISOString()}&until=${new Date(until).toISOString()}`;
    const guide = await get<V.GuideResponse>(`/live/guide?${window}&channelIds=channel-1,channel-4,channel-5&limit=100`);
    const channels = new Set(guide.items.map(p => p.channelId));
    // Every fourth fixture channel has no listings.
    expect([...channels].sort()).toEqual(['channel-1', 'channel-5']);
    for (const p of guide.items) {
      expect(Date.parse(p.end)).toBeGreaterThan(from);
      expect(Date.parse(p.start)).toBeLessThan(until);
      expect(Date.parse(p.end)).toBeGreaterThan(Date.parse(p.start));
    }
    const tooLong = await call(`/live/guide?from=${new Date(from).toISOString()}&until=${new Date(from + 25 * 3600_000).toISOString()}`, { headers: authed(tokens) });
    expect(await errorCode(tooLong)).toBe('invalid_window');
    const backwards = await call(`/live/guide?from=${new Date(until).toISOString()}&until=${new Date(from).toISOString()}`, { headers: authed(tokens) });
    expect(backwards.status).toBe(400);
  });

  test('bootstrap, libraries and a title detail', async () => {
    const home = await get<V.Bootstrap>('/bootstrap');
    expect(home.viewer.id).toBe('viewer-demo');
    expect(home.rows.length).toBeGreaterThan(0);
    expect(home.rows[0]!.receiptToken).toContain('.');
    const libraries = await get<V.Page<V.Library>>('/libraries');
    expect(libraries.items.length).toBeGreaterThan(0);
    const library = libraries.items[0]!;
    const contents = await get<V.LibraryContents>(`/libraries/${library.id}/items?limit=5`);
    expect(contents.library.id).toBe(library.id);
    expect(contents.items.length).toBeLessThanOrEqual(5);
    const bad = await call(`/libraries/${library.id}/items?sort=nonsense`, { headers: authed(tokens) });
    expect(await errorCode(bad)).toBe('invalid_library_query');
    const titleEntry = contents.items.find(i => i.kind === 'title') as Extract<V.RowEntry, { kind: 'title' }>;
    const detail = await get<V.TitleDetail>(`/titles/${titleEntry.title.id}`);
    expect(detail.title.id).toBe(titleEntry.title.id);
    expect((await call('/titles/no-such-title', { headers: authed(tokens) })).status).toBe(404);
  });

  test('fast search matches titles by name and live channels and programmes', async () => {
    const response = await post('/search', { query: 'world news', generation: 9, mode: 'fast', idempotencyKey: key() }, authed(tokens));
    const result = await response.json() as V.SearchResponse;
    expect(result.generation).toBe(9);
    expect(result.live?.channels.map(c => c.id)).toEqual(['channel-1']);
    const descriptive = await post('/search', { query: 'world news', generation: 10, mode: 'descriptive', idempotencyKey: key() }, authed(tokens));
    expect((await descriptive.json() as V.SearchResponse).live).toBeUndefined();
    const invalid = await post('/search', { query: 'x', generation: 1, mode: 'ai', idempotencyKey: key() }, authed(tokens));
    expect(await errorCode(invalid)).toBe('invalid_search');
  });

  test('AI search is not offered', async () => {
    const response = await post('/search/ai', { query: 'x', generation: 1, idempotencyKey: key() }, authed(tokens));
    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe('feature_unavailable');
  });
});

test('search sorts, filters, validates and binds cursors to the complete query', async () => {
  const tokens = await signIn();
  const search = async (options: object) => post('/search', { query: '', mode: 'fast', generation: 1, idempotencyKey: key(), ...options }, authed(tokens));
  const asc = await (await search({ sort: 'title', direction: 'asc', limit: 100 })).json() as V.SearchResponse;
  const desc = await (await search({ sort: 'title', direction: 'desc', limit: 100 })).json() as V.SearchResponse;
  expect(asc.items.map(t => t.name)).toEqual(asc.items.map(t => t.name).sort((a, b) => a.localeCompare(b)));
  expect(desc.items.map(t => t.name)).toEqual(desc.items.map(t => t.name).sort((a, b) => b.localeCompare(a)));
  expect(asc.items[0].name).not.toBe(desc.items[0].name);
  const movies = await (await search({ kind: 'movie' })).json() as V.SearchResponse;
  expect(movies.items.length).toBeGreaterThan(0);
  expect(movies.items.every(t => t.kind === 'movie')).toBe(true);
  expect((await (await search({ kind: 'game' })).json() as V.SearchResponse).items).toEqual([]);
  for (const [field, value] of [['sort', 'invalid'], ['direction', 'up'], ['kind', 'invalid'], ['library', 'invisible']]) {
    expect(await errorCode(await search({ [field]: value }))).toBe(`invalid_${field}`);
  }
  const scoped = await (await search({ library: 'shows', sort: 'title', direction: 'desc', kind: 'show' })).json() as V.SearchResponse;
  expect(scoped.items.length).toBeGreaterThan(0);
  expect(scoped.items.every(t => t.kind === 'show')).toBe(true);
  expect((await (await search({ library: 'shows', kind: 'movie' })).json() as V.SearchResponse).items).toEqual([]);
  const first = await (await search({ sort: 'title', limit: 1 })).json() as V.SearchResponse;
  expect(first.nextCursor).toBeDefined();
  expect((await search({ sort: 'released', cursor: first.nextCursor })).status).toBe(409);
  expect((await search({ sort: 'title', library: 'shows', cursor: first.nextCursor })).status).toBe(409);
});
