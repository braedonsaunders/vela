// Plugin screens, the pure parts: page keys, the record pool, deps re-reads, links, and the
// stream's topics, query and frames.
import { expect, test } from 'bun:test';
import type * as V from '../src/wire';
import { changedParams, pageKey, screenDocumentHref, serverContext } from '../src/screens/keys';
import { linkHrefs, mergeRecords, recordRefs, RecordStore, setPath } from '../src/screens/records';
import { eagerSources, sourceDeps, sourcesToReread } from '../src/screens/deps';
import { chooseTopics, connectionKey, readScreenMessage, streamQuery, streamSearch } from '../src/screens/stream';

test('a page key is canonical: sorted params, empty ones dropped, a surface keyed by the context Ether reads', () => {
  const target = { kind: 'screen' as const, id: 'sports', page: 'index' };
  expect(pageKey(target, { league: 'nfl', date: '2026-11-24', teamsLeague: '' })).toBe('screen:sports/index?date=2026-11-24&league=nfl');
  expect(pageKey(target, { date: '2026-11-24', league: 'nfl' })).toBe(pageKey(target, { league: 'nfl', date: '2026-11-24' }));
  expect(pageKey(target)).toBe('screen:sports/index');
  const surface = { kind: 'surface' as const, id: 'sports.scorebug' };
  // chrome and pictureTime are the client's own: they never split a surface's data.
  expect(pageKey(surface, {}, { event: 'event:a', chrome: true, pictureTime: '2026-11-24T00:00:00Z' })).toBe(pageKey(surface, {}, { event: 'event:a', chrome: false }));
  expect(pageKey(surface, {}, { event: 'event:a' })).toBe('surface:sports.scorebug?context.event=event%3Aa');
  expect(serverContext({ event: 'e', channel: 'c', kind: 'channel', delayed: true, alert: { id: 'a1', kind: 'final', title: '', body: '', at: '', ref: 'event:x' } }))
    .toEqual({ event: 'e', channel: 'c', kind: 'channel', 'alert.ref': 'event:x' });
});

test('changed params and another page of the same screen', () => {
  expect(changedParams({ league: 'nfl', date: 'd1' }, { league: 'nba', date: 'd1', teamsLeague: 'x' })).toEqual(['league', 'teamsLeague']);
  expect(changedParams({ a: '1' }, { a: '1' })).toEqual([]);
  expect(screenDocumentHref('/vela/v0/screens/sports/pages/index/document?v=9f&r=19&l=en', 'game')).toBe('/vela/v0/screens/sports/pages/game/document?r=19&l=en');
});

test('records: a higher rev wins, the same or a lower one changes nothing, an equal value keeps identity', () => {
  const pool = { 'event:a': { rev: 10, value: { score: '1' } } };
  expect(mergeRecords(pool, { 'event:a': { rev: 10, value: { score: '9' } } })).toEqual({ pool, changed: [] });
  expect(mergeRecords(pool, { 'event:a': { rev: 9, value: { score: '9' } } }).pool).toBe(pool);
  expect(mergeRecords(pool, { 'event:a': { rev: 11, value: { score: '1' } } }).pool).toBe(pool);
  const next = mergeRecords(pool, { 'event:a': { rev: 12, value: { score: '2' } }, 'event:b': { rev: 1, value: {} }, bad: { value: 1 }, 'event:c': null });
  expect(next.changed).toEqual(['event:a', 'event:b']);
  expect(next.pool['event:a']).toEqual({ rev: 12, value: { score: '2' } });
  expect(next.pool.bad).toBeUndefined();
  expect(mergeRecords(pool, 'nonsense').pool).toBe(pool);
});

