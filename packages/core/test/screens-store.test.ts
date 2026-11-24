// The screens slice against a scripted adapter: first reads, re-reads by deps with the old data
// kept, overtaken answers dropped, lazy sources, per-source errors, optimistic patches, the
// stream's topics, frames and reconnect, and records released with the pages that read them.
import { afterEach, expect, test } from 'bun:test';
import type * as V from '../src/wire';
import type { PluginScreens, ScreenDataRead } from '../src/adapter/capabilities';
import type { ScreenTarget } from '../src/screens/keys';
import type { ScreenStreamQuery } from '../src/screens/stream';
import type { EventHandler } from '../src/protocol/sse';
import { initialScreens, Screens } from '../src/store/screens';
import type { Session } from '../src/store/session';
import { StateBox } from '../src/store/state';
import type { VelaState } from '../src/store';

const INDEX: ScreenTarget = { kind: 'screen', id: 'sports', page: 'index' };
const HREF = '/vela/v0/screens/sports/pages/index/document?v=1&r=19&l=en';
const DOC = {
  schema: 1, kind: 'screen', renderer: 19, screen: 'sports', page: 'index', version: '2', title: 'Sports', presentation: 'section',
  sources: {
    viewer: { from: 'viewer', deps: [] },
    hero: { from: 'liveEvents', deps: ['league'] },
    schedule: { from: 'liveSchedule', deps: ['league', 'date'] },
    standings: { from: 'liveTables', lazy: true, deps: ['league'] },
  },
  tree: { type: 'box' },
} as unknown as V.ScreenDocument;

interface Call { target: ScreenTarget; read: ScreenDataRead; resolve(data: Partial<V.ScreenData>): void; reject(error: unknown): void }

