import { expect, test } from 'bun:test';
import type { LiveAlert, LiveEvent, WatchTarget } from '@vela/core';
import { alertWatch, bugModel, marqueeScrolls, marqueeStep, scoreChange, tickerItems, toastQueue, watchLabel, type VersusBug } from '../src/widgets/live-overlay/model';

const game = (more: Partial<LiveEvent> = {}): LiveEvent => ({
  id: 'sports:sports:nfl-nyg-phi', feed: 'sports', category: 'football', league: { id: 'nfl', name: 'NFL', abbr: 'NFL' },
  start: '2026-11-22T18:00:00Z', status: { state: 'in', detail: 'Q4 · 2:14', period: 4, clock: '2:14' }, updatedAt: '2026-11-22T20:00:00Z',
  competitors: [
    { id: 'phi', name: 'Philadelphia Eagles', short: 'Eagles', abbr: 'PHI', color: '004c54', score: '27', home: true },
    { id: 'nyg', name: 'New York Giants', short: 'Giants', abbr: 'NYG', color: '#0B2265', score: '24' },
  ],
  situation: { Down: '3rd & 6', Ball: 'NYG 38', Possession: 'PHI' },
  ...more,
});

test('a two-sided event reads away first, with colours, scores, the live status and who has the ball', () => {
  const bug = bugModel(game()) as VersusBug;
  expect(bug.kind).toBe('versus');
  expect([bug.away.abbr, bug.away.score, bug.home.abbr, bug.home.score]).toEqual(['NYG', '24', 'PHI', '27']);
  expect([bug.away.color, bug.home.color]).toEqual(['#0b2265', '#004c54']);
  expect(bug.tone).toBe('live');
  expect(bug.status).toBe('Q4 · 2:14');
  expect([bug.away.possession, bug.home.possession]).toEqual([false, true]);
  // Possession is shown as the mark, not repeated as text; the rest is capped.
  expect(bug.situation).toEqual([{ label: 'Down', value: '3rd & 6' }, { label: 'Ball', value: 'NYG 38' }]);
  expect((bugModel(game(), 1) as VersusBug).situation).toHaveLength(1);
});

test('a value that only mentions a side is not possession', () => {
  const bug = bugModel(game({ situation: { Possession: 'PHI 54%', Shots: '11 – 9' } })) as VersusBug;
  expect([bug.away.possession, bug.home.possession]).toEqual([false, false]);
  expect(bug.situation.map(pair => pair.label)).toEqual(['Possession', 'Shots']);
});

test('a finished game marks the winner and drops the situation; a game to come has no scores', () => {
  const final = bugModel(game({ status: { state: 'post', detail: 'Final' }, competitors: [
    { id: 'phi', name: 'Eagles', abbr: 'PHI', score: '27', home: true }, { id: 'nyg', name: 'Giants', abbr: 'NYG', score: '24' }] })) as VersusBug;
  expect(final.tone).toBe('final');
  expect([final.away.loser, final.home.winner, final.home.possession]).toEqual([true, true, false]);
  expect(final.situation).toEqual([]);
  const pre = bugModel(game({ status: { state: 'pre', detail: '7:30 PM' }, competitors: [
    { id: 'phi', name: 'Eagles', abbr: 'PHI', home: true }, { id: 'nyg', name: 'Giants', abbr: 'NYG' }] })) as VersusBug;
  expect([pre.tone, pre.status, pre.away.score, pre.home.winner]).toEqual(['upcoming', '7:30 PM', undefined, false]);
  const held = bugModel(game({ status: { state: 'postponed', detail: '' } }))!;
  expect([held.tone, held.status]).toEqual(['quiet', 'Postponed']);
});

test('a spoiler-free event shows no scores, winners or situation even if they leaked through', () => {
  const bug = bugModel(game({ spoiler: true, status: { state: 'post', detail: 'Final' } })) as VersusBug;
  expect(bug.spoiler).toBe(true);
  expect([bug.away.score, bug.home.score, bug.home.winner, bug.away.loser]).toEqual([undefined, undefined, false, false]);
  expect(bug.situation).toEqual([]);
});