test('the record store tells only the readers of a changed key, and releases what nobody reads', () => {
  const store = new RecordStore();
  let a = 0, b = 0, both = 0;
  const stopA = store.subscribe('event:a', () => a++);
  store.subscribe('event:b', () => b++);
  const stopBoth = store.subscribeKeys(['event:a', 'event:b', 'event:a'], () => both++);
  expect(store.merge({ 'event:a': { rev: 1, value: 1 } })).toEqual(['event:a']);
  expect([a, b, both]).toEqual([1, 0, 1]);
  store.merge({ 'event:a': { rev: 2, value: 2 }, 'event:b': { rev: 2, value: 2 } });
  expect([a, b, both]).toEqual([2, 1, 2]); // one change, heard once
  store.merge({ 'event:a': { rev: 2, value: 3 } });
  expect(a).toBe(2);
  store.merge({ 'event:c': { rev: 1, value: 1 }, 'event:d': { rev: 1, value: 1 } });
  stopA();
  expect(store.release(new Set(['event:c']))).toEqual(['event:d']); // event:a is still read by `both`
  stopBoth();
  expect(store.release(new Set(['event:c']))).toEqual(['event:a']);
  // event:b still has a reader; event:c is referenced.
  expect(Object.keys(store.pool()).sort()).toEqual(['event:b', 'event:c']);
});

test('record references are followed through records, each once', () => {
  const pool: Record<string, V.RecordEntry> = {
    'event:a': { rev: 1, value: { rows: [{ entity: { $record: 'entity:x' } }], self: { $record: 'event:a' } } },
    'entity:x': { rev: 1, value: { name: 'X' } },
  };
  const refs = recordRefs({ events: [{ $record: 'event:a' }, { $record: 'event:missing' }], viewer: { n: 1 } }, key => pool[key]);
  expect([...refs].sort()).toEqual(['entity:x', 'event:a', 'event:missing']);
});

test('an optimistic path is set by copying only along it', () => {
  const value = { teams: [{ favourite: false }, { favourite: true }], other: { n: 1 } };
  const next = setPath(value, 'teams.0.favourite', true) as typeof value;
  expect(next.teams[0]!.favourite).toBe(true);
  expect(next.other).toBe(value.other);
  expect(next.teams[1]).toBe(value.teams[1]);
  expect(value.teams[0]!.favourite).toBe(false);
  expect(setPath(undefined, 'a.b', 1)).toEqual({ a: { b: 1 } });
});

test('openLink hrefs are only those Ether rewrote from $link: https, matching host, in sources or records', () => {
  const pool: Record<string, V.RecordEntry> = { 'event:a': { rev: 1, value: { links: [{ label: 'Game centre', url: { href: 'https://espn.example/g/1', host: 'espn.example' } }] } } };
  const links = linkHrefs({
    game: { event: { $record: 'event:a' } },
    story: { href: 'https://news.example/s', host: 'news.example' },
    spoof: { href: 'http://evil.example/', host: 'evil.example' },
    mismatch: { href: 'https://evil.example/', host: 'news.example' },
    extra: { href: 'https://a.example/', host: 'a.example', label: 'not an envelope' },
    plain: 'https://plain.example/',
  }, key => pool[key]);
  expect([...links].sort()).toEqual(['https://espn.example/g/1', 'https://news.example/s']);
});

test('deps: served deps first, else the {param.x} holes; a change re-reads only dependants, lazy ones once read', () => {
  const document = {
    sources: {
      viewer: { from: 'viewer', deps: [] },
      hero: { from: 'liveEvents', query: { league: '{param.league}' }, deps: ['league'] },
      schedule: { from: 'liveSchedule', league: '{param.league}', date: '{param.date}', deps: ['date', 'league'] },
      standings: { from: 'liveTables', league: '{param.league}', lazy: true, deps: ['league'] },
      teams: { from: 'liveEntities', league: '{param.teamsLeague}', prefer: '{param.league}', lazy: true },
    },
  } as unknown as V.ScreenDocument;
  expect(sourceDeps(document.sources.teams!).sort()).toEqual(['league', 'teamsLeague']);
  expect(sourceDeps(document.sources.hero!)).toEqual(['league']);
  const held = ['viewer', 'hero', 'schedule'];
  expect(sourcesToReread(document, ['date'], held, new Set())).toEqual(['schedule']);
  expect(sourcesToReread(document, ['league'], held, new Set())).toEqual(['hero', 'schedule']);
  expect(sourcesToReread(document, ['league'], [...held, 'standings'], new Set(['standings', 'teams']))).toEqual(['hero', 'schedule', 'standings', 'teams']);
  expect(sourcesToReread(document, ['teamsLeague'], held, new Set())).toEqual([]);
  expect(sourcesToReread(undefined, ['league'], held, new Set())).toEqual(['hero', 'schedule', 'viewer']);
  expect(sourcesToReread(document, [], held, new Set())).toEqual([]);
  expect(eagerSources(document, new Set(['teams']))).toEqual(['hero', 'schedule', 'teams', 'viewer']);
});