class FakeApi implements PluginScreens {
  calls: Call[] = [];
  actions: { action: string; request: V.ScreenActionRequest; key: string; resolve(answer: V.ScreenActionAnswer): void; reject(error: unknown): void }[] = [];
  streams: { query: ScreenStreamQuery; tz: string; onEvent: EventHandler; close(): void }[] = [];
  document: V.ScreenDocument = DOC;
  /** Answer data reads at once with this, unless null (then they wait for resolve). */
  auto: ((read: ScreenDataRead) => Partial<V.ScreenData>) | null = null;
  async screenDocument(href: string) { return { document: this.document, href }; }
  screenData(target: ScreenTarget, read: ScreenDataRead): Promise<V.ScreenData> {
    return new Promise((resolve, reject) => {
      const call: Call = { target, read, resolve: data => resolve({ rev: 0, sources: {}, records: {}, ...data } as V.ScreenData), reject };
      this.calls.push(call);
      if (this.auto) call.resolve(this.auto(read));
    });
  }
  screenAction(_target: ScreenTarget, action: string, request: V.ScreenActionRequest, mutation: V.Mutation): Promise<V.ScreenActionAnswer> {
    return new Promise((resolve, reject) => { this.actions.push({ action, request, key: mutation.idempotencyKey, resolve, reject }); });
  }
  settings: { id: string; enabled: boolean }[] = [];
  failSetting = false;
  async setSurfaceSetting(id: string, enabled: boolean) { if (this.failSetting) throw new Error('nope'); this.settings.push({ id, enabled }); }
  streamScreens(query: ScreenStreamQuery, tz: string, onEvent: EventHandler, signal?: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const stream = { query, tz, onEvent, close: () => resolve() };
      this.streams.push(stream);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

function harness() {
  const api = new FakeApi();
  const box = new StateBox<VelaState>({ screens: initialScreens } as VelaState);
  const resets = new Set<() => void>();
  let keys = 0;
  const session = {
    epoch: 0, hasServer: () => true, selected: () => ({ adapter: api }), ready: async () => ({ adapter: api }),
    key: () => `key-${++keys}`, onReset: (listener: () => void) => { resets.add(listener); return () => resets.delete(listener); },
  } as unknown as Session;
  const screens = new Screens(box, session, 19, () => 5);
  const reset = () => { (session as { epoch: number }).epoch++; for (const listener of resets) listener(); };
  return { api, box, screens, reset, page: (key: string) => box.get().screens.pages[key]! };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = () => new Promise(resolve => setTimeout(resolve, 160));
const event = (id: string, rev: number, value: Record<string, unknown> = {}) => ({ [`event:${id}`]: { rev, value: { id, ...value } } });
let opened: { release(): void }[] = [];
afterEach(() => { for (const handle of opened) handle.release(); opened = []; });
function open(h: ReturnType<typeof harness>, params: Record<string, string> = {}, from?: string) {
  const handle = h.screens.open({ target: INDEX, href: HREF, params }, from);
  opened.push(handle);
  return handle;
}

test('a first read asks for every eager source, then the page is ready with its records, rev and topic', async () => {
  const h = harness();
  const { key } = open(h, { league: 'nfl', date: '' });
  expect(key).toBe('screen:sports/index?league=nfl');
  expect(h.page(key).load).toBe('loading');
  await flush();
  expect(h.api.calls[0]!.read).toEqual({ params: { league: 'nfl' }, context: {}, tz: expect.any(String) });
  h.api.calls[0]!.resolve({ rev: 7, sources: { hero: { events: [{ $record: 'event:a' }] }, viewer: { spoilerFree: false } }, records: event('a', 3), live: { topic: 'lt1.a' } });
  await flush();
  const page = h.page(key);
  expect(page).toMatchObject({ load: 'ready', rev: 7, topic: 'lt1.a', params: { league: 'nfl' }, pending: {}, errors: {} });
  expect(h.screens.records.get('event:a')).toEqual({ rev: 3, value: { id: 'a' } });
  expect(h.box.get().screens.documents[HREF]?.load).toBe('ready');
});

test('a param change re-reads only the sources depending on it, keeping their old value pending', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 10, sources: { viewer: { n: 1 }, hero: { league: 'nfl' }, schedule: { date: 'd1' } }, live: { topic: 't1' } });
  const first = open(h, { league: 'nfl', date: 'd1' });
  await flush(); await flush();
  const before = h.page(first.key);
  h.api.auto = null;
  first.release();
  const next = open(h, { league: 'nfl', date: 'd2' }, first.key);
  await flush();
  expect(h.api.calls.at(-1)!.read.sources).toEqual(['schedule']);
  const pending = h.page(next.key);
  expect(pending.params).toEqual({ league: 'nfl', date: 'd2' });
  expect(pending.pending).toEqual({ schedule: true });
  expect(pending.sources.schedule).toEqual({ date: 'd1' }); // drawn until the answer
  expect(pending.sources.viewer).toBe(before.sources.viewer);
  expect(pending.topic).toBe('t1');
  h.api.calls.at(-1)!.resolve({ rev: 11, sources: { schedule: { date: 'd2' } }, live: { topic: 't2' } });
  await flush();
  expect(h.page(next.key)).toMatchObject({ pending: {}, sources: { schedule: { date: 'd2' }, hero: { league: 'nfl' } }, rev: 11, topic: 't2' });
  // A league change re-reads both league sources.
  next.release();
  const third = open(h, { league: 'nba', date: 'd2' }, next.key);
  await flush();
  expect(h.api.calls.at(-1)!.read.sources).toEqual(['hero', 'schedule']);
  expect(h.page(third.key).pending).toEqual({ hero: true, schedule: true });
});

test('an answer overtaken by a later read of the same source is dropped', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 1, sources: { hero: 'first' } });
  const { key } = open(h);
  await flush(); await flush();
  h.api.auto = null;
  h.screens.refresh(key);           // a whole read (hero among them)
  await h.screens.loadDocument(HREF);
  void h.screens.retry(key, ['hero']); // a later read of hero alone
  await flush();
  const [whole, named] = h.api.calls.slice(-2);
  named!.resolve({ rev: 3, sources: { hero: 'newest' } });
  await flush();
  whole!.resolve({ rev: 2, sources: { hero: 'stale', viewer: 'v' } });
  await flush();
  expect(h.page(key).sources).toMatchObject({ hero: 'newest', viewer: 'v' });
  expect(h.page(key).pending).toEqual({});
});

