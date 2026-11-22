import { expect, test } from 'bun:test';
import { normaliseDetail, normaliseEvent, normaliseScreen, readLiveMessage } from '../src/live/events';

const golf = { id: 'p:sports:401', feed: 'sports', category: 'golf', league: { id: 'pga', name: 'PGA' }, start: '2026-11-22T14:00:00Z',
  status: { state: 'in', detail: 'Round 3' }, ranking: [{ pos: 1, name: 'Scheffler' }], updatedAt: '2026-11-22T16:00:00Z' };

test('an event without competitors (golf, F1) reads with an empty list and keeps its ranking', () => {
  const event = normaliseEvent(golf)!;
  expect(event.competitors).toEqual([]);
  expect(event.ranking?.length).toBe(1);
});

test('values without an id or a status are not events', () => {
  expect(normaliseEvent({ id: 'x' })).toBeNull();
  expect(normaliseEvent(null)).toBeNull();
});

test('a screen from Ether with a competitor-less hero and missing lists renders safely', () => {
  const screen = normaliseScreen({ id: 'sports', title: 'Sports', sections: [
    { id: 'hero', type: 'hero', event: golf },
    { id: 'today', type: 'events', events: [golf, { bad: true }] },
    { id: 'standings', type: 'table', feed: 'sports' },
    { id: 'leagues', type: 'leagues' },
  ] } as never);
  const [hero, today, table, leagues] = screen.sections as never as Record<string, unknown>[];
  expect((hero!.event as { competitors: unknown[] }).competitors).toEqual([]);
  expect(hero!.also).toEqual([]);
  expect((today!.events as unknown[]).length).toBe(1);
  expect(table!.tables).toEqual([]);
  expect(leagues!.leagues).toEqual([]);
});

test('pushed updates keep competitor-less events instead of dropping them', () => {
  const message = readLiveMessage('update', JSON.stringify({ events: [golf] }));
  expect(message.kind).toBe('update');
  if (message.kind === 'update') expect(message.events[0]!.competitors).toEqual([]);
});

test('a detail always carries its tables, plays, series and links', () => {
  const detail = normaliseDetail(golf)!;
  expect([detail.tables, detail.plays, detail.probabilitySeries, detail.links]).toEqual([[], [], [], []]);
});
