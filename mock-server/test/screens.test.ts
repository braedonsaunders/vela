// The mock's plugin screens against Ether's design: bootstrap navigation and surfaces by renderer,
// immutable documents with deps, data reads with the section 5.4 view models (field by field,
// on a frozen clock), the ether.* actions, and the stream's page topics, replay and frames.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as V from '../../packages/protocol/types';
import { launchMock, type RunningMock } from './launch';

const device: V.Device = { id: 'screens-test-device', name: 'Test', platform: 'web', appVersion: '0.2.0' };
const TZ = 'America/Toronto';
const NFL = 'sports:sports:nfl-nyg-phi';
type Json = Record<string, any>;

async function signIn(mock: RunningMock): Promise<V.Tokens> {
  const response = await fetch(`${mock.url}/vela/v0/auth/sign-in`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'demo', password: 'vela', device, idempotencyKey: crypto.randomUUID() }) });
  return await response.json() as V.Tokens;
}

function client(mock: RunningMock, tokens: () => V.Tokens) {
  const headers = (renderer: string | null = '19') => ({ Authorization: `Bearer ${tokens().accessToken}`, 'X-Vela-Device-Id': device.id, 'Content-Type': 'application/json',
    ...(renderer ? { 'X-Vela-Screen-Renderer': renderer } : {}) });
  const get = (path: string, renderer: string | null = '19', extra: Record<string, string> = {}) =>
    fetch(`${mock.url}${path.startsWith('/vela') ? '' : '/vela/v0'}${path}`, { headers: { ...headers(renderer), ...extra }, redirect: 'manual' });
  const json = async (path: string) => { const response = await get(path); expect(response.status).toBe(200); return await response.json() as Json; };
  const action = (path: string, body: Json, key = crypto.randomUUID()) =>
    fetch(`${mock.url}/vela/v0${path}`, { method: 'POST', headers: { ...headers(), 'Idempotency-Key': key }, body: JSON.stringify({ idempotencyKey: key, ...body }) });
  return { headers, get, json, action };
}

/** Named server events from a stream until `enough` says stop. */
async function readStream(mock: RunningMock, path: string, headers: Record<string, string>, enough: (events: { event: string; data: any }[]) => boolean, ms = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const response = await fetch(`${mock.url}/vela/v0${path}`, { headers, signal: controller.signal });
  const events: { event: string; data: any }[] = [];
  if (!response.ok) { clearTimeout(timer); return { status: response.status, events, body: await response.json() as Json }; }
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!enough(events)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const name = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (data) events.push({ event: name, data: JSON.parse(data) });
      }
    }
  } catch { /* aborted at the deadline */ } finally { clearTimeout(timer); controller.abort(); }
  return { status: response.status, events, body: {} };
}

const query = (params: Record<string, string>) => `?${new URLSearchParams({ tz: TZ, ...params })}`;