test('lazy sources are read when needed, once, and join refreshes', async () => {
  const h = harness();
  h.api.auto = read => ({ rev: 1, sources: Object.fromEntries((read.sources ?? ['viewer', 'hero', 'schedule']).map(name => [name, name])) });
  const { key } = open(h);
  await h.screens.loadDocument(HREF);
  await flush(); await flush();
  await h.screens.need(key, ['standings', 'standings']);
  await h.screens.need(key, ['standings']);
  const reads = h.api.calls.map(call => call.read.sources);
  expect(reads).toEqual([undefined, ['standings']]);
  expect(h.page(key).sources.standings).toBe('standings');
  h.screens.refresh(key);
  await flush();
  expect(h.api.calls.at(-1)!.read.sources).toEqual(['hero', 'schedule', 'standings', 'viewer']);
});

test('a source error leaves the rest drawn and retry reads only it; a failed first read fails the page', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 1, sources: { hero: 'h' }, errors: { schedule: { code: 'timeout', retry: true } } });
  const { key } = open(h);
  await flush(); await flush();
  expect(h.page(key)).toMatchObject({ load: 'ready', sources: { hero: 'h' }, errors: { schedule: 'timeout' } });
  h.api.auto = () => ({ rev: 2, sources: { schedule: 's' } });
  await h.screens.retry(key);
  expect(h.api.calls.at(-1)!.read.sources).toEqual(['schedule']);
  expect(h.page(key)).toMatchObject({ sources: { hero: 'h', schedule: 's' }, errors: {} });

  const failing = harness();
  const other = open(failing, { league: 'x' });
  await flush();
  failing.api.calls[0]!.reject(Object.assign(new Error('Not found'), { status: 404 }));
  await flush();
  expect(failing.page(other.key)).toMatchObject({ load: 'failed', failure: 'not_found', error: 'Not found' });
  failing.api.auto = () => ({ rev: 1, sources: { hero: 'h' } });
  await failing.screens.retry(other.key);
  expect(failing.api.calls.at(-1)!.read.sources).toBeUndefined();
  expect(failing.page(other.key).load).toBe('ready');
});

test('an optimistic record patch shows at once and gives way to the answer; a failure undoes it', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 1, sources: { teams: { entities: [{ $record: 'entity:phi' }] } }, records: { 'entity:phi': { rev: 4, value: { name: 'Eagles', favourite: false } } } });
  const { key } = open(h);
  await flush(); await flush();
  const original = h.screens.records.get('entity:phi');
  const pressed = h.screens.action(key, { name: 'ether.favorite', args: { ref: 'entity:phi', on: 'true' }, optimistic: { record: 'entity:phi', path: 'favourite', value: 'true' }, control: 'chip-phi' });
  await flush();
  expect(h.screens.records.get('entity:phi')!.value).toEqual({ name: 'Eagles', favourite: true });
  expect(h.box.get().screens.busy[`${key}#chip-phi`]).toBe(true);
  const sent = h.api.actions[0]!;
  expect(sent.action).toBe('ether.favorite');
  expect(sent.request).toEqual({ page: 'index', params: {}, args: { ref: 'entity:phi', on: 'true' } });
  expect(sent.key).toBe('key-1');
  sent.resolve({ records: { 'entity:phi': { rev: 5, value: { name: 'Eagles', favourite: true } } }, refresh: ['yours'], toast: 'Saved' });
  expect((await pressed).toast).toBe('Saved');
  expect(h.screens.records.get('entity:phi')).toEqual({ rev: 5, value: { name: 'Eagles', favourite: true } });
  expect(h.box.get().screens.busy).toEqual({});
  await flush();
  expect(h.api.calls.at(-1)!.read.sources).toEqual(['yours']);

  const failing = h.screens.action(key, { name: 'ether.favorite', optimistic: { record: 'entity:phi', path: 'favourite', value: false } });
  await flush();
  expect((h.screens.records.get('entity:phi')!.value as { favourite: boolean }).favourite).toBe(false);
  h.api.actions[1]!.reject(new Error('rate limited'));
  await expect(failing).rejects.toThrow('rate limited');
  expect(h.screens.records.get('entity:phi')).toEqual({ rev: 5, value: { name: 'Eagles', favourite: true } });
  expect(original).toEqual({ rev: 4, value: { name: 'Eagles', favourite: false } });
});

