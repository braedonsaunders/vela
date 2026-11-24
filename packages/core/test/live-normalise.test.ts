import { expect, test } from 'bun:test';
import { normaliseDetail, normaliseEvent, normaliseScreen, readLiveMessage, serverURL } from '../src/live/events';

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

test('logos sent as paths on the server become absolute URLs on it; absolute logos are kept', () => {
  const origin = 'http://192.168.68.65:32550';
  const event = normaliseEvent({
    id: 'e1', status: { state: 'pre' }, league: { id: 'nba', name: 'NBA', logo: '/vela/v0/images/league-grant' },
    competitors: [{ id: 'a', name: 'A', logo: '/vela/v0/images/a-grant' }, { id: 'b', name: 'B', logo: 'https://cdn.example/b.png' }],
    watch: [{ kind: 'channel', name: 'ESPN', logo: '/vela/v0/images/espn', live: true, confidence: 1 }],
  }, origin)!;
  expect(event.league.logo).toBe(`${origin}/vela/v0/images/league-grant`);
  expect(event.competitors.map(c => c.logo)).toEqual([`${origin}/vela/v0/images/a-grant`, 'https://cdn.example/b.png']);
  expect(event.watch?.[0]?.logo).toBe(`${origin}/vela/v0/images/espn`);
  expect(serverURL('//evil.example/x.png', origin)).toBe('//evil.example/x.png');
  expect(normaliseEvent({ id: 'e2', status: { state: 'pre' }, competitors: [{ id: 'a', name: 'A', logo: '/x.png' }] })!.competitors[0]!.logo).toBe('/x.png');
});
