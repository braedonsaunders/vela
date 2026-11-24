import { expect, test } from 'bun:test';
import type * as V from '../src/wire';
import { backoffMs, isFavoriteCompetitor, mergeEvents, probabilityFor, readLiveMessage, screenEvents, seriesPoints, sides, streamQuery, teamColor, venueText, withEvent } from '../src/live/events';
import { screenNavigation } from '../src/discovery/models';
import { liveEventRef } from '../src/protocol/events';

const event = (id: string, updatedAt: string, more: Partial<V.LiveEvent> = {}): V.LiveEvent => ({
  id, feed: 'sports', category: 'football', league: { id: 'nfl', name: 'NFL' }, start: '2026-11-22T18:00:00Z',
  status: { state: 'in', detail: 'Q4 · 2:14' }, updatedAt,
  competitors: [{ id: 'nyg', name: 'Giants', score: '24' }, { id: 'phi', name: 'Eagles', score: '27', home: true }], ...more,
});

test('merging keeps identity when nothing is newer, and an older update never wins', () => {
  const known = { a: event('a', '2026-11-22T18:00:10Z') };
  expect(mergeEvents(known, [event('a', '2026-11-22T18:00:10Z')])).toBe(known);
  expect(mergeEvents(known, [event('a', '2026-11-22T18:00:05Z', { status: { state: 'post', detail: 'Final' } })])).toBe(known);
  const next = mergeEvents(known, [event('a', '2026-11-22T18:00:20Z', { status: { state: 'in', detail: 'Q4 · 1:50' } }), event('b', '2026-11-22T18:00:20Z')]);
  expect(next).not.toBe(known);
  expect(next.a!.status.detail).toBe('Q4 · 1:50');
  expect(Object.keys(next)).toEqual(['a', 'b']);
});

test('the same stamp with other content (a reveal) replaces the withheld copy', () => {
  const hidden = event('a', '2026-11-22T18:00:10Z', { spoiler: true, competitors: [{ id: 'nyg', name: 'Giants' }, { id: 'phi', name: 'Eagles' }] });
  const shown = event('a', '2026-11-22T18:00:10Z');
  expect(mergeEvents({ a: hidden }, [shown]).a).toBe(shown);
});

test('a detail follows its event but keeps tables, plays and links', () => {
  const detail: V.LiveEventDetail = { ...event('a', '2026-11-22T18:00:10Z', { probability: { label: 'Win', value: 0.6, competitorId: 'phi' } }),
    tables: [{ title: 'Scoring', columns: ['Team', 'T'], rows: [['NYG', '24']] }], plays: [{ text: 'Kick', emphasis: 'normal' }],
    probabilitySeries: [{ t: 0, value: 0.5 }, { t: 0.9, value: 0.6 }], links: [] };
  const pushed = event('a', '2026-11-22T18:00:30Z', { probability: { label: 'Win', value: 0.7, competitorId: 'phi' } });
  const next = withEvent(detail, pushed);
  expect(next.status).toEqual(pushed.status);
  expect(next.tables).toBe(detail.tables);
  expect(next.plays).toBe(detail.plays);
  expect(next.probabilitySeries.at(-1)).toEqual({ t: 0.9, value: 0.7 });
  expect(withEvent(detail, event('a', '2026-11-22T18:00:00Z'))).toBe(detail);
});

test('every view folds into one sorted stream query', () => {
  expect(streamQuery([{ events: ['b', 'a'] }, { screens: ['sports'] }, { events: ['a'], alerts: true }]))
    .toEqual({ events: ['a', 'b'], screens: ['sports'], alerts: true });
  expect(streamQuery([])).toEqual({ events: [], screens: [], alerts: false });
});

test('reconnection backs off from one second to thirty, with bounded jitter', () => {
  expect(backoffMs(1, 0)).toBe(1000);
  expect(backoffMs(2, 0)).toBe(2000);
  expect(backoffMs(4, 0)).toBe(8000);
  expect(backoffMs(20, 0)).toBe(30000);
  expect(backoffMs(20, 1)).toBe(36000);
});

test('stream messages are validated: updates, alerts, heartbeats; the rest ignored', () => {
  expect(readLiveMessage('heartbeat', '{}')).toEqual({ kind: 'heartbeat' });
  const update = readLiveMessage('update', JSON.stringify({ events: [event('a', 'x'), { id: 'broken' }] }));
  expect(update.kind === 'update' && update.events.map(e => e.id)).toEqual(['a']);
  const alert = { id: 'al1', kind: 'close', eventId: 'a', entityKey: 'k', title: 'Close game', body: '2–2', at: 'now' };
  expect(readLiveMessage('alert', JSON.stringify(alert))).toEqual({ kind: 'alert', alert: alert as V.LiveAlert });
  expect(readLiveMessage('alert', JSON.stringify({ ...alert, kind: 'other' })).kind).toBe('ignored');
  expect(readLiveMessage('update', '{nope').kind).toBe('ignored');
  expect(readLiveMessage('surprise', '{}').kind).toBe('ignored');
});

