import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type * as V from '../../packages/protocol/types';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { launchMock, type RunningMock } from './launch';
import { mediaRoot } from '../media';

// Starting playback needs the generated HLS fixture (mock-server/scripts/make-media.ts); CI has none.
const mediaGenerated = existsSync(join(mediaRoot, 'master.m3u8'));

const CHANNELS = 24;
const device: V.Device = { id: 'test-device', name: 'Test', platform: 'web', appVersion: '0.1.0' };
let mock: RunningMock;
let keys = 0;
const key = () => `test-${++keys}`;

beforeAll(async () => { mock = await launchMock({ VELA_MOCK_CHANNELS: String(CHANNELS), VELA_MOCK_PLEX_HOME: '1' }); });
afterAll(async () => { await mock?.stop(); });

const call = (path: string, init: RequestInit = {}) => fetch(`${mock.url}/vela/v0${path}`, init);
const post = (path: string, body: object, headers: Record<string, string> = {}) =>
  call(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const mutate = (method: 'PATCH' | 'DELETE', path: string, body: object, headers: Record<string, string> = {}) =>
  call(path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
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

  test('Plex Home selection is public, PIN-gated and returns a Vela session', async () => {
    const begin = await post('/auth/plex', { plexToken: 'mock-plex-approved', selectProfile: true, device, idempotencyKey: key() });
    expect(begin.status).toBe(200);
    const selection = await begin.json() as V.PlexHomeSelection;
    expect(selection.profiles).toEqual([
      { id: 'owner', name: 'Demo Owner', protected: true, avatarUrl: '/vela/v0/images/plexavatar-owner' },
      { id: 'kids', name: 'Kids', protected: false, restricted: true, avatarUrl: '/vela/v0/images/plexavatar-kids' },
    ]);
    const refused = await post('/auth/plex/profile', { selectionToken: selection.selectionToken, profileId: 'owner', pin: '0000', device, idempotencyKey: key() });
    expect(refused.status).toBe(401);
    const accepted = await post('/auth/plex/profile', { selectionToken: selection.selectionToken, profileId: 'owner', pin: '1234', device, idempotencyKey: key() });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ viewer: { id: 'owner', name: 'Demo Owner' } });
  });

  test('Plex Home switching requires auth, consumes its challenge and revokes the old session', async () => {
    const old = await signIn();
    const anonymous = await post('/auth/plex/profiles/challenge', { device, idempotencyKey: key() });
    expect(anonymous.status).toBe(401);
    const challenge = await post('/auth/plex/profiles/challenge', { device, idempotencyKey: key() }, authed(old));
    expect(challenge.status).toBe(200);
    const selection = await challenge.json() as V.PlexHomeSelection;
    const switched = await post('/auth/plex/profile', { selectionToken: selection.selectionToken, profileId: 'kids', device, idempotencyKey: key() });
    expect(switched.status).toBe(200);
    const next = await switched.json() as V.Tokens;
    expect(next.viewer).toMatchObject({ id: 'kids', name: 'Kids' });
    expect((await call('/libraries', { headers: authed(old) })).status).toBe(401);
    expect((await call('/libraries', { headers: authed(next) })).status).toBe(200);
    const reused = await post('/auth/plex/profile', { selectionToken: selection.selectionToken, profileId: 'kids', device, idempotencyKey: key() });
    expect(reused.status).toBe(409);
    expect(await errorCode(reused)).toBe('selection_consumed');
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

describe('mock server: viewer playlists', () => {
  test('supports lifecycle, stable entry ids, reorder, expansion and smart read-only errors', async () => {
    const tokens = await signIn(), headers = authed(tokens);
    const capability = await (await call('/capabilities')).json() as V.ServerCapabilities;
    expect(capability.features.playlists).toEqual({ available: true, maxEntries: 5000 });
    const createdResponse = await post('/playlists', { idempotencyKey: key(), name: 'Series night', titleIds: ['show-meridian'] }, headers);
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as V.PlaylistCard;
    const detail = await (await call(`/playlists/${created.id}`, { headers })).json() as V.CollectionContents;
    expect(detail.collection).toMatchObject({ kind: 'playlist', name: 'Series night', smart: false, entryCount: 48 });
    expect(detail.items[0]?.entryId).toBeTruthy();
    const showMembership = await (await call('/titles/show-meridian/playlists', { headers })).json() as V.TitlePlaylists;
    expect(showMembership.items.find(item => item.id === created.id)?.entryIds).toHaveLength(48);
    const first = detail.items[0]!.entryId!, second = detail.items[1]!.entryId!;
    expect((await post(`/playlists/${created.id}/entries/${second}/move`, { idempotencyKey: key(), afterEntryId: null }, headers)).status).toBe(200);
    const reordered = await (await call(`/playlists/${created.id}`, { headers })).json() as V.CollectionContents;
    expect(reordered.items[0]?.entryId).toBe(second);
    expect((await mutate('DELETE', `/playlists/${created.id}/entries/${first}`, { idempotencyKey: key() }, headers)).status).toBe(200);
    const renamed = await (await mutate('PATCH', `/playlists/${created.id}`, { idempotencyKey: key(), name: 'Renamed' }, headers)).json() as V.PlaylistCard;
    expect(renamed.name).toBe('Renamed');
    const membership = await (await call('/titles/episode-1-2/playlists', { headers })).json() as V.TitlePlaylists;
    expect(membership.items.find(item => item.id === created.id)?.entryIds.length).toBeGreaterThan(0);
    const smart = (await (await call('/playlists', { headers })).json() as V.Page<V.PlaylistCard>).items.find(item => item.smart)!;
    const readOnly = await post(`/playlists/${smart.id}/entries`, { idempotencyKey: key(), titleIds: ['title-1-1'] }, headers);
    expect(readOnly.status).toBe(409); expect(await errorCode(readOnly)).toBe('playlist_read_only');
    expect((await mutate('DELETE', `/playlists/${created.id}`, { idempotencyKey: key() }, headers)).status).toBe(200);
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

  test('title watch mutations persist every supported field', async () => {
    const bootstrap = await get<V.Bootstrap>('/bootstrap');
    const title = bootstrap.rows.flatMap(row => 'items' in row ? row.items : []).find(item => item.kind === 'title')!;
    const response = await post(`/titles/${title.title.id}/watch`, { idempotencyKey: key(), played: true, favorite: true, watchlisted: true }, authed(tokens));
    expect(response.status).toBe(200);
    const detail = await get<V.TitleDetail>(`/titles/${title.title.id}`);
    expect(detail.title.watch).toMatchObject({ played: true, favorite: true, watchlisted: true });
    await post(`/titles/${title.title.id}/watch`, { idempotencyKey: key(), played: false, favorite: false, watchlisted: false }, authed(tokens));
  });

  test('Home\'s progress shelves can be read on their own, as Ether serves them after a stop', async () => {
    const bootstrap = await get<V.Bootstrap>('/bootstrap');
    const shelves = bootstrap.rows.filter((row): row is V.Row => 'purpose' in row && (row.purpose === 'continue' || row.purpose === 'nextUp'));
    expect(shelves.length).toBeGreaterThan(0);
    for (const shelf of shelves) {
      const row = await get<V.Row>(`/rows/${shelf.id}?limit=20`);
      expect(row.id).toBe(shelf.id);
      expect(row.items.map(item => item.id)).toEqual(shelf.items.slice(0, 20).map(item => item.id));
    }
  });

  test('a watch change re-mints Home\'s row ids as Ether does: keys stay, an old id answers 409 cursor_expired', async () => {
    const before = await get<V.Bootstrap>('/bootstrap');
    const feed = (bootstrap: V.Bootstrap) => bootstrap.rows.filter((row): row is V.Row => !('kind' in row));
    const old = feed(before)[0]!;
    expect(old.key).toBe(old.id.slice(0, old.id.lastIndexOf('~')));
    expect((await get<V.Row>(`/rows/${encodeURIComponent(old.id)}`)).id).toBe(old.id);
    const title = feed(before).flatMap(row => row.items).find(item => item.kind === 'title')!;
    expect((await fetch(`${mock.url}/__admin/faults`, { method: 'POST', body: JSON.stringify({ bootstrapStaleReads: 1 }) })).status).toBe(200);
    expect((await post(`/titles/${title.title.id}/watch`, { idempotencyKey: key(), played: true }, authed(tokens))).status).toBe(200);
    const staleBootstrap = feed(await get<V.Bootstrap>('/bootstrap'));
    expect(staleBootstrap.find(row => row.key === old.key)?.id).toBe(old.id);
    const after = feed(await get<V.Bootstrap>('/bootstrap'));
    const fresh = after.find(row => row.key === old.key)!;
    expect(fresh.id).not.toBe(old.id);
    expect(new Set(after.map(row => row.id)).has(old.id)).toBe(false);
    const stale = await call(`/rows/${encodeURIComponent(old.id)}`, { headers: authed(tokens) });
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as V.ErrorResponse).error.code).toBe('cursor_expired');
    expect((await get<V.Row>(`/rows/${encodeURIComponent(fresh.id)}`)).key).toBe(old.key);
    expect((await call('/rows/no-such-row', { headers: authed(tokens) })).status).toBe(404);
    await post(`/titles/${title.title.id}/watch`, { idempotencyKey: key(), played: false }, authed(tokens));
  });

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
    expect((home.rows[0] as V.Row).receiptToken).toContain('.');
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

  test('plugin library exposes paged Smart Views and watch-history timestamps', async () => {
    const page = await get<V.Page<V.Library>>('/libraries?limit=100');
    const plugin = page.items.find(library => library.id === 'videos')!;
    expect(plugin.tabs).toHaveLength(45);
    expect(plugin.tabs?.filter(tab => tab.kind === 'view').slice(0, 3).map(tab => [tab.id, tab.layout])).toEqual([
      ['smart-grid', 'grid'], ['smart-list', 'list'], ['smart-timeline', 'timeline'],
    ]);
    expect(plugin.browse.sorts.find(sort => sort.id === 'lastViewed')?.directions).toEqual(['desc', 'asc']);
    const first = await get<V.LibraryContents>('/libraries/videos/items?tab=smart-timeline&sort=lastViewed&direction=desc');
    expect(first.items).toHaveLength(6);
    expect(first.continuation).toBe('more');
    expect(first.items.every(item => item.kind !== 'title' || !!item.title.watch?.lastViewedAt)).toBe(true);
    const next = await get<V.LibraryContents>(`/libraries/videos/items?tab=smart-timeline&sort=lastViewed&direction=desc&cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(new Set([...first.items, ...next.items].map(item => item.id)).size).toBe(first.items.length + next.items.length);
    expect((await get<V.LibraryContents>('/libraries/videos/items?tab=smart-list&sort=lastViewed&direction=desc&query=the')).items
      .every(item => item.kind !== 'title' || item.title.name.toLowerCase().includes('the'))).toBe(true);
  });

  test('versions expose warm, cold, unavailable, remembered and clear-choice states', async () => {
    const warm = await get<V.TitleVersions>('/titles/title-1-1/versions');
    expect(warm.versions[0]?.label).toBe('Auto');
    expect(warm.versions.some(version => version.availability === 'fetch')).toBe(true);
    expect(warm.versions.some(version => version.availability === 'unavailable' && !!version.note)).toBe(true);
    expect(warm.versions.find(version => version.remembered)?.label).toContain('Dolby Vision');
    const cold = await get<V.TitleVersions>('/titles/title-1-3/versions');
    expect(cold.versions.map(version => version.label)).toEqual(['Auto', '4K Remux', '1080p WEB-DL']);
    expect(cold.versions.every(version => !version.audio && !version.videoCodec)).toBe(true);
    const cleared = await call('/titles/title-1-1/versions/choice', { method: 'DELETE', headers: { ...authed(tokens), 'Content-Type': 'application/json' }, body: JSON.stringify({ idempotencyKey: key(), scope: 'all' }) });
    expect(cleared.status).toBe(200);
    const result = await cleared.json() as V.ClearVersionChoiceResponse;
    expect(result.cleared).toBe(true);
    expect(result.rememberedChoice).toBeUndefined();
    expect(result.selectedVersionId).toBe(result.versions[0]?.id);
  });

  test.skipIf(!mediaGenerated)('a fetching version prepares once then switches the same session and generations', async () => {
    const versions = await get<V.TitleVersions>('/titles/title-1-2/versions');
    const initial = versions.versions[1]!;
    const fetching = versions.versions.find(version => version.availability === 'fetch')!;
    const started = await post('/playback', {
      titleId: versions.titleId, versionId: initial.id, idempotencyKey: key(),
      client: { device, protocolVersions: [0], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: true, mse: true },
    }, authed(tokens));
    expect(started.status).toBe(200);
    const plan = await started.json() as V.PlaybackPlan;
    expect(plan.selectedVersionId).toBe(initial.id);
    const command = { kind: 'version', versionId: fetching.id, positionSeconds: 47, sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration };
    const preparing = await post(`/sessions/${plan.sessionId}/commands`, { ...command, idempotencyKey: key() }, authed(tokens));
    expect(preparing.status).toBe(503);
    const preparingError = (await preparing.json() as V.ErrorResponse).error;
    expect(preparingError).toMatchObject({ class: 'source', code: 'version_preparing', retry: { allowed: true, afterSeconds: 1, maxAttempts: 3 } });
    const switched = await post(`/sessions/${plan.sessionId}/commands`, { ...command, idempotencyKey: key() }, authed(tokens));
    expect(switched.status).toBe(200);
    const next = await switched.json() as V.PlaybackPlan;
    expect(next.sessionId).toBe(plan.sessionId);
    expect(next.selectedVersionId).toBe(fetching.id);
    expect(next.positionSeconds).toBe(47);
    expect(next.sourceGeneration).toBe(plan.sourceGeneration + 1);
    expect(next.seekGeneration).toBe(plan.seekGeneration + 1);

    const unavailable = versions.versions.find(version => version.availability === 'unavailable')!;
    const refused = await post(`/sessions/${plan.sessionId}/commands`, { ...command, versionId: unavailable.id, sourceGeneration: next.sourceGeneration, seekGeneration: next.seekGeneration, idempotencyKey: key() }, authed(tokens));
    expect(refused.status).toBe(409);
    expect((await refused.json() as V.ErrorResponse).error).toMatchObject({ class: 'source', code: 'version_unavailable' });
  });

  test.skipIf(!mediaGenerated)('a switch by bitrate takes the best rung under the cap, at the session position; none fits is 422', async () => {
    const started = await post('/playback', {
      titleId: 'title-1-2', idempotencyKey: key(), positionSeconds: 30,
      client: { device, protocolVersions: [0], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: true, mse: false },
    }, authed(tokens));
    expect(started.status).toBe(200);
    const plan = await started.json() as V.PlaybackPlan;
    const at = { sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration };
    const tooLow = await post(`/sessions/${plan.sessionId}/commands`, { kind: 'switch', maxBitrate: 100_000, ...at, idempotencyKey: key() }, authed(tokens));
    expect(tooLow.status).toBe(422);
    expect(await errorCode(tooLow)).toBe('quality_unavailable');
    const switched = await post(`/sessions/${plan.sessionId}/commands`, { kind: 'switch', maxBitrate: 1_500_000, ...at, idempotencyKey: key() }, authed(tokens));
    expect(switched.status).toBe(200);
    const next = await switched.json() as V.PlaybackPlan;
    expect(next.selectedPathId).toBe('transcode');
    expect(next.sourceGeneration).toBe(plan.sourceGeneration + 1);
    expect(next.positionSeconds).toBe(30);
  });

  test.skipIf(!mediaGenerated)('the playing release rides on plans, snapshots and events, and a failover publishes a newer revision', async () => {
    const versions = await get<V.TitleVersions>('/titles/title-1-3/versions');
    const [auto, top, web] = versions.versions;
    const start = (versionId: string) => post('/playback', {
      titleId: versions.titleId, versionId, idempotencyKey: key(),
      client: { device, protocolVersions: [0], containers: [], videoCodecs: [], audioCodecs: [], subtitleFormats: [], hls: true, mse: true },
    }, authed(tokens)).then(response => response.json() as Promise<V.PlaybackPlan>);
    // Auto stays the choice; the top release, a row of its own, is what plays.
    const plan = await start(auto!.id);
    expect(plan.selectedVersionId).toBe(auto!.id);
    expect(plan.playingVersionId).toBe(top!.id);
    expect(plan.playingLabel).toBe(top!.label);
    const snapshot = await get<V.SessionSnapshot>(`/sessions/${plan.sessionId}`);
    expect(snapshot).toMatchObject({ playingVersionId: top!.id, playingLabel: top!.label });
    const failed = await fetch(`${mock.url}/__admin/failover`, { method: 'POST' }).then(response => response.json()) as { sessionId: string; revision: number; playingVersionId: string }[];
    const moved = failed.find(entry => entry.sessionId === plan.sessionId)!;
    expect(moved.revision).toBeGreaterThan(plan.revision);
    expect(moved.playingVersionId).toBe(web!.id);
    const after = await get<V.SessionSnapshot>(`/sessions/${plan.sessionId}`);
    expect(after.plan).toMatchObject({ selectedVersionId: auto!.id, playingVersionId: web!.id, playingLabel: web!.label });
    expect(after.playingLabel).toBe(web!.label);
    // Choosing the top release's own row plays exactly it.
    const forced = await start(top!.id);
    expect(forced).toMatchObject({ selectedVersionId: top!.id, playingVersionId: top!.id });
  });

  test.skipIf(!mediaGenerated)('original-loss faults publish a fenced replacement for 409 and truncation, or pin an unavailable version', async () => {
    await fetch(`${mock.url}/__admin/sidecar`, { method: 'POST', body: JSON.stringify({ enabled: true, pathId: 'direct' }) });
    const versions = await get<V.TitleVersions>('/titles/title-1-3/versions');
    const start = () => post('/playback', { titleId: versions.titleId, versionId: versions.versions[0]!.id, idempotencyKey: key(),
      client: { device, protocolVersions: [0], containers: ['mp4'], videoCodecs: ['h264'], audioCodecs: ['aac'], subtitleFormats: ['vtt'], hls: true, mse: true } }, authed(tokens)).then(response => response.json() as Promise<V.PlaybackPlan>);
    const arm = (fault: object) => fetch(`${mock.url}/__admin/faults`, { method: 'POST', body: JSON.stringify(fault) });
    try {
      const refusedPlan = await start();
      const refusedPath = refusedPlan.paths.find(path => path.id === refusedPlan.selectedPathId)!;
      await arm({ originalLost409: 1, originalLostVersionUnavailable: false });
      const refused = await fetch(new URL(refusedPath.url!, mock.url), { headers: { Range: 'bytes=0-31' } });
      expect(refused.status).toBe(409);
      expect(refused.headers.get('X-Ether-Playback-Error')).toBe('original_lost');
      const moved = (await get<V.SessionSnapshot>(`/sessions/${refusedPlan.sessionId}`)).plan;
      expect(moved.sourceGeneration).toBe(refusedPlan.sourceGeneration + 1);
      expect(moved.revision).toBeGreaterThan(refusedPlan.revision);
      expect(moved.playingVersionId).not.toBe(refusedPlan.playingVersionId);
      expect(moved.paths.find(path => path.id === moved.selectedPathId)?.url).not.toBe(refusedPath.url);

      const truncatedPlan = await start();
      const truncatedPath = truncatedPlan.paths.find(path => path.id === truncatedPlan.selectedPathId)!;
      await arm({ originalLostTruncate: 1, originalLostVersionUnavailable: false });
      const truncated = await fetch(new URL(truncatedPath.url!, mock.url), { headers: { Range: 'bytes=0-65535' } });
      expect(truncated.status).toBe(206);
      expect((await truncated.arrayBuffer()).byteLength).toBe(32_768);
      expect((await get<V.SessionSnapshot>(`/sessions/${truncatedPlan.sessionId}`)).plan.sourceGeneration).toBe(truncatedPlan.sourceGeneration + 1);

      const pinned = await start();
      const pinnedPath = pinned.paths.find(path => path.id === pinned.selectedPathId)!;
      await arm({ originalLost409: 1, originalLostVersionUnavailable: true });
      const pinnedUrl = new URL(pinnedPath.url!, mock.url);
      expect((await fetch(pinnedUrl)).status).toBe(409);
      const probe = await fetch(pinnedUrl, { headers: { Range: 'bytes=0-31' } });
      expect(probe.status).toBe(409);
      expect(probe.headers.get('X-Ether-Playback-Error')).toBe('original_lost');
      expect((await get<V.SessionSnapshot>(`/sessions/${pinned.sessionId}`)).plan).toMatchObject({
        sourceGeneration: pinned.sourceGeneration, sourceFailure: 'version_unavailable', positionSeconds: pinned.positionSeconds,
      });
    } finally {
      await arm({ originalLost409: 0, originalLostTruncate: 0, originalLostVersionUnavailable: false });
      await fetch(`${mock.url}/__admin/sidecar`, { method: 'POST', body: JSON.stringify({ enabled: false }) });
    }
  });

  test('bootstrap-only delay leaves independent library reads responsive', async () => {
    const delayed = await launchMock({ VELA_MOCK_BOOTSTRAP_DELAY_MS: '120' });
    try {
      const signed = await fetch(`${delayed.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        idempotencyKey: 'slow-home', username: 'demo', password: 'vela', device: { id: 'slow-home', name: 'Test', platform: 'web', appVersion: '0.1' },
      }) }).then(response => response.json()) as { accessToken: string };
      const headers = { Authorization: `Bearer ${signed.accessToken}`, 'X-Vela-Device-Id': 'slow-home' };
      const homeRead = fetch(`${delayed.url}/vela/v0/bootstrap`, { headers });
      const libraryRead = fetch(`${delayed.url}/vela/v0/libraries?limit=10`, { headers });
      expect(await Promise.race([libraryRead.then(() => 'library'), homeRead.then(() => 'home')])).toBe('library');
      const [library, home] = await Promise.all([libraryRead, homeRead]);
      expect(library.ok).toBe(true);
      expect(home.ok).toBe(true);
    } finally {
      await delayed.stop();
    }
  });

  test('collections-only delay holds back collections while Home, items and rows answer at once', async () => {
    const delayed = await launchMock({ VELA_MOCK_COLLECTIONS_DELAY_MS: '400' });
    try {
      const signed = await fetch(`${delayed.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        idempotencyKey: 'slow-collections', username: 'demo', password: 'vela', device: { id: 'slow-collections', name: 'Test', platform: 'web', appVersion: '0.1' },
      }) }).then(response => response.json()) as { accessToken: string };
      const headers = { Authorization: `Bearer ${signed.accessToken}`, 'X-Vela-Device-Id': 'slow-collections' };
      const read = (path: string) => fetch(`${delayed.url}/vela/v0${path}`, { headers });
      const started = performance.now();
      const collections = read('/libraries/movies/collections?limit=100').then(response => ({ response, ms: performance.now() - started }));
      const others = await Promise.all(['/bootstrap', '/libraries/movies/items?limit=100', '/libraries/movies/rows?limit=100'].map(async path => {
        const response = await read(path);
        return { path, ok: response.ok, ms: performance.now() - started };
      }));
      for (const other of others) {
        expect(other.ok).toBe(true);
        expect(other.ms).toBeLessThan(400);
      }
      const slow = await collections;
      expect(slow.response.ok).toBe(true);
      expect(slow.ms).toBeGreaterThanOrEqual(390);
    } finally {
      await delayed.stop();
    }
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

  test('auto search is refused unless unified search is advertised', async () => {
    const response = await post('/search', { query: 'x', generation: 1, mode: 'auto', idempotencyKey: key() }, authed(tokens));
    expect(await errorCode(response)).toBe('invalid_search');
  });

  test('unified search ranks titles by name, falling back to description matches', async () => {
    const unified = await launchMock({ VELA_MOCK_UNIFIED_SEARCH: '1' });
    try {
      const signed = await fetch(`${unified.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        idempotencyKey: 'unified', username: 'demo', password: 'vela', device: { id: 'unified', name: 'Test', platform: 'web', appVersion: '0.1' },
      }) }).then(response => response.json()) as { accessToken: string };
      const headers = { Authorization: `Bearer ${signed.accessToken}`, 'X-Vela-Device-Id': 'unified', 'Content-Type': 'application/json' };
      const caps = await fetch(`${unified.url}/vela/v0/capabilities`).then(r => r.json()) as V.ServerCapabilities;
      expect(caps.features.unifiedSearch?.available).toBe(true);
      const ask = async (query: string, generation: number) => fetch(`${unified.url}/vela/v0/search`, { method: 'POST', headers,
        body: JSON.stringify({ query, generation, mode: 'auto', idempotencyKey: `unified-${generation}` }) }).then(r => r.json()) as Promise<V.SearchResponse>;
      const channel = await ask('world news', 1);
      expect(channel).toMatchObject({ match: 'none', state: 'complete', generation: 1 });
      expect(channel.live?.channels.map(c => c.id)).toEqual(['channel-1']);
      const some = (await ask('e', 3)).items[0]!;
      const named = await ask(some.name, 4);
      expect(named).toMatchObject({ match: 'title', state: 'complete' });
      expect(named.items.map(t => t.id)).toContain(some.id);
      expect(await ask('zzqx nothing at all', 2)).toMatchObject({ match: 'none', items: [] });
    } finally {
      await unified.stop();
    }
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
