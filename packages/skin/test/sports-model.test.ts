import { expect, test } from 'bun:test';
import type { LiveEvent } from '@vela/core';
import { barOffset } from '../src/widgets/sports/bar';
import { airingText, bestWatch, newestFirst, cardLine, crestColor, leagueLabel, rankRows, watchTarget, dayOffset, heroTint, initials, matchup, pathLength, probabilityLead, probabilityPath, watchLabel } from '../src/widgets/sports/model';
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

test('only a channel to tune is an action; broadcasts are information', () => {
  const broadcastOnly = event({ broadcasts: [{ name: 'ESPN+', kind: 'stream' }, { name: 'ESPN Deportes', kind: 'tv' }], watch: [] });
  expect(watchTarget(broadcastOnly)).toBeUndefined();
  expect(airingText(broadcastOnly)).toBe('ESPN Deportes · ESPN+');
  const line = cardLine(broadcastOnly, matchup(broadcastOnly))!;
  expect(line.action).toBe(false);
  expect(line.text).not.toMatch(/Watch/);
  const addon = event({ watch: [{ kind: 'addon', name: 'Peacock', live: true, confidence: 0.9 }] });
  expect(watchTarget(addon)).toBeUndefined();
  expect(cardLine(addon, matchup(addon))!.action).toBe(false);
  const tunableEvent = event({ watch: [{ kind: 'channel', channelId: 'c7', name: 'FOX', number: '205', live: true, confidence: 0.7 }] });
  expect(cardLine(tunableEvent, matchup(tunableEvent))).toEqual({ glyph: 'play-fill', text: 'Watch on FOX · 205', action: true });
  expect(cardLine(event({ spoiler: true }), { spoiler: true, phase: 'live' })!.action).toBe(false);
  expect(cardLine(event({ status: { state: 'in', detail: '' } }), { spoiler: false, phase: 'live' })).toBeNull();
});

test('league chips use a name when the abbreviation is not self-explanatory', () => {
  const label = (name: string, abbr?: string) => leagueLabel({ name, abbr });
  expect(label('La Liga', 'LAL')).toBe('La Liga');
  expect(label('Ligue 1', 'L1')).toBe('Ligue 1');
  expect(label('Bundesliga', 'BUN')).toBe('Bundesliga');
  expect(label('Serie A', 'SA')).toBe('Serie A');
  expect(label('NFL', 'NFL')).toBe('NFL');
  expect(label('National Hockey League', 'NHL')).toBe('NHL');
  expect(label('Major League Soccer', 'MLS')).toBe('MLS');
  expect(label('Formula 1', 'F1')).toBe('F1');
  expect(label('PGA Tour', 'PGA')).toBe('PGA');
  expect(label('Premier League', 'EPL')).toBe('EPL');
  expect(label('UEFA Champions League', 'UCL')).toBe('UCL');
  expect(label('NCAAM')).toBe('NCAAM');
  expect(matchup(event({ league: { id: 'laliga', name: 'La Liga', abbr: 'LAL' } })).league).toBe('La Liga');
});

test('ranking rows share a place on a tie and keep their headline apart from the context', () => {
  const rows = rankRows([
    { pos: 1, name: 'Max Greyserman', detail: '-9', secondary: 'Thru 14' },
    { pos: 1, name: 'Max McGreevy', detail: '-9' },
    { pos: 3, name: 'Marco Penge', detail: ' -8 ' },
  ]);
  expect(rows.map(r => r.place)).toEqual(['T1', 'T1', '3']);
  expect(rows[0]!.secondary).toBe('Thru 14');
  expect(rows[2]!.detail).toBe('-8');
  expect(rankRows(undefined)).toEqual([]);
});

test('plays read newest first whichever way they arrive', () => {
  const oldest = [{ clock: "6'", period: 1, text: 'a', emphasis: 'normal' as const }, { clock: "81'", period: 2, text: 'b', emphasis: 'normal' as const }];
  expect(newestFirst(oldest).map(p => p.text)).toEqual(['b', 'a']);
  expect(newestFirst([...oldest].reverse()).map(p => p.text)).toEqual(['b', 'a']);
  expect(newestFirst([{ text: 'x', emphasis: 'normal' }, { text: 'y', emphasis: 'normal' }]).map(p => p.text)).toEqual(['y', 'x']);
});

test('a plugin link is not where a game airs', () => {
  const e = event({ broadcasts: [{ name: 'ESPN+', kind: 'stream' }], watch: [{ kind: 'plugin', name: 'Commentary', live: true, confidence: 0.5 }] });
  expect(airingText(e)).toBe('ESPN+');
});