test('the stream follows the 4 most recently shown topics, since the lowest of their revs', () => {
  const chosen = chooseTopics([
    { topic: 'a', rev: 50, shownAt: 1 }, { topic: 'b', rev: 40, shownAt: 5 }, { topic: 'c', rev: 30, shownAt: 4 },
    { topic: 'd', rev: 20, shownAt: 3 }, { topic: 'e', rev: 10, shownAt: 2 }, { topic: '', rev: 1, shownAt: 9 }, { topic: 'b', rev: 35, shownAt: 0 },
  ]);
  expect(chosen.map(t => t.topic)).toEqual(['b', 'c', 'd', 'e']);
  expect(chosen[0]!.rev).toBe(35);
  const query = streamQuery(chosen, true);
  expect(query).toEqual({ topics: ['b', 'c', 'd', 'e'], since: 10, alerts: true });
  expect(streamSearch(query, 'America/Toronto')).toBe('?topic=b&topic=c&topic=d&topic=e&since=10&tz=America%2FToronto&alerts=1');
  expect(streamSearch(streamQuery([], true), '')).toBe('?alerts=1');
  expect(streamSearch(streamQuery([{ topic: 't', rev: 0, shownAt: 1 }], false), 'UTC')).toBe('?topic=t&tz=UTC');
  // A moving rev is not a new connection.
  expect(connectionKey({ ...query, since: 99 } as never)).toBe(connectionKey(query));
});

test('frames: records, a source owned by a page or a surface, alerts and heartbeats; anything else is ignored', () => {
  expect(readScreenMessage('records', '{"records":{"event:a":{"rev":2,"value":{}}}}')).toEqual({ kind: 'records', records: { 'event:a': { rev: 2, value: {} } } });
  expect(readScreenMessage('source', '{"screen":"sports","page":"index","source":"live","rev":3,"value":{"events":[]}}'))
    .toEqual({ kind: 'source', frame: { screen: 'sports', page: 'index', source: 'live', rev: 3, value: { events: [] } } });
  expect(readScreenMessage('source', '{"surface":"sports.ticker","source":"live","rev":3,"value":null}'))
    .toEqual({ kind: 'source', frame: { surface: 'sports.ticker', source: 'live', rev: 3, value: null } });
  expect(readScreenMessage('source', '{"surface":"s","screen":"x","page":"p","source":"live","rev":3,"value":1}').kind).toBe('ignored');
  expect(readScreenMessage('source', '{"screen":"x","source":"live","rev":3,"value":1}').kind).toBe('ignored');
  expect(readScreenMessage('source', '{"screen":"x","page":"p","source":"live","rev":"3","value":1}').kind).toBe('ignored');
  expect(readScreenMessage('source', '{"screen":"x","page":"p","source":"live","rev":3}').kind).toBe('ignored');
  const alert = { id: 'al1', kind: 'close', title: 'Close game', body: 'NYG 24–27 PHI', at: '2026-11-24T01:00:00Z', ref: 'event:x', plugin: 'org.ether.sports', surface: 'sports.alert' };
  expect(readScreenMessage('alert', JSON.stringify({ ...alert, extra: 1 }))).toEqual({ kind: 'alert', alert });
  expect(readScreenMessage('alert', '{"id":"a","kind":"close"}').kind).toBe('ignored');
  expect(readScreenMessage('heartbeat', '')).toEqual({ kind: 'heartbeat' });
  expect(readScreenMessage('update', '{"events":[]}').kind).toBe('ignored');
  expect(readScreenMessage('records', 'not json').kind).toBe('ignored');
  expect(readScreenMessage('records', '{"records":[1]}').kind).toBe('ignored');
});
