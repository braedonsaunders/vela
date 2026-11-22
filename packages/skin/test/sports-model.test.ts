import { expect, test } from 'bun:test';
import type { LiveEvent } from '@vela/core';
import { barOffset } from '../src/widgets/sports/bar';
import { bestWatch, crestColor, dayOffset, heroTint, initials, matchup, numericColumn, pathLength, probabilityLead, probabilityPath, watchLabel } from '../src/widgets/sports/model';
import { resolveDocument } from '../src/resolve';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';

const event = (more: Partial<LiveEvent> = {}): LiveEvent => ({
  id: 'e', feed: 'sports', category: 'football', league: { id: 'nfl', name: 'NFL', abbr: 'NFL' }, start: '2026-11-22T18:00:00Z',
  status: { state: 'in', detail: 'Q4 · 2:14' }, updatedAt: 'x',
  competitors: [{ id: 'phi', name: 'Philadelphia Eagles', short: 'Eagles', abbr: 'PHI', score: '27', home: true, color: '004c54' }, { id: 'nyg', name: 'New York Giants', short: 'Giants', abbr: 'NYG', score: '24' }],
  ...more,
});

test('a matchup reads away first, with scores while live', () => {
  const m = matchup(event());
  expect(m.phase).toBe('live');
  expect(m.sides!.map(s => s.abbr)).toEqual(['NYG', 'PHI']);
  expect(m.scored).toBe(true);
  expect(m.status).toBe('Q4 · 2:14');
  expect(m.sides![1].color).toBe('#004c54');
});

test('a final names its winner; a withheld result shows no score', () => {
  const final = matchup(event({ status: { state: 'post', detail: 'Final' } }));
  expect(final.sides![1].winner).toBe(true);
  expect(final.sides![0].loser).toBe(true);
  const hidden = matchup(event({ spoiler: true, competitors: [{ id: 'phi', name: 'Eagles', home: true }, { id: 'nyg', name: 'Giants' }] }));
  expect(hidden.scored).toBe(false);
  expect(hidden.spoiler).toBe(true);
  expect(hidden.status).toBe('Live');
});

test('an upcoming game shows its records, not scores; a race has no sides', () => {
  expect(matchup(event({ status: { state: 'pre', detail: '7:30 PM' } })).scored).toBe(false);
  const race = matchup(event({ competitors: [], title: 'Las Vegas Grand Prix', ranking: [{ pos: 1, name: 'Max Verstappen' }] }));
  expect(race.sides).toBeNull();
  expect(race.title).toBe('Las Vegas Grand Prix');
});

test('where to watch prefers a live channel', () => {
  const e = event({ watch: [
    { kind: 'addon', name: 'Peacock', live: true, confidence: 0.9 },
    { kind: 'channel', channelId: 'c7', name: 'FOX', number: '205', live: true, confidence: 0.7 },
  ] });
  expect(bestWatch(e)?.channelId).toBe('c7');
  expect(watchLabel(e)).toBe('FOX · 205');
  expect(watchLabel(event({ broadcasts: [{ name: 'ESPN', kind: 'tv' }] }))).toBe('ESPN');
});

test('win probability names the side that leads', () => {
  const e = event({ probability: { label: 'Win', value: 0.64, competitorId: 'phi' } });
  const m = matchup(e);
  expect(probabilityLead(e, m.sides)).toEqual({ abbr: 'PHI', share: 64, home: 0.64 });
  expect(probabilityLead({ ...e, spoiler: true }, m.sides)).toBeUndefined();
});

test('the probability path is a smooth curve inside its box', () => {
  const series = [{ t: 0, value: 0.5 }, { t: 0.25, value: 0.9 }, { t: 0.5, value: 0.1 }, { t: 1, value: 0.6 }];
  const { line, area, end } = probabilityPath(series, 300, 100);
  expect(line.startsWith('M0,50 C')).toBe(true);
  expect(line.split('C').length - 1).toBe(3);
  for (const n of line.match(/-?\d+(\.\d+)?/g)!.map(Number)) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThanOrEqual(300); }
  expect(area.endsWith('Z')).toBe(true);
  expect(end).toEqual({ x: 300, y: 40 });
  expect(pathLength(series, 300, 100)).toBeGreaterThan(300);
  expect(probabilityPath([], 300, 100).line).toBe('');
});

test('crests and tints stay readable', () => {
  expect(initials('Toronto Maple Leafs')).toBe('TML');
  expect(initials('Arsenal')).toBe('ARS');
  expect(crestColor({ color: '', name: 'Arsenal' })).toMatch(/^hsl\(/);
  expect(heroTint({ color: '#fcb514', altColor: '#111111' })).toBe('#111111');
  expect(heroTint({ color: '#0b2265', altColor: '#a71930' })).toBe('#0b2265');
});

test('tables align numeric columns', () => {
  const rows = [['Eagles', '9', '.818', 'W4'], ['Giants', '4', '.364', 'L2']];
  expect([0, 1, 2, 3].map(n => numericColumn(rows, n))).toEqual([false, true, true, false]);
});

test('days are counted locally', () => {
  const now = new Date(2026, 10, 22, 23, 0).getTime();
  expect(dayOffset(new Date(2026, 10, 23, 1, 0).getTime(), now)).toBe(1);
  expect(dayOffset(new Date(2026, 10, 22, 0, 30).getTime(), now)).toBe(0);
});

test('a page starts below a floating shell bar, and at the top under a bar in flow', () => {
  const doc = resolveDocument(cinematicDoc as never, 1600).document;
  expect(barOffset(doc.slots?.shell, false, 20)).toBe(76);
  expect(barOffset(undefined, false, 20)).toBe(0);
});