test('a screen lists every event it shows', () => {
  const screen: V.Screen = { id: 'sports', title: 'Sports', sections: [
    { id: 'hero', type: 'hero', event: event('a', 'x'), also: [event('b', 'x')] },
    { id: 'leagues', type: 'leagues', leagues: [] },
    { id: 'live', type: 'events', events: [event('c', 'x')] },
    { id: 'schedule', type: 'schedule', date: '2026-11-22', events: [event('d', 'x')] },
  ] };
  expect(screenEvents(screen).map(e => e.id)).toEqual(['a', 'b', 'c', 'd']);
});

test('sides read away first; probability is shared between them', () => {
  const e = event('a', 'x', { probability: { label: 'Win', value: 0.64, competitorId: 'phi' } });
  expect(sides(e)!.map(c => c.id)).toEqual(['nyg', 'phi']);
  expect(sides({ ...e, competitors: [...e.competitors].reverse() })!.map(c => c.id)).toEqual(['nyg', 'phi']);
  expect(probabilityFor(e, 'phi')).toBeCloseTo(0.64);
  expect(probabilityFor(e, 'nyg')).toBeCloseTo(0.36);
  expect(sides({ ...e, competitors: [] })).toBeNull();
});

test('a probability series becomes points in a unit box, by fraction or by time', () => {
  expect(seriesPoints([{ t: 0, value: 0.5 }, { t: 0.5, value: 0.75 }])).toEqual([{ x: 0, y: 0.5 }, { x: 0.5, y: 0.25 }]);
  const timed = seriesPoints([{ t: '2026-11-22T18:00:00Z', value: 0.5 }, { t: '2026-11-22T18:30:00Z', value: 1 }, { t: '2026-11-22T19:00:00Z', value: 0 }]);
  expect(timed.map(p => p.x)).toEqual([0, 0.5, 1]);
  expect(timed.map(p => p.y)).toEqual([0.5, 0, 1]);
  expect(seriesPoints([{ t: 'nonsense', value: 0.5 }])).toEqual([]);
});

test('small readings: colours, venues and favourites', () => {
  expect(teamColor('004C54')).toBe('#004c54');
  expect(teamColor('#0b2265')).toBe('#0b2265');
  expect(teamColor('blue')).toBeUndefined();
  expect(venueText({ name: 'Lincoln Financial Field', city: 'Philadelphia' })).toBe('Lincoln Financial Field, Philadelphia');
  expect(venueText('Wembley')).toBe('Wembley');
  expect(isFavoriteCompetitor({ id: 'x', name: 'Eagles', entityId: 'nfl-phi' }, new Set(['sports:sports:team:nfl-phi']))).toBe(true);
  expect(isFavoriteCompetitor({ id: 'x', name: 'Giants', entityId: 'nfl-nyg' }, new Set(['sports:sports:team:nfl-phi']))).toBe(false);
});

test('navigation lists each plugin screen once, with its document, and skips what it does not know', () => {
  const document = { href: '/vela/v0/screens/sports/pages/index/document?v=1&r=19&l=en', renderer: 19 };
  expect(screenNavigation([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports', page: 'index', document }, { kind: 'screen', id: 'sports', title: 'Again', page: 'index', document },
    { kind: 'other' as 'screen', id: 'x', title: 'X' }])).toEqual([{ id: 'sports', title: 'Sports', icon: 'sports', page: 'index', document }]);
  // Hard cut: an entry without a document (an Ether before plugin screens) is not offered.
  expect(screenNavigation([{ kind: 'screen', id: 'sports', title: 'Sports', icon: 'sports' }])).toEqual([]);
  expect(screenNavigation(undefined)).toEqual([]);
});

test('a session liveEvent reference is validated', () => {
  expect(liveEventRef({ id: 'a', feed: 'sports' })).toEqual({ id: 'a', feed: 'sports' });
  expect(liveEventRef(null)).toBeNull();
  expect(liveEventRef({ id: 3 })).toBeNull();
});

test('following a session hands the live event on air from the snapshot and the stream', async () => {
  const { followSession } = await import('../src/protocol/events');
  const plan = { sessionId: 's1', revision: 1 } as V.PlaybackPlan;
  const seen: (V.LiveEventRef | null)[] = [];
  const api = {
    sessionSnapshot: async () => ({ cursor: '1', revision: 1, plan, publishedRanges: [], liveEvent: { id: 'a', feed: 'sports' } }),
    streamSession: async (_id: string, _cursor: string, onEvent: (event: { event: string; id: string; data: string }) => Promise<void> | void) => {
      await onEvent({ event: 'liveEvent', id: '', data: JSON.stringify({ liveEvent: null }) });
      await onEvent({ event: 'liveEvent', id: '', data: JSON.stringify({ liveEvent: { id: 'b', feed: 'sports' } }) });
    },
  };
  await followSession(api as never, value => value, 's1', () => {}, undefined, ref => seen.push(ref));
  expect(seen).toEqual([{ id: 'a', feed: 'sports' }, null, { id: 'b', feed: 'sports' }]);
});