describe('on a frozen clock', () => {
  let mock: RunningMock;
  let tokens: V.Tokens;
  let fixtures: string;
  let c: ReturnType<typeof client>;
  beforeAll(async () => {
    // The real Sports documents, plus one test surface (W5 adds Sports' own).
    fixtures = mkdtempSync(join(tmpdir(), 'vela-screens-'));
    cpSync(join(import.meta.dir, '../../packages/protocol/fixtures/screens'), fixtures, { recursive: true });
    mkdirSync(join(fixtures, 'sports/surfaces'), { recursive: true });
    writeFileSync(join(fixtures, 'sports/surfaces/ticker.json'), JSON.stringify({ schema: 1, kind: 'screen', renderer: 19, screen: 'x', page: 'x', version: '1', title: 'Ticker',
      presentation: 'playerOverlay', sources: { live: { from: 'liveEvents', feed: 'sports', query: { window: 'ticker' }, sort: 'featured', exclude: '{context.event}' } }, tree: { type: 'box' } }));
    writeFileSync(join(fixtures, 'sports/surfaces/scorebug.json'), JSON.stringify({ schema: 1, kind: 'screen', renderer: 19, screen: 'sports.scorebug', page: '', version: '1', title: 'Score',
      presentation: 'playerOverlay', sources: { game: { from: 'liveEvent', feed: 'sports', id: '{context.event}' } }, tree: { type: 'box' } }));
    mock = await launchMock({ VELA_MOCK_SPORTS_FREEZE: '1', VELA_MOCK_SCREEN_FIXTURES: fixtures });
    tokens = await signIn(mock);
    c = client(mock, () => tokens);
  });
  afterAll(async () => { await mock?.stop(); rmSync(fixtures, { recursive: true, force: true }); });

  test('bootstrap lists screens and surfaces only to a client that draws them', async () => {
    const none = await (await c.get('/bootstrap', null)).json() as V.Bootstrap;
    expect(none.navigation).toBeUndefined();
    expect(none.surfaces).toBeUndefined();
    expect((await (await c.get('/bootstrap', '18')).json() as V.Bootstrap).navigation).toBeUndefined();
    const boot = await c.json('/bootstrap') as V.Bootstrap;
    expect(boot.navigation).toEqual([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports', page: 'index',
      document: { href: expect.stringMatching(/^\/vela\/v0\/screens\/sports\/pages\/index\/document\?v=[0-9a-f]{16}&r=19&l=en$/), renderer: 19 } }]);
    expect(boot.surfaces!.map(surface => surface.id)).toEqual(['sports.scorebug', 'sports.ticker']);
    expect(boot.surfaces!.slice(0, 1)).toEqual([{ id: 'sports.scorebug', presentation: 'playerOverlay', anchor: 'topLeft', when: { event: { feed: 'sports' } }, visibility: 'always',
      setting: { id: 'scorebug', label: 'Score', default: true, enabled: true }, document: { href: expect.stringContaining('/vela/v0/surfaces/sports.scorebug/document?v='), renderer: 19 } }]);
  });

  test('documents are immutable, carry deps, answer a stale v with the current document and a too-old client with 404', async () => {
    const href = (((await c.json('/bootstrap')) as V.Bootstrap).navigation![0] as V.ScreenNavigationEntry).document.href;
    const response = await c.get(href);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const etag = response.headers.get('etag')!;
    const doc = await response.json() as V.ScreenDocument;
    expect(doc.sources.hero!.deps).toEqual(['league']);
    expect(doc.sources.schedule!.deps).toEqual(['date', 'league']);
    expect(doc.sources.teams!.deps).toEqual(['league', 'teamsLeague']);
    expect(doc.sources.viewer!.deps).toEqual([]);
    expect((await c.get(href, '19', { 'If-None-Match': etag })).status).toBe(304);
    // A stale v gets the current document: 200, no-cache, the current ETag (no redirect).
    const stale = await c.get('/screens/sports/pages/index/document?v=0000&r=19&l=en');
    expect(stale.status).toBe(200);
    expect(stale.headers.get('cache-control')).toBe('private, no-cache');
    expect(stale.headers.get('etag')).toBe(etag);
    expect(((await stale.json()) as Json).sources.hero.deps).toEqual(['league']);
    expect((await c.get(href, '18')).status).toBe(404);
    // Served as Ether serves it: the index is a section; without v the document may change.
    expect(doc).toMatchObject({ screen: 'sports', page: 'index', presentation: 'section' });
    expect((await c.get('/screens/sports/pages/game/document')).headers.get('cache-control')).toBe('private, no-cache');
    expect(((await (await c.get('/screens/sports/pages/game/document')).json()) as Json).presentation).toBe('page');
    expect(((await (await c.get('/surfaces/sports.scorebug/document')).json()) as Json)).toMatchObject({ page: 'main', presentation: 'playerOverlay' });
    expect((await c.get('/screens/sports/pages/nope/document')).status).toBe(404);
  });

  test('a first read answers every eager source, with records, a rev above theirs and a topic', async () => {
    const data = await c.json(`/screens/sports/pages/index/data${query({})}`) as V.ScreenData;
    expect(Object.keys(data.sources).sort()).toEqual(['also', 'hero', 'leagues', 'live', 'schedule', 'viewer', 'yours']);
    expect(data.errors).toBeUndefined();
    expect(data.live!.topic).toMatch(/^lt1\./);
    const revs = Object.values(data.records).map(entry => entry.rev);
    expect(data.rev).toBeGreaterThanOrEqual(Math.max(...revs));
    // Every reference is answered once, in records.
    const refs = JSON.stringify(data.sources).match(/"\$record":"[^"]+"/g)!.map(m => m.slice(11, -1));
    for (const key of refs) expect(data.records[key]).toBeDefined();
    expect(data.sources.viewer).toEqual({ spoilerFree: false, canSetSpoilerFree: true, locale: 'en', favouriteCount: 5 });
    expect((data.sources.leagues as Json).selected).toBe('');
    const french = await (await c.get(`/screens/sports/pages/index/data${query({ sources: 'viewer' })}`, '19', { 'X-Vela-Language': 'fr-CA, en' })).json() as V.ScreenData;
    expect((french.sources.viewer as Json).locale).toBe('fr-CA');
    expect((data.sources.leagues as Json).leagues).toContainEqual({ id: 'epl', name: 'Premier League', abbr: 'EPL', label: 'EPL' });
    // The same read again keeps every rev (nothing changed on a frozen clock).
    const again = await c.json(`/screens/sports/pages/index/data${query({})}`) as V.ScreenData;
    expect(again.rev).toBe(data.rev);
  });

  test('params are validated; sources= reads exactly those; lazy sources answer on request', async () => {
    for (const bad of <Record<string, string>[]>[{ 'p.date': 'tomorrow' }, { 'p.nope': 'x' }, { sources: 'hero,nope' }, { extra: '1' }, { sources: Array.from({ length: 17 }, (_, n) => `s${n}`).join(',') }]) {
      const response = await c.get(`/screens/sports/pages/index/data${query(bad)}`);
      expect(response.status).toBe(400);
      expect(((await response.json()) as Json).error.code).toBe('invalid_request');
    }
    const old = await c.get(`/screens/sports/pages/index/data${query({})}`, '18');
    expect(old.status).toBe(404);
    expect(((await old.json()) as Json).error.code).toBe('update_required');
    expect((await c.get(`/screens/sports/pages/index/data${query({ 'p.date': 'tomorrow' })}`)).status).toBe(400);
    expect((await c.get(`/screens/sports/pages/index/data${query({ 'p.nope': 'x' })}`)).status).toBe(400);
    expect((await c.get(`/screens/sports/pages/index/data${query({ sources: 'hero,nope' })}`)).status).toBe(400);
    const lazy = await c.json(`/screens/sports/pages/index/data${query({ sources: 'standings', 'p.league': 'nhl' })}`) as V.ScreenData;
    expect(Object.keys(lazy.sources)).toEqual(['standings']);
    const standings = lazy.sources.standings as Json;
    expect(standings.league).toEqual({ id: 'nhl', name: 'NHL', label: 'NHL' });
    expect(standings.tables[0].columns).toEqual(['Team', 'GP', 'W', 'L', 'OTL', 'PTS']);
    // Maple Leafs is a default favourite: its row is lit, the others are not.
    expect(standings.tables[0].rows[0]).toEqual({ cells: ['Maple Leafs', '22', '14', '6', '2', '30'], highlight: true });
    expect(standings.tables[0].rows[1]).toEqual({ cells: ['Bruins', '22', '12', '8', '2', '26'] });
  });

  test('event records: a live two-sided game, field by field', async () => {
    const data = await c.json(`/screens/sports/pages/index/data${query({ sources: 'live' })}`) as V.ScreenData;
    const live = (data.sources.live as Json).events as { $record: string }[];
    const events = live.map(r => data.records[r.$record]!.value as Json);
    expect(events.every(e => e.phase === 'live' && e.state === 'in')).toBe(true);
    // Featured: a favourite in progress first, then the rest by start.
    const favourites = events.filter(e => e.favourite).length;
    expect(events.slice(0, favourites).every(e => e.favourite)).toBe(true);
    const e = data.records[`event:${NFL}`]!.value as Json;
    expect(e).toMatchObject({ id: NFL, feed: 'sports', category: 'football', phase: 'live', state: 'in', detail: 'Q4 · 2:14', clock: '2:14', period: 4,
      spoiler: false, close: true, scored: true, favourite: true, league: { id: 'nfl', name: 'NFL', label: 'NFL' }, venue: 'Lincoln Financial Field, Philadelphia' });
    expect(e.title).toBeUndefined(); // only when the plugin gave one
    expect(e.sides.map((s: Json) => [s.id, s.abbr, s.score, s.favourite, s.winner, s.loser])).toEqual([['nfl-nyg', 'NYG', '24', false, false, false], ['nfl-phi', 'PHI', '27', true, false, false]]);
    expect(e.sides[1]).toMatchObject({ name: expect.any(String), short: expect.any(String), logo: '/vela/v0/sports-mock/logos/nfl-phi.svg', color: expect.stringMatching(/^#[0-9a-f]{6}$/), altColor: expect.stringMatching(/^#[0-9a-f]{6}$/), record: expect.any(String), entityId: 'nfl-phi' });
    // Possession names PHI exactly: it moves onto the side and out of the situation ("NYG 38" only mentions a side).
    expect(e.situation).toEqual([{ label: 'Down', value: '3rd & 6' }, { label: 'Ball', value: 'NYG 38' }]);
    expect(e.sides.map((s: Json) => s.possession)).toEqual([false, true]);
    const p = e.probability;
    expect(p.subjectSide).toBe(1);
    expect(p.away).toBeCloseTo(1 - p.home, 3);
    expect(e.sides[0].share + e.sides[1].share).toBe(100);
    expect(e.sides[1].share).toBe(Math.round(p.home * 100));
    expect(p.leader).toEqual({ abbr: p.home >= 0.5 ? 'PHI' : 'NYG', share: Math.round(Math.max(p.home, 1 - p.home) * 100) });
    expect(e.sides[1].leads).toBe(p.home >= 0.5);
    expect(e.sides[0].leads).toBe(p.home < 0.5);
    // Where to watch: tunable targets only, best first, primary = first, airing de-duplicated.
    expect(e.watch.targets.length).toBeGreaterThan(0);
    expect(e.watch.targets.every((t: Json) => typeof t.channelId === 'string')).toBe(true);
    expect(e.watch.primary).toEqual(e.watch.targets[0]);
    expect(e.watch.airing.length).toBeLessThanOrEqual(2);
    expect(e.plays).toBeUndefined(); // detail is its own record
  });

  test('event records: upcoming, final, spoiler-free and N-competitor', async () => {
    const data = await c.json(`/screens/sports/pages/index/data${query({ sources: 'schedule,yours' })}`) as V.ScreenData;
    const read = async (id: string) => {
      const game = await c.json(`/screens/sports/pages/game/data${query({ 'p.event': `sports:sports:${id}` })}`) as V.ScreenData;
      return game.records[`event:sports:sports:${id}`]!.value as Json;
    };
    void data;
    const upcoming = await read('nba-bos-nyk');
    expect(upcoming).toMatchObject({ phase: 'upcoming', state: 'pre', scored: false, close: false });
    expect(upcoming.sides.map((s: Json) => s.score)).toEqual(['', '']);
    expect(upcoming.probability).toBeUndefined();
    const final = await read('nba-mil-tor');
    expect(final).toMatchObject({ phase: 'final', scored: true });
    expect(final.sides.map((s: Json) => [s.abbr, s.score, s.winner, s.loser])).toEqual([['MIL', '109', false, true], ['TOR', '118', true, false]]);
    const hidden = await read('epl-che-mci');
    expect(hidden).toMatchObject({ phase: 'final', spoiler: true, scored: false, close: false, situation: [] });
    expect(hidden.probability).toBeUndefined();
    expect(hidden.sides.every((s: Json) => s.score === '' && !s.winner)).toBe(true);
    const race = await read('f1-las-vegas');
    expect(race.sides).toBeUndefined();
    expect(race.title).toBe('Las Vegas Grand Prix');
    expect(race.ranking[0]).toEqual({ place: '1', pos: 1, name: 'Max Verstappen', abbr: 'VER', detail: 'Leader', secondary: '', entityId: 'f1-ver', favourite: false });
  });

  test('the game page: an event and a detail record (plays both ways, tables with lit rows, series, links)', async () => {
    const data = await c.json(`/screens/sports/pages/game/data${query({ 'p.event': NFL })}`) as V.ScreenData;
    expect(data.sources.game).toEqual({ event: { $record: `event:${NFL}` }, detail: { $record: `detail:${NFL}` } });
    const detail = data.records[`detail:${NFL}`]!.value as Json;
    expect(detail.id).toBe(NFL);
    expect(detail.plays.length).toBeGreaterThan(2);
    expect(detail.playsNewest).toEqual([...detail.plays].reverse());
    // Oldest first: the scripted 11:02 touchdown precedes the 2:14 rush.
    expect(detail.plays.findIndex((p: Json) => p.clock === '11:02')).toBeLessThan(detail.plays.findIndex((p: Json) => p.clock === '2:14'));
    expect(detail.plays[0]).toMatchObject({ text: expect.any(String), emphasis: expect.stringMatching(/^(score|key|normal)$/) });
    // Timed plays (at, and the score after each) for asOf; times rise with the game.
    expect(detail.plays.find((p: Json) => p.clock === '6:40')).toMatchObject({ at: expect.any(String), score: { 'nfl-nyg': '24', 'nfl-phi': '24' }, scores: ['24', '24'] });
    // scores: the score map in sides order (away NYG, home PHI), on both lists.
    expect(detail.playsNewest.find((p: Json) => p.clock === '3:30').scores).toEqual(['24', '27']);
    const ats = detail.plays.map((p: Json) => Date.parse(p.at));
    expect(ats).toEqual([...ats].sort((a, b) => a - b));
    const hockey = await c.json(`/screens/sports/pages/game/data${query({ 'p.event': 'sports:sports:nhl-tor-mtl' })}`) as V.ScreenData;
    expect(((hockey.records['detail:sports:sports:nhl-tor-mtl']!.value as Json).plays as Json[]).every(p => p.at === undefined && p.score === undefined && p.scores === undefined)).toBe(true);
    const scoring = detail.tables[0];
    expect(scoring.title).toBe('Scoring');
    expect(scoring.rows.find((r: Json) => r.cells[0] === 'PHI').highlight).toBe(true);
    expect(scoring.rows.find((r: Json) => r.cells[0] === 'NYG').highlight).toBeUndefined();
    expect(detail.probabilitySeries.length).toBeGreaterThan(2);
    expect(detail.links).toEqual([{ label: 'Game centre', url: { href: `https://example.invalid/sports/${encodeURIComponent(NFL)}`, host: 'example.invalid' } }]);
    // A record key works as the ref too; an unknown event is a 404 for the whole read.
    expect((await c.get(`/screens/sports/pages/game/data${query({ 'p.event': `event:${NFL}` })}`)).status).toBe(200);
    // An event the viewer cannot read is that source's not_found, not a 404 (a 404 is only a page the viewer may not see).
    const missing = await c.json(`/screens/sports/pages/game/data${query({ 'p.event': 'sports:sports:nope' })}`) as V.ScreenData;
    expect(missing.errors).toEqual({ game: { code: 'not_found' } });
    expect(missing.sources.viewer).toBeDefined();
  });

  test('schedule, leagues filter, the team picker and the hero', async () => {
    const data = await c.json(`/screens/sports/pages/index/data${query({ sources: 'schedule,hero,yours', 'p.league': 'nfl' })}`) as V.ScreenData;
    const schedule = data.sources.schedule as Json;
    expect(schedule.days.length).toBe(7);
    const today = schedule.date;
    expect(schedule.days[2].date).toBe(today);
    expect(schedule.previous).toBe(schedule.days[1].date);
    expect(schedule.next).toBe(schedule.days[3].date);
    const events = (schedule.events as { $record: string }[]).map(r => data.records[r.$record]!.value as Json);
    expect(events.every(e => e.league.id === 'nfl')).toBe(true);
    expect(events.map(e => Date.parse(e.start))).toEqual(events.map(e => Date.parse(e.start)).sort((a, b) => a - b));
    expect(schedule.days[2].count).toBe(events.length);
    const hero = (data.sources.hero as Json).events;
    expect(hero.length).toBe(1);
    expect(data.records[hero[0].$record]!.value).toMatchObject({ phase: 'live', favourite: true, league: { id: 'nfl' } });
    expect(((data.sources.yours as Json).events as { $record: string }[]).every(r => (data.records[r.$record]!.value as Json).favourite)).toBe(true);
    const picker = async (params: Record<string, string>) => (await c.json(`/screens/sports/pages/index/data${query({ sources: 'teams', ...params })}`)) as V.ScreenData;
    const opened = await picker({});
    const teams = opened.sources.teams as Json;
    expect(teams.opening).toBe('nfl'); // a favourite's league
    const entities = (teams.entities as { $record: string }[]).map(r => opened.records[r.$record]!.value as Json);
    expect(entities.every(t => t.league === 'nfl')).toBe(true);
    expect(entities[0]).toEqual({ key: 'sports:sports:team:nfl-phi', id: 'nfl-phi', name: expect.any(String), abbr: 'PHI', logo: '/vela/v0/sports-mock/logos/nfl-phi.svg', league: 'nfl', color: expect.stringMatching(/^#/), favourite: true });
    expect(teams.leagues.map((l: Json) => l.id)).toContain('f1');
    expect((((await picker({ 'p.league': 'nba' })).sources.teams) as Json).opening).toBe('nba'); // prefer
    expect((((await picker({ 'p.league': 'nba', 'p.teamsLeague': 'nhl' })).sources.teams) as Json).opening).toBe('nhl');
  });

  test('a forced timeout answers errors.<id> = {code: timeout, retry: true} for that many reads', async () => {
    await fetch(`${mock.url}/__admin/screens`, { method: 'POST', body: JSON.stringify({ timeout: { source: 'live', times: 2 } }) });
    for (let n = 0; n < 2; n++) {
      const data = await c.json(`/screens/sports/pages/index/data${query({ sources: 'live,hero' })}`) as V.ScreenData;
      expect(data.errors).toEqual({ live: { code: 'timeout', retry: true } });
      expect(data.sources.hero).toBeDefined();
    }
    expect(((await c.json(`/screens/sports/pages/index/data${query({ sources: 'live' })}`)) as V.ScreenData).errors).toBeUndefined();
  });

  test('the ticker window: in progress, finals started under 30 h ago, upcoming within 6 h, featured order', async () => {
    const data = await c.json(`/surfaces/sports.ticker/data${query({ 'p.kind': 'channel' })}`) as V.ScreenData;
    const events = ((data.sources.live as Json).events as { $record: string }[]).map(r => data.records[r.$record]!.value as Json);
    const ids = events.map(e => e.id.replace('sports:sports:', ''));
    expect([...ids].sort()).toEqual(['epl-ars-liv', 'epl-che-mci', 'f1-las-vegas', 'nba-bos-nyk', 'nba-gsw-lal', 'nba-mil-tor', 'nfl-buf-kc', 'nfl-dal-wsh', 'nfl-nyg-phi', 'nhl-nyr-bos', 'nhl-tor-mtl']);
    const rank = { live: 0, upcoming: 1, final: 2 } as Record<string, number>;
    expect(events.map(e => rank[e.phase])).toEqual(events.map(e => rank[e.phase]).sort());
    expect(events[0]!.favourite).toBe(true);
    // The playing game is left out (exclude: {context.event}).
    const playing = await c.json(`/surfaces/sports.ticker/data${query({ 'p.kind': 'channel', 'p.event': `event:${NFL}` })}`) as V.ScreenData;
    expect(((playing.sources.live as Json).events as { $record: string }[]).map(r => r.$record)).not.toContain(`event:${NFL}`);
    expect(((playing.sources.live as Json).events as unknown[]).length).toBe(10);
  });

  test('ether.favorite patches the entity and its events, names the sources to re-read, and refuses other body fields', async () => {
    const ref = 'entity:sports:sports:team:nfl-dal';
    const before = (await c.json(`/screens/sports/pages/index/data${query({ sources: 'viewer' })}`)).sources.viewer.favouriteCount;
    const response = await c.action('/screens/sports/actions/ether.favorite', { page: 'index', params: {}, args: { ref, on: 'true' } });
    expect(response.status).toBe(200);
    const answer = await response.json() as V.ScreenActionAnswer;
    expect((answer.records![ref]!.value as Json).favourite).toBe(true);
    expect((answer.records!['event:sports:sports:nfl-dal-wsh']!.value as Json).favourite).toBe(true);
    // Built-in answers carry every source of the page re-read, lazy ones included.
    expect(Object.keys(answer.sources!).sort()).toEqual(['also', 'hero', 'leagues', 'live', 'schedule', 'standings', 'teams', 'viewer', 'yours']);
    expect(answer.refresh).toBeUndefined();
    expect((answer.sources!.viewer as Json).favouriteCount).toBe(before + 1);
    expect((await c.json(`/screens/sports/pages/index/data${query({ sources: 'viewer' })}`)).sources.viewer.favouriteCount).toBe(before + 1);
    await c.action('/screens/sports/actions/ether.favorite', { page: 'index', params: {}, args: { ref, on: false } });
    expect((await c.json(`/screens/sports/pages/index/data${query({ sources: 'viewer' })}`)).sources.viewer.favouriteCount).toBe(before);
    expect((await c.action('/screens/sports/actions/ether.favorite', { page: 'index', params: {}, args: { ref, on: 'false' }, tz: TZ })).status).toBe(200);
    const extra = await c.action('/screens/sports/actions/ether.favorite', { page: 'index', params: {}, args: { ref, on: 'true' }, optimistic: {} });
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as Json).error.code).toBe('invalid_request');
    expect((await c.action('/screens/sports/actions/nope', { page: 'index', params: {}, args: {} })).status).toBe(404);
  });

  test('reveal and spoiler-free change the event records the viewer reads', async () => {
    const id = 'sports:sports:epl-che-mci';
    const revealed = await (await c.action('/screens/sports/actions/ether.reveal', { page: 'game', params: { event: id }, args: { event: id } })).json() as V.ScreenActionAnswer;
    expect(revealed.records![`event:${id}`]!.value).toMatchObject({ spoiler: false, scored: true });
    expect(revealed.records![`detail:${id}`]).toBeDefined();
    const on = await (await c.action('/screens/sports/actions/ether.spoilerFree', { page: 'index', params: {}, args: { on: 'true' } })).json() as V.ScreenActionAnswer;
    expect((on.sources!.viewer as Json).spoilerFree).toBe(true);
    expect((on.records![`event:${NFL}`]!.value as Json)).toMatchObject({ spoiler: true, scored: false });
    expect((on.records!['event:sports:sports:nba-bos-nyk']!.value as Json).spoiler).toBe(false); // not started
    await c.action('/screens/sports/actions/ether.spoilerFree', { page: 'index', params: {}, args: { on: false } });
    expect(((await c.json(`/screens/sports/pages/index/data${query({ sources: 'viewer' })}`)).sources.viewer).spoilerFree).toBe(false);
  });

  test('surfaces: context reads as p.<name>, an unknown ref fails its source, the setting is remembered', async () => {
    const data = await c.json(`/surfaces/sports.scorebug/data${query({ 'p.event': `event:${NFL}` })}`) as V.ScreenData;
    expect(data.sources.game).toEqual({ event: { $record: `event:${NFL}` }, detail: { $record: `detail:${NFL}` } });
    expect(((await c.json(`/surfaces/sports.scorebug/data${query({ 'p.event': 'event:sports:sports:nope' })}`)) as V.ScreenData).errors).toEqual({ game: { code: 'not_found' } });
    const put = await fetch(`${mock.url}/vela/v0/surfaces/sports.scorebug/setting`, { method: 'PUT', headers: { ...c.headers(), 'Idempotency-Key': 'set-1' }, body: JSON.stringify({ enabled: false, idempotencyKey: 'set-1' }) });
    expect(put.status).toBe(204);
    expect(((await c.json('/bootstrap')) as V.Bootstrap).surfaces![0]!.setting!.enabled).toBe(false);
    expect((await c.get('/surfaces/sports.nope/document')).status).toBe(404);
  });

  test('the stream replays a page topic above since, refuses a fifth topic and an unknown one', async () => {
    const data = await c.json(`/screens/sports/pages/index/data${query({})}`) as V.ScreenData;
    const topic = data.live!.topic;
    // since=0: every record and source of the topic.
    const all = await readStream(mock, `/live/stream?topic=${topic}&since=0&tz=${encodeURIComponent(TZ)}`, c.headers(), events => events.some(e => e.event === 'source') && events.filter(e => e.event === 'source').length >= 7, 3000);
    const records = all.events.find(e => e.event === 'records')!.data.records as Record<string, V.RecordEntry>;
    expect(Object.keys(records).sort()).toEqual(Object.keys(data.records).sort());
    const sources = all.events.filter(e => e.event === 'source').map(e => e.data);
    expect(sources.map(s => s.source).sort()).toEqual(['also', 'hero', 'leagues', 'live', 'schedule', 'viewer', 'yours']);
    expect(sources[0]).toMatchObject({ screen: 'sports', page: 'index', rev: expect.any(Number) });
    expect(sources[0].surface).toBeUndefined();
    // since = the page's rev: nothing has changed on a frozen clock, so nothing is replayed.
    const none = await readStream(mock, `/live/stream?topic=${topic}&since=${data.rev}`, c.headers(), () => false, 600);
    expect(none.events.filter(e => e.event === 'records' || e.event === 'source')).toEqual([]);
    const five = await readStream(mock, `/live/stream?${Array.from({ length: 5 }, () => `topic=${topic}`).join('&')}`, c.headers(), () => true);
    expect(five.status).toBe(400);
    expect(five.body.error.code).toBe('too_many_topics');
    expect((await readStream(mock, '/live/stream?topic=lt1.bogus', c.headers(), () => true)).status).toBe(400);
  });
});

describe('an owner hiding a screen', () => {
  let mock: RunningMock;
  let tokens: V.Tokens;
  let c: ReturnType<typeof client>;
  beforeAll(async () => {
    mock = await launchMock({ VELA_MOCK_SPORTS_FREEZE: '1' });
    tokens = await signIn(mock);
    c = client(mock, () => tokens);
  });
  afterAll(async () => { await mock?.stop(); });

  test('ends the streams following it; it leaves bootstrap and its reads answer 404', async () => {
    const data = await c.json(`/screens/sports/pages/index/data${query({})}`) as V.ScreenData;
    const ended = readStream(mock, `/live/stream?topic=${data.live!.topic}&since=${data.rev}`, c.headers(), () => false, 5000);
    await Bun.sleep(300);
    const started = Date.now();
    await fetch(`${mock.url}/__admin/screens`, { method: 'POST', body: JSON.stringify({ hide: ['sports'] }) });
    await ended;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(((await c.json('/bootstrap')) as V.Bootstrap).navigation).toBeUndefined();
    expect((await c.get(`/screens/sports/pages/index/data${query({})}`)).status).toBe(404);
    await fetch(`${mock.url}/__admin/screens`, { method: 'POST', body: JSON.stringify({ show: ['sports'] }) });
    expect((await c.get(`/screens/sports/pages/index/data${query({})}`)).status).toBe(200);
  });
});

describe('the news desk: plugin sources and a plugin action', () => {
  let mock: RunningMock;
  let tokens: V.Tokens;
  let c: ReturnType<typeof client>;
  beforeAll(async () => {
    mock = await launchMock({ VELA_MOCK_SPORTS_FREEZE: '1', VELA_MOCK_NEWS: '1' });
    tokens = await signIn(mock);
    c = client(mock, () => tokens);
  });
  afterAll(async () => { await mock?.stop(); });

  test('a plugin source arrives rewritten: p: records, same-origin images, https links, no bare URLs', async () => {
    const boot = await c.json('/bootstrap') as V.Bootstrap;
    expect(boot.navigation!.map(entry => entry.id)).toEqual(['sports', 'news']);
    const data = await c.json(`/screens/news/pages/index/data${query({ 'p.topic': 'tech' })}`) as V.ScreenData;
    const front = data.sources.front as Json;
    expect(front.topicName).toBe('Tech');
    expect(front.breaking).toBeNull();
    expect(front.lead).toEqual([{ $record: 'p:story:chips' }]);
    expect(front.stories).toEqual([{ $record: 'p:story:open' }]);
    expect(front.source).toEqual({ href: 'https://news.example/front', host: 'news.example' });
    const story = data.records['p:story:chips']!.value as Json;
    expect(story).toMatchObject({ title: expect.any(String), section: 'Hardware', link: { href: 'https://news.example/story/chips', host: 'news.example' } });
    expect(story.image).toMatch(/^\/vela\/v0\/artwork\/[0-9a-f]{12}\?/);
    // items and channels are not in Ether E1/E2; the rest of the page draws.
    expect(data.errors).toEqual({ watch: { code: 'unsupported' }, liveNews: { code: 'unsupported' } });
    const mine = await c.json(`/screens/news/pages/index/data${query({ sources: 'mine' })}`) as V.ScreenData;
    expect(mine.sources.mine).toEqual({ followsTopic: false, topics: [] });
  });

  test('a plugin action: typed arguments, refresh read again into sources, toast; undeclared or mistyped refused', async () => {
    const response = await c.action('/screens/news/actions/follow-topic', { page: 'index', params: { topic: 'tech' }, args: { topic: 'tech', on: true } });
    expect(response.status).toBe(200);
    const answer = await response.json() as V.ScreenActionAnswer;
    expect(answer.toast).toBe('Following Tech');
    expect(answer.sources).toEqual({ mine: { followsTopic: false, topics: ['tech'] } });
    expect(answer.refresh).toBeUndefined();
    // Ether checks declared types: a bool is JSON true/false, not text.
    const text = await c.action('/screens/news/actions/follow-topic', { page: 'index', params: {}, args: { topic: 'tech', on: 'true' } });
    expect(text.status).toBe(400);
    expect((await c.action('/screens/news/actions/follow-topic', { page: 'index', params: {}, args: { topic: 'sports', on: true } })).status).toBe(400);
    expect((await c.action('/screens/news/actions/follow-topic', { page: 'index', params: {}, args: { topic: 'tech', on: true, extra: 'x' } })).status).toBe(400);
    expect((await c.action('/screens/news/actions/delete-everything', { page: 'index', params: {}, args: {} })).status).toBe(404);
  });
});

describe('with the clock running', () => {
  let mock: RunningMock;
  let tokens: V.Tokens;
  let c: ReturnType<typeof client>;
  beforeAll(async () => {
    mock = await launchMock({ VELA_MOCK_LIVE_TICK_MS: '120' });
    tokens = await signIn(mock);
    c = client(mock, () => tokens);
  });
  afterAll(async () => { await mock?.stop(); });

  test('a live game pushes newer event records on its page topic', async () => {
    const data = await c.json(`/screens/sports/pages/game/data${query({ 'p.event': NFL })}`) as V.ScreenData;
    const stream = await readStream(mock, `/live/stream?topic=${data.live!.topic}&since=${data.rev}`, c.headers(),
      events => events.some(e => e.event === 'records' && e.data.records[`event:${NFL}`]), 8000);
    const pushed = stream.events.find(e => e.event === 'records' && e.data.records[`event:${NFL}`])!.data.records as Record<string, V.RecordEntry>;
    expect(pushed[`event:${NFL}`]!.rev).toBeGreaterThan(data.records[`event:${NFL}`]!.rev);
    expect(pushed[`event:${NFL}`]!.value).toMatchObject({ id: NFL, league: { id: 'nfl' } });
  });

  test('alerts on a screens stream are Ether alert frames', async () => {
    const stream = readStream(mock, '/live/stream?alerts=1', c.headers(), events => events.some(e => e.event === 'alert'), 6000);
    await Bun.sleep(300);
    await fetch(`${mock.url}/__admin/sports`, { method: 'POST', body: JSON.stringify({ alert: { kind: 'close', eventId: NFL } }) });
    const alert = (await stream).events.find(e => e.event === 'alert')!.data as V.AlertFrame;
    expect(alert).toEqual({ id: expect.any(String), kind: 'close', title: 'Close game', body: expect.stringContaining('–'), at: expect.any(String), ref: `event:${NFL}`, plugin: 'sports' });
  });
});