test('an optimistic source patch is undone unless the answer replaced the source', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 1, sources: { viewer: { spoilerFree: false, canSetSpoilerFree: true } } });
  const { key } = open(h);
  await flush(); await flush();
  const pressed = h.screens.action(key, { name: 'ether.spoilerFree', args: { on: 'true' }, optimistic: { source: 'viewer', path: 'spoilerFree', value: 'true' } });
  await flush();
  expect(h.page(key).sources.viewer).toEqual({ spoilerFree: true, canSetSpoilerFree: true });
  h.api.actions[0]!.resolve({ sources: { viewer: { spoilerFree: true, canSetSpoilerFree: true, from: 'server' } } });
  await pressed;
  expect(h.page(key).sources.viewer).toEqual({ spoilerFree: true, canSetSpoilerFree: true, from: 'server' });
  const undone = h.screens.action(key, { name: 'ether.spoilerFree', optimistic: { source: 'viewer', path: 'spoilerFree', value: false } });
  await flush();
  h.api.actions[1]!.resolve({});
  await undone;
  expect(h.page(key).sources.viewer).toEqual({ spoilerFree: true, canSetSpoilerFree: true, from: 'server' });
});

test('the stream follows the open pages\' topics since their lowest rev, and stops when they close', async () => {
  const h = harness();
  let n = 0;
  h.api.auto = () => ({ rev: 100 + ++n, sources: { hero: { events: [{ $record: 'event:a' }] } }, records: event('a', 50), live: { topic: `t${n}` } });
  const pages = [1, 2, 3, 4, 5].map(i => open(h, { league: `l${i}` }));
  await settle();
  const stream = h.api.streams.at(-1)!;
  // The first page opened is the oldest shown: four topics follow.
  expect(stream.query).toEqual({ topics: ['t2', 't3', 't4', 't5'], since: 102, alerts: false });
  const stopAlerts = h.screens.followAlerts();
  await settle();
  expect(h.api.streams.at(-1)!.query.alerts).toBe(true);
  stopAlerts();
  for (const page of pages) page.release();
  opened = [];
  await settle();
  expect(h.box.get().screens.stream).toBe('idle');
});

test('frames: records move the pages reading them, a source replaces its page\'s (newer only), alerts stack', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 10, sources: { hero: { events: [{ $record: 'event:a' }] }, live: { events: [] } }, records: { ...event('a', 5), ...event('b', 5) }, live: { topic: 't' } });
  const { key } = open(h);
  const surface = h.screens.open({ target: { kind: 'surface', id: 'sports.ticker' }, href: '/vela/v0/surfaces/sports.ticker/document?v=1', context: { channel: 'channel:1', chrome: true } });
  opened.push(surface);
  await flush(); await flush();
  let heard = 0;
  const stop = h.screens.records.subscribe('event:b', () => heard++);
  h.screens.receive('records', JSON.stringify({ records: { 'event:a': { rev: 20, value: { id: 'a', score: '1' } } } }));
  expect(h.page(key).rev).toBe(20);
  expect(heard).toBe(0);
  h.screens.receive('records', JSON.stringify({ records: { 'event:b': { rev: 30, value: { id: 'b' } } } }));
  expect(heard).toBe(1);
  expect(h.page(key).rev).toBe(20); // the page does not read event:b
  stop();
  h.screens.receive('source', JSON.stringify({ screen: 'sports', page: 'index', source: 'live', rev: 25, value: { events: [{ $record: 'event:b' }] } }));
  expect(h.page(key).sources.live).toEqual({ events: [{ $record: 'event:b' }] });
  expect(h.page(key).rev).toBe(25);
  h.screens.receive('source', JSON.stringify({ screen: 'sports', page: 'index', source: 'live', rev: 24, value: 'older' }));
  expect(h.page(key).sources.live).toEqual({ events: [{ $record: 'event:b' }] });
  h.screens.receive('source', JSON.stringify({ surface: 'sports.ticker', source: 'live', rev: 26, value: 'ticker' }));
  expect(h.page(surface.key).sources.live).toBe('ticker');
  expect(h.page(key).sources.live).not.toBe('ticker');
  for (let i = 0; i < 7; i++) h.screens.receive('alert', JSON.stringify({ id: `al${i}`, kind: 'close', title: 'Close', body: 'b', at: '2026-11-24T00:00:00Z' }));
  h.screens.receive('alert', JSON.stringify({ id: 'al6', kind: 'close', title: 'Close', body: 'b', at: '2026-11-24T00:00:00Z' }));
  expect(h.box.get().screens.alerts.map(alert => alert.id)).toEqual(['al2', 'al3', 'al4', 'al5', 'al6']);
  h.screens.dismissAlert('al4');
  expect(h.box.get().screens.alerts.map(alert => alert.id)).toEqual(['al2', 'al3', 'al5', 'al6']);
});