test('a field event reads its title and the leader by position', () => {
  const race = game({ competitors: [], title: 'Las Vegas Grand Prix', status: { state: 'in', detail: 'Lap 31/50' },
    ranking: [{ pos: 2, name: 'Lando Norris', abbr: 'NOR' }, { pos: 1, name: 'Max Verstappen', abbr: 'VER' }] });
  expect(bugModel(race)).toMatchObject({ kind: 'field', title: 'Las Vegas Grand Prix', leader: 'VER P1', status: 'Lap 31/50' });
  expect(bugModel({ ...race, spoiler: true })).toMatchObject({ leader: '' });
  expect(bugModel(undefined)).toBeNull();
  expect(bugModel(game({ competitors: [], title: undefined, league: { id: '', name: '' }, ranking: [] }))).toBeNull();
});

test('a score change is a moved score in the same event, never a reveal or another event', () => {
  const before = bugModel(game());
  const after = bugModel(game({ competitors: [
    { id: 'phi', name: 'Eagles', abbr: 'PHI', score: '27', home: true }, { id: 'nyg', name: 'Giants', abbr: 'NYG', score: '31' }] }));
  expect(scoreChange(before, after)).toEqual({ away: true, home: false });
  expect(scoreChange(before, before)).toEqual({ away: false, home: false });
  expect(scoreChange(bugModel(game({ spoiler: true })), before)).toEqual({ away: false, home: false });
  expect(scoreChange(before, bugModel(game({ id: 'other' })))).toEqual({ away: false, home: false });
  expect(scoreChange(undefined, before)).toEqual({ away: false, home: false });
});

test('the ticker keeps the server\'s order, once each, skipping unknown and canceled events', () => {
  const events = { a: game({ id: 'a' }), b: game({ id: 'b', status: { state: 'pre', detail: '7:30 PM' } }), c: game({ id: 'c', status: { state: 'canceled', detail: 'Canceled' } }) };
  expect(tickerItems(['b', 'missing', 'a', 'b', 'c'], events).map(item => [item.id, item.tone])).toEqual([['b', 'upcoming'], ['a', 'live']]);
  expect(tickerItems(undefined, events)).toEqual([]);
  // The ticker leaves the situation to the bug.
  expect((tickerItems(['a'], events)[0]!.bug as VersusBug).situation).toEqual([]);
});

test('the marquee advances by speed and wraps at one copy\'s width without jumping back', () => {
  expect(marqueeStep(0, 1000, 60, 500)).toBe(60);
  expect(marqueeStep(480, 1000, 60, 500)).toBe(40);
  // The run got narrower under the offset: it folds in rather than restarting.
  expect(marqueeStep(700, 0, 60, 500)).toBe(200);
  expect(marqueeStep(100, -50, 60, 500)).toBe(100);
  expect(marqueeStep(100, 16, 60, 0)).toBe(0);
  expect([marqueeScrolls(900, 1200), marqueeScrolls(1300, 1200), marqueeScrolls(0, 0)]).toEqual([false, true, false]);
});

const alert = (id: string, eventId: string, kind: LiveAlert['kind'] = 'close'): LiveAlert =>
  ({ id, kind, eventId, entityKey: `sports:sports:team:${eventId}`, title: 'Close game', body: '', at: '2026-11-22T20:00:00Z' });

test('toasts stand two at a time, oldest first, and a newer alert about an event replaces the older', () => {
  const queue = toastQueue([alert('1', 'x'), alert('2', 'y'), alert('3', 'x', 'final'), alert('4', 'z')]);
  expect(queue.shown.map(a => a.id)).toEqual(['2', '3']);
  expect(queue.superseded.map(a => a.id)).toEqual(['1']);
  expect(toastQueue([]).shown).toEqual([]);
  expect(toastQueue([alert('1', 'x'), alert('2', 'y')], 1).shown.map(a => a.id)).toEqual(['1']);
});

test('Watch opens the likeliest live channel, and nothing when the event is on the channel playing', () => {
  const targets: WatchTarget[] = [
    { kind: 'addon', name: 'Peacock', live: true, confidence: 0.99 },
    { kind: 'channel', channelId: 'ch-20', name: 'FOX West', number: '120', live: false, confidence: 0.95 },
    { kind: 'channel', channelId: 'ch-7', name: 'FOX', number: '107', live: true, confidence: 0.7 },
  ];
  expect(alertWatch(targets).target?.channelId).toBe('ch-7');
  expect(alertWatch(targets, 'ch-20')).toEqual({ onNow: true });
  expect(alertWatch([targets[0]!])).toEqual({ onNow: false });
  expect(alertWatch(undefined, 'ch-7')).toEqual({ onNow: false });
  expect(watchLabel(targets[2]!)).toBe('FOX · 107');
  expect(watchLabel(targets[0]!)).toBe('Peacock');
});