test('after a drop the stream reconnects since the pages\' revs then', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 10, sources: { hero: { events: [{ $record: 'event:a' }] } }, records: event('a', 5), live: { topic: 't' } });
  open(h);
  await settle();
  expect(h.api.streams[0]!.query.since).toBe(10);
  h.screens.receive('records', JSON.stringify({ records: event('a', 40, { score: '2' }) }));
  h.api.streams[0]!.close();
  await new Promise(resolve => setTimeout(resolve, 40));
  expect(h.api.streams.length).toBe(2);
  expect(h.api.streams[1]!.query).toEqual({ topics: ['t'], since: 40, alerts: false });
});

test('records leave with the last page that reads them, unless a view still does', async () => {
  const h = harness();
  h.api.auto = read => ({ rev: 1, sources: { hero: { events: [{ $record: `event:${read.params.league}` }] } }, records: event(read.params.league!, 1) });
  const handles = Array.from({ length: 9 }, (_, i) => open(h, { league: `l${i}` }));
  await flush(); await flush();
  const watching = h.screens.records.subscribe('event:l1', () => {});
  for (const handle of handles) handle.release();
  opened = [];
  await flush();
  // The six most recently hidden pages stay; the first three (and their records) go, but l1 has a reader.
  expect(Object.keys(h.box.get().screens.pages).length).toBe(6);
  expect(h.screens.records.get('event:l0')).toBeUndefined();
  expect(h.screens.records.get('event:l1')).toBeDefined();
  expect(h.screens.records.get('event:l2')).toBeUndefined();
  expect(h.screens.records.get('event:l8')).toBeDefined();
  watching();
});

test('a page shown again within moments is not read again; later it is, keeping what it drew', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 1, sources: { hero: 'h' } });
  const first = open(h);
  await flush(); await flush();
  first.release();
  const again = open(h);
  await flush();
  expect(h.api.calls.length).toBe(1);
  again.release();
  const now = Date.now;
  Date.now = () => now() + 5000;
  try {
    h.api.auto = null;
    const later = open(h);
    await flush();
    expect(h.api.calls.length).toBe(2);
    expect(h.page(later.key)).toMatchObject({ load: 'ready', sources: { hero: 'h' }, pending: { hero: true } });
  } finally { Date.now = now; }
});

test('a document needing a newer renderer is refused whole', async () => {
  const h = harness();
  h.api.document = { ...DOC, renderer: 20 };
  await h.screens.loadDocument(HREF);
  const document = h.box.get().screens.documents[HREF]!;
  expect(document.load).toBe('failed');
  expect(document.error).toContain('renderer 20');
  expect(document.value).toBeUndefined();
});

test('links, settings and a session reset', async () => {
  const h = harness();
  h.api.auto = () => ({ rev: 1, sources: { game: { event: { $record: 'event:a' } } }, records: { 'event:a': { rev: 1, value: { links: [{ label: 'x', url: { href: 'https://g.example/1', host: 'g.example' } }] } } } });
  const { key } = open(h);
  await flush(); await flush();
  expect([...h.screens.links(key)]).toEqual(['https://g.example/1']);
  await h.screens.setSurfaceEnabled('sports.ticker', true);
  expect(h.api.settings).toEqual([{ id: 'sports.ticker', enabled: true }]);
  expect(h.box.get().screens.settings).toEqual({ 'sports.ticker': true });
  h.api.failSetting = true;
  await expect(h.screens.setSurfaceEnabled('sports.ticker', false)).rejects.toThrow('nope');
  expect(h.box.get().screens.settings).toEqual({ 'sports.ticker': true });
  h.reset();
  expect(h.screens.records.get('event:a')).toBeUndefined();
  expect(h.page(key).load).toBe('loading'); // still on show: read again under the new session
  await flush(); await flush();
  expect(h.page(key).load).toBe('ready');
});
