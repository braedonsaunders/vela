// Live events, the Sports screen and multiview, shaped exactly like Ether's 0.3.19 contract
// (packages/protocol/live-events.ts). Scores tick while the mock runs so live UI visibly moves:
// every VELA_MOCK_LIVE_TICK_MS (default 3000) each live event advances its clock, sometimes
// scores, and the change is pushed on /live/stream. A finished replay restarts its script.
//
// Knobs: VELA_MOCK_NO_SPORTS=1 hides it all (no features, navigation or endpoints);
// VELA_MOCK_SPOILER_FREE=1 makes the viewer spoiler-free for every started event;
// VELA_MOCK_PROVIDER_CAP=n refuses a multiview tile past n channels of one provider.
// POST /__admin/sports {providerCap, spoilerFree, alert} changes them at runtime.
import type * as V from '../packages/protocol/types';

const PLUGIN = 'sports', FEED = 'sports';
const ns = (id: string) => `${PLUGIN}:${FEED}:${id}`;
export const entityKey = (id: string) => `${PLUGIN}:${FEED}:team:${id}`;

export const sportsEnabled = process.env.VELA_MOCK_NO_SPORTS !== '1';
const tickMs = Math.max(20, Number(process.env.VELA_MOCK_LIVE_TICK_MS) || 3000);
export const sportsKnobs = {
  providerCap: Math.max(0, Math.floor(Number(process.env.VELA_MOCK_PROVIDER_CAP) || 0)),
  spoilerFree: process.env.VELA_MOCK_SPOILER_FREE === '1',
};

// Deterministic randomness, so a run is repeatable.
let seed = 0x5eed;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

interface Team { id: string; league: string; name: string; short: string; abbr: string; color: string; altColor: string; record: string }
const team = (league: string, abbr: string, name: string, short: string, color: string, altColor: string, record: string): Team =>
  ({ id: `${league}-${abbr.toLowerCase()}`, league, name, short, abbr, color, altColor, record });
const TEAMS: Team[] = [
  team('nfl', 'NYG', 'New York Giants', 'Giants', '0b2265', 'a71930', '4-7'),
  team('nfl', 'PHI', 'Philadelphia Eagles', 'Eagles', '004c54', 'a5acaf', '9-2'),
  team('nfl', 'DAL', 'Dallas Cowboys', 'Cowboys', '041e42', '869397', '7-4'),
  team('nfl', 'WSH', 'Washington Commanders', 'Commanders', '5a1414', 'ffb612', '5-6'),
  team('nfl', 'KC', 'Kansas City Chiefs', 'Chiefs', 'e31837', 'ffb612', '9-2'),
  team('nfl', 'BUF', 'Buffalo Bills', 'Bills', '00338d', 'c60c30', '8-3'),
  team('nhl', 'TOR', 'Toronto Maple Leafs', 'Maple Leafs', '00205b', 'ffffff', '14-6-2'),
  team('nhl', 'MTL', 'Montréal Canadiens', 'Canadiens', 'af1e2d', '192168', '11-9-3'),
  team('nhl', 'BOS', 'Boston Bruins', 'Bruins', 'fcb514', '111111', '12-8-2'),
  team('nhl', 'NYR', 'New York Rangers', 'Rangers', '0038a8', 'ce1126', '13-7-1'),
  team('nba', 'BOS', 'Boston Celtics', 'Celtics', '007a33', 'ba9653', '12-4'),
  team('nba', 'NYK', 'New York Knicks', 'Knicks', '006bb6', 'f58426', '10-6'),
  team('nba', 'TOR', 'Toronto Raptors', 'Raptors', 'ce1141', '000000', '9-7'),
  team('nba', 'MIL', 'Milwaukee Bucks', 'Bucks', '00471b', 'eee1c6', '8-8'),
  team('nba', 'LAL', 'Los Angeles Lakers', 'Lakers', '552583', 'fdb927', '11-5'),
  team('nba', 'GSW', 'Golden State Warriors', 'Warriors', '1d428a', 'ffc72c', '10-6'),
  team('mlb', 'TOR', 'Toronto Blue Jays', 'Blue Jays', '134a8e', 'e8291c', '0-0'),
  team('mlb', 'NYY', 'New York Yankees', 'Yankees', '0c2340', 'c4ced3', '0-0'),
  team('epl', 'ARS', 'Arsenal', 'Arsenal', 'ef0107', '063672', '8-3-1'),
  team('epl', 'LIV', 'Liverpool', 'Liverpool', 'c8102e', '00b2a9', '9-1-2'),
  team('epl', 'MCI', 'Manchester City', 'Man City', '6cabdd', '1c2c5b', '7-2-3'),
  team('epl', 'CHE', 'Chelsea', 'Chelsea', '034694', 'dba111', '6-4-2'),
];
const LEAGUES: Record<string, V.LiveLeague & { category: string }> = {
  nfl: { id: 'nfl', name: 'NFL', abbr: 'NFL', category: 'football' },
  nba: { id: 'nba', name: 'NBA', abbr: 'NBA', category: 'basketball' },
  nhl: { id: 'nhl', name: 'NHL', abbr: 'NHL', category: 'hockey' },
  mlb: { id: 'mlb', name: 'MLB', abbr: 'MLB', category: 'baseball' },
  epl: { id: 'epl', name: 'Premier League', abbr: 'EPL', category: 'soccer' },
  f1: { id: 'f1', name: 'Formula 1', abbr: 'F1', category: 'f1' },
};
const DEFAULT_FAVOURITES = ['nfl-phi', 'nhl-tor', 'nba-tor', 'mlb-tor', 'epl-mci'];

/** One sport's rules for the simulation and the score page. */
interface Rules { periods: number; periodSeconds: number; countUp?: boolean; tick: number; scoreChance: number; points: number[]; periodName: (n: number) => string; columns: (n: number) => string }
const RULES: Record<string, Rules> = {
  football: { periods: 4, periodSeconds: 900, tick: 3, scoreChance: 0.035, points: [3, 7, 7, 6], periodName: n => n > 4 ? 'OT' : `Q${n}`, columns: n => n > 4 ? 'OT' : `Q${n}` },
  basketball: { periods: 4, periodSeconds: 720, tick: 6, scoreChance: 0.5, points: [2, 2, 3, 1], periodName: n => n > 4 ? 'OT' : `Q${n}`, columns: n => n > 4 ? 'OT' : `Q${n}` },
  hockey: { periods: 3, periodSeconds: 1200, tick: 5, scoreChance: 0.025, points: [1], periodName: n => n > 3 ? 'OT' : ['1st', '2nd', '3rd'][n - 1]!, columns: n => n > 3 ? 'OT' : String(n) },
  soccer: { periods: 2, periodSeconds: 2700, countUp: true, tick: 6, scoreChance: 0.012, points: [1], periodName: n => n === 1 ? '1st half' : '2nd half', columns: n => n === 1 ? '1H' : '2H' },
};

interface Sim {
  id: string; league: string; title?: string; start: number;
  state: V.LiveEventState; period: number; clock: number;
  home: string; away: string; scores: [number, number]; lines: [number[], number[]];
  situation?: Record<string, string>; probability: number; series: V.LiveProbabilityPoint[];
  plays: V.LivePlay[]; broadcasts: V.LiveBroadcast[]; venue?: V.LiveEvent['venue'];
  /** Channel indexes (into the mock lineup) carrying it. */ channels: number[]; addon?: string;
  ranking?: V.LiveRankingRow[]; laps?: [number, number];
  updatedAt: string; initial?: string; postedAt?: number;
}
const sims = new Map<string, Sim>();
const H = 3600_000, now0 = Date.now();
const dayStart = (offset: number) => { const d = new Date(now0); d.setHours(0, 0, 0, 0); return d.getTime() + offset * 24 * H; };

function makeSim(id: string, league: string, away: string, home: string, start: number, state: V.LiveEventState, more: Partial<Sim> = {}): Sim {
  const lines: [number[], number[]] = [[], []];
  const sim: Sim = { id: ns(id), league, start, state, period: 0, clock: 0, home: `${league}-${home.toLowerCase()}`, away: `${league}-${away.toLowerCase()}`,
    scores: [0, 0], lines, probability: 0.5, series: [], plays: [], broadcasts: [], channels: [], updatedAt: new Date().toISOString(), ...more };
  if (more.lines) sim.scores = [sum(more.lines[0]), sum(more.lines[1])];
  sims.set(sim.id, sim);
  return sim;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function seedFixtures(): void {
  makeSim('nfl-nyg-phi', 'nfl', 'NYG', 'PHI', now0 - 3 * H, 'in', {
    period: 4, clock: 134, lines: [[7, 3, 7, 7], [0, 14, 3, 10]], probability: 0.64,
    situation: { Down: '3rd & 6', Ball: 'NYG 38', Possession: 'PHI' },
    broadcasts: [{ name: 'FOX', kind: 'tv', region: 'US' }], channels: [6, 19], venue: { name: 'Lincoln Financial Field', city: 'Philadelphia' },
    plays: [
      { clock: '2:14', period: 4, text: 'Barkley rush right for 7 yards', emphasis: 'normal', competitorId: 'nfl-phi' },
      { clock: '2:51', period: 4, text: 'Hurts pass short left to Brown for 12 yards', emphasis: 'normal', competitorId: 'nfl-phi' },
      { clock: '3:30', period: 4, text: 'FIELD GOAL Elliott 44 yd · PHI 27–24', emphasis: 'score', competitorId: 'nfl-phi' },
      { clock: '5:02', period: 4, text: 'Timeout NYG', emphasis: 'normal', competitorId: 'nfl-nyg' },
      { clock: '6:40', period: 4, text: 'Jones pass deep right to Nabers for 41 yards, TOUCHDOWN · NYG 24–24', emphasis: 'score', competitorId: 'nfl-nyg' },
      { clock: '8:15', period: 4, text: 'Hurts sacked at PHI 30 for -8 yards (Burns)', emphasis: 'key', competitorId: 'nfl-nyg' },
      { clock: '11:02', period: 4, text: 'Hurts 2 yd run, TOUCHDOWN · PHI 24–17', emphasis: 'score', competitorId: 'nfl-phi' },
    ],
  });
  makeSim('nhl-tor-mtl', 'nhl', 'MTL', 'TOR', now0 - 1.5 * H, 'in', { period: 2, clock: 520, lines: [[1, 0], [1, 1]], probability: 0.61,
    broadcasts: [{ name: 'Sportsnet', kind: 'tv', region: 'CA' }], channels: [28], situation: { Shots: 'MTL 17 · TOR 24', 'Power play': 'TOR 1:12' },
    plays: [{ clock: '11:20', period: 2, text: 'Matthews goal (Marner, Rielly) · TOR 2–1', emphasis: 'score', competitorId: 'nhl-tor' },
      { clock: '4:05', period: 1, text: 'Caufield goal (Suzuki) · 1–1', emphasis: 'score', competitorId: 'nhl-mtl' },
      { clock: '12:48', period: 1, text: 'Nylander goal (Tavares) · TOR 1–0', emphasis: 'score', competitorId: 'nhl-tor' }] });
  makeSim('epl-ars-liv', 'epl', 'LIV', 'ARS', now0 - 1.25 * H, 'in', { period: 2, clock: 71 * 60, lines: [[1, 0], [0, 1]], probability: 0.44,
    broadcasts: [{ name: 'Peacock', kind: 'stream', region: 'US' }], addon: 'Peacock', channels: [37], venue: { name: 'Emirates Stadium', city: 'London' },
    situation: { Possession: 'ARS 54%', Shots: '11 – 9' },
    plays: [{ clock: "63'", period: 2, text: 'Saka goal (Ødegaard) · 1–1', emphasis: 'score', competitorId: 'epl-ars' },
      { clock: "58'", period: 2, text: 'Yellow card, Rice', emphasis: 'key', competitorId: 'epl-ars' },
      { clock: "22'", period: 1, text: 'Salah goal (Szoboszlai) · LIV 1–0', emphasis: 'score', competitorId: 'epl-liv' }] });
  makeSim('nba-bos-nyk', 'nba', 'NYK', 'BOS', now0 + 2 * H, 'pre', { broadcasts: [{ name: 'TNT', kind: 'tv', region: 'US' }], channels: [10], venue: { name: 'TD Garden', city: 'Boston' } });
  makeSim('nba-mil-tor', 'nba', 'MIL', 'TOR', dayStart(-1) + 19.5 * H, 'post', { period: 4, lines: [[24, 31, 26, 28], [30, 27, 33, 28]],
    broadcasts: [{ name: 'TSN', kind: 'tv', region: 'CA' }], channels: [10] });
  makeSim('mlb-nyy-tor', 'mlb', 'NYY', 'TOR', dayStart(1) + 19 * H, 'pre', { broadcasts: [{ name: 'Sportsnet', kind: 'tv', region: 'CA' }], channels: [28] });
  makeSim('epl-che-mci', 'epl', 'CHE', 'MCI', dayStart(-1) + 12.5 * H, 'post', { period: 2, lines: [[0, 1], [2, 1]],
    broadcasts: [{ name: 'NBC', kind: 'tv', region: 'US' }], channels: [6] });
  makeSim('f1-las-vegas', 'f1', '', '', now0 - 0.9 * H, 'in', { title: 'Las Vegas Grand Prix', laps: [31, 50],
    broadcasts: [{ name: 'ESPN', kind: 'tv', region: 'US' }], channels: [19], venue: { name: 'Las Vegas Strip Circuit', city: 'Las Vegas' },
    ranking: ['Max Verstappen:VER', 'Lando Norris:NOR', 'Charles Leclerc:LEC', 'Lewis Hamilton:HAM', 'Oscar Piastri:PIA', 'George Russell:RUS', 'Carlos Sainz:SAI', 'Fernando Alonso:ALO']
      .map((driver, n) => { const [name, abbr] = driver.split(':') as [string, string]; return { pos: n + 1, name, abbr, detail: n ? `+${(n * 2.41).toFixed(3)}` : 'Leader', entityId: `f1-${abbr.toLowerCase()}` }; }) });
  makeSim('nfl-buf-kc', 'nfl', 'BUF', 'KC', now0 - 1 * H, 'in', { period: 2, clock: 552, lines: [[7, 3], [3, 7]], probability: 0.55,
    situation: { Down: '1st & 10', Ball: 'KC 25', Possession: 'BUF' }, broadcasts: [{ name: 'CBS', kind: 'tv', region: 'US' }], channels: [46] });
  makeSim('nfl-dal-wsh', 'nfl', 'DAL', 'WSH', now0 + 3 * H, 'pre', { broadcasts: [{ name: 'FOX', kind: 'tv', region: 'US' }], channels: [6] });
  makeSim('nba-gsw-lal', 'nba', 'GSW', 'LAL', now0 - 1.6 * H, 'in', { period: 3, clock: 341, lines: [[28, 25, 28], [26, 30, 22]], probability: 0.47,
    broadcasts: [{ name: 'ESPN', kind: 'tv', region: 'US' }], channels: [55] });
  makeSim('nhl-nyr-bos', 'nhl', 'NYR', 'BOS', dayStart(-1) + 19 * H, 'post', { period: 4, lines: [[1, 2, 0, 0], [0, 1, 2, 1]], broadcasts: [{ name: 'TNT', kind: 'tv', region: 'US' }] });
  makeSim('epl-liv-mci', 'epl', 'LIV', 'MCI', dayStart(3) + 11.5 * H, 'pre', { broadcasts: [{ name: 'Peacock', kind: 'stream', region: 'US' }], addon: 'Peacock' });
  makeSim('nfl-phi-dal', 'nfl', 'PHI', 'DAL', dayStart(4) + 16.4 * H, 'pre', { broadcasts: [{ name: 'FOX', kind: 'tv', region: 'US' }], channels: [6] });
  makeSim('nhl-tor-bos', 'nhl', 'TOR', 'BOS', dayStart(2) + 19 * H, 'pre', { broadcasts: [{ name: 'Sportsnet', kind: 'tv', region: 'CA' }], channels: [28] });
  makeSim('nfl-kc-phi', 'nfl', 'KC', 'PHI', dayStart(-3) + 20.3 * H, 'post', { period: 4, lines: [[3, 7, 0, 7], [7, 10, 7, 3]] });
  makeSim('nba-tor-bos', 'nba', 'TOR', 'BOS', dayStart(-2) + 19.5 * H, 'post', { period: 4, lines: [[25, 22, 30, 24], [29, 31, 24, 28]] });
  for (const sim of sims.values()) {
    if (sim.state === 'post') { sim.probability = sim.scores[1] > sim.scores[0] ? 1 : 0; sim.series = []; }
    if (sim.state === 'in') seedSeries(sim);
    sim.initial = JSON.stringify(sim);
  }
}

// Presentation

const teamById = (id: string) => TEAMS.find(t => t.id === id);
let logoOrigin = '';
const competitor = (sim: Sim, side: 0 | 1): V.LiveCompetitor => {
  const t = teamById(side ? sim.home : sim.away)!;
  const post = sim.state === 'post';
  return { id: t.id, name: t.name, short: t.short, abbr: t.abbr, logo: `${logoOrigin}/vela/v0/sports-mock/logos/${t.id}.svg`, color: `#${t.color}`, altColor: `#${t.altColor}`,
    ...(sim.state === 'pre' ? {} : { score: String(sim.scores[side]) }), record: t.record, home: side === 1,
    ...(post ? { winner: sim.scores[side] > sim.scores[side ? 0 : 1] } : {}), entityId: t.id };
};
function clockText(sim: Sim, rules: Rules): string {
  if (rules.countUp) return `${Math.floor(sim.clock / 60)}'`;
  const s = Math.max(0, Math.round(sim.clock));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
const timeOfDay = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
function statusOf(sim: Sim): V.LiveEventStatus {
  const league = LEAGUES[sim.league]!;
  if (sim.state === 'pre') return { state: 'pre', detail: timeOfDay(sim.start) };
  if (league.category === 'f1') {
    const [lap, laps] = sim.laps!;
    return sim.state === 'post' ? { state: 'post', detail: 'Final' } : { state: 'in', detail: `Lap ${lap}/${laps}`, period: lap };
  }
  const rules = RULES[league.category]!;
  if (sim.state === 'post') return { state: 'post', detail: sim.period > rules.periods ? 'Final/OT' : 'Final', period: sim.period };
  const clock = clockText(sim, rules);
  const detail = rules.countUp ? clock : `${rules.periodName(sim.period)} · ${clock}`;
  return { state: 'in', detail, period: sim.period, clock, close: isClose(sim, rules) };
}
function isClose(sim: Sim, rules: Rules): boolean {
  const diff = Math.abs(sim.scores[0] - sim.scores[1]);
  const last = sim.period >= rules.periods;
  switch (LEAGUES[sim.league]!.category) {
    case 'football': return last && sim.clock < 300 && diff <= 8;
    case 'basketball': return last && sim.clock < 180 && diff <= 5;
    case 'hockey': return last && diff <= 1;
    case 'soccer': return sim.clock >= 80 * 60 && diff === 0;
    default: return false;
  }
}
function watchTargets(sim: Sim): V.WatchTarget[] {
  const live = sim.state === 'in';
  const targets: V.WatchTarget[] = sim.channels.flatMap((index, n) => {
    const channel = lineup[index];
    return channel ? [{ kind: 'channel' as const, channelId: channel.id, name: channel.name, number: channel.number, live, confidence: n ? 0.7 : 0.95 }] : [];
  });
  if (sim.addon) targets.push({ kind: 'addon', name: sim.addon, live, confidence: 0.6 });
  return targets;
}
function presentEvent(sim: Sim, viewerId: string): V.LiveEvent {
  const league = LEAGUES[sim.league]!;
  const { category, ...leagueRef } = league;
  const two = category !== 'f1';
  const event: V.LiveEvent = {
    id: sim.id, feed: FEED, category, league: leagueRef, ...(sim.title ? { title: sim.title } : {}),
    start: new Date(sim.start).toISOString(), status: statusOf(sim),
    competitors: two ? [competitor(sim, 0), competitor(sim, 1)] : [],
    ...(sim.ranking ? { ranking: sim.ranking } : {}),
    ...(sim.situation && sim.state === 'in' ? { situation: sim.situation } : {}),
    ...(two && sim.state === 'in' ? { probability: { label: 'Win probability', value: sim.probability, competitorId: sim.home } } : {}),
    ...(sim.venue ? { venue: sim.venue } : {}),
    broadcasts: sim.broadcasts,
    matchHints: { terms: two ? [teamById(sim.home)!, teamById(sim.away)!].flatMap(t => [t.name, t.short, t.abbr]) : [sim.title ?? ''], callsigns: sim.broadcasts.map(b => b.name) },
    updatedAt: sim.updatedAt,
    watch: watchTargets(sim),
  };
  return spoilered(sim, viewerId) ? withheld(event) : event;
}
/** What a spoiler-free viewer sees before revealing: no scores, winners, probability or ranking. */
function withheld(event: V.LiveEvent): V.LiveEvent {
  const { probability: _p, ranking: _r, situation: _s, ...rest } = event;
  return { ...rest, spoiler: true, competitors: event.competitors.map(({ score: _score, winner: _winner, ...c }) => c),
    status: { ...event.status, detail: event.status.state === 'post' ? 'Final' : event.status.state === 'in' ? 'Live' : event.status.detail, clock: undefined, close: undefined } };
}
function presentDetail(sim: Sim, viewerId: string): V.LiveEventDetail {
  const event = presentEvent(sim, viewerId);
  const links = [{ label: 'Game centre', url: `https://example.invalid/sports/${encodeURIComponent(sim.id)}` }];
  if (event.spoiler) return { ...event, tables: [], plays: [], probabilitySeries: [], links };
  return { ...event, tables: tablesFor(sim), plays: sim.plays.slice(0, 40), probabilitySeries: sim.series, links };
}
function tablesFor(sim: Sim): V.LiveTable[] {
  const category = LEAGUES[sim.league]!.category;
  if (category === 'f1') return [{ title: 'Running order', columns: ['Pos', 'Driver', 'Gap'], rows: (sim.ranking ?? []).map(r => [String(r.pos), r.name, r.detail ?? '']) }];
  const rules = RULES[category];
  if (!rules) return [];
  const periods = Math.max(rules.periods, sim.lines[0].length, sim.lines[1].length);
  const columns = ['Team', ...Array.from({ length: periods }, (_, n) => rules.columns(n + 1)), 'T'];
  const line = (side: 0 | 1) => [teamById(side ? sim.home : sim.away)!.abbr, ...Array.from({ length: periods }, (_, n) => sim.lines[side][n] === undefined ? '–' : String(sim.lines[side][n])), String(sim.scores[side])];
  const tables: V.LiveTable[] = [{ title: 'Scoring', columns, rows: [line(0), line(1)] }];
  const away = teamById(sim.away)!.abbr, home = teamById(sim.home)!.abbr;
  const stat = (label: string, a: number | string, b: number | string) => [label, String(a), String(b)];
  const k = sim.scores[0] + sim.scores[1] + sim.period;
  if (category === 'football') tables.push({ title: 'Team stats', columns: ['', away, home], rows: [stat('Total yards', 250 + k * 4, 270 + k * 3), stat('Passing', 180 + k * 2, 165 + k * 2), stat('Rushing', 70 + k, 105 + k), stat('Turnovers', 1, 0), stat('Possession', '27:41', '29:05')] });
  if (category === 'basketball') tables.push({ title: 'Team stats', columns: ['', away, home], rows: [stat('FG%', '46.2', '48.9'), stat('3PT', '12-31', '14-35'), stat('Rebounds', 38, 41), stat('Assists', 22, 25)] });
  if (category === 'hockey') tables.push({ title: 'Team stats', columns: ['', away, home], rows: [stat('Shots', 17 + sim.period * 3, 24 + sim.period * 3), stat('Faceoffs', '48%', '52%'), stat('Hits', 21, 18), stat('Power play', '0/2', '1/3')] });
  if (category === 'soccer') tables.push({ title: 'Match stats', columns: ['', away, home], rows: [stat('Possession', '46%', '54%'), stat('Shots', 9, 11), stat('On target', 4, 5), stat('Corners', 3, 6)] });
  return tables;
}

// Viewers: favourites and spoilers (one demo viewer, kept per viewer id anyway)

const favourites = new Map<string, Set<string>>();
const revealed = new Map<string, Set<string>>();
const favouritesOf = (viewerId: string) => { let set = favourites.get(viewerId); if (!set) favourites.set(viewerId, set = new Set(DEFAULT_FAVOURITES.map(entityKey))); return set; };
const DEFAULT_SPOILERS = new Set([ns('epl-che-mci')]);
function spoilered(sim: Sim, viewerId: string): boolean {
  if (revealed.get(viewerId)?.has(sim.id)) return false;
  return sim.state !== 'pre' && (sportsKnobs.spoilerFree || DEFAULT_SPOILERS.has(sim.id));
}
const isFavourite = (sim: Sim, viewerId: string) => [sim.home, sim.away].some(id => favouritesOf(viewerId).has(entityKey(id)));

// Screens

const rank = (sim: Sim) => (sim.state === 'in' ? 0 : sim.state === 'pre' ? 1 : 2);
const byInterest = (viewerId: string) => (a: Sim, b: Sim) => (rank(a) - rank(b)) || (Number(isFavourite(b, viewerId)) - Number(isFavourite(a, viewerId)))
  || (a.state === 'post' ? b.start - a.start : a.start - b.start);
const isoDay = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayLabel = (offset: number, at: number) => offset === 0 ? 'Today' : offset === -1 ? 'Yesterday' : offset === 1 ? 'Tomorrow' : new Date(at).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });

export function screen(id: string, viewerId: string, league: string | null, date: string | null): V.Screen | undefined {
  if (id !== 'sports') return undefined;
  const all = [...sims.values()].filter(sim => !league || sim.league === league);
  const sorted = all.sort(byInterest(viewerId));
  const present = (list: Sim[]) => list.map(sim => presentEvent(sim, viewerId));
  const live = sorted.filter(sim => sim.state === 'in');
  const hero = live.find(sim => isFavourite(sim, viewerId) && LEAGUES[sim.league]!.category !== 'f1') ?? live[0] ?? sorted[0];
  const also = sorted.filter(sim => sim !== hero && sim.state !== 'post').slice(0, 3);
  const today = isoDay(now0);
  const shown = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const offsets = [-3, -2, -1, 0, 1, 2, 3, 4];
  const days = offsets.map(offset => { const at = dayStart(offset); return { date: isoDay(at), label: dayLabel(offset, at), count: all.filter(sim => isoDay(sim.start) === isoDay(at)).length }; });
  const index = days.findIndex(day => day.date === shown);
  const favouriteSims = sorted.filter(sim => isFavourite(sim, viewerId) && Math.abs(sim.start - now0) < 7 * 24 * H);
  const entities = TEAMS.filter(t => !league || t.league === league).map(t => entity(t, viewerId))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite));
  const tableLeague = league && STANDINGS[league] ? league : 'nfl';
  const sections: V.ScreenSection[] = [
    { id: 'hero', type: 'hero', event: hero ? presentEvent(hero, viewerId) : null, also: present(also) },
    { id: 'leagues', type: 'leagues', title: 'Leagues', leagues: Object.values(LEAGUES).map(({ category: _c, ...l }) => l), ...(league ? { selected: league } : {}) },
    { id: 'favorites', type: 'events', title: 'Your teams', query: { favorites: true, window: 'week' }, events: present(favouriteSims) },
    { id: 'live', type: 'events', title: 'Live now', query: { state: ['in'] }, events: present(live) },
    { id: 'schedule', type: 'schedule', title: 'Schedule', date: shown, ...(index > 0 ? { previous: days[index - 1]!.date } : {}), ...(index >= 0 && index < days.length - 1 ? { next: days[index + 1]!.date } : {}),
      days, events: present(all.filter(sim => isoDay(sim.start) === shown).sort((a, b) => a.start - b.start)) },
    { id: 'standings', type: 'table', title: `${LEAGUES[tableLeague]!.name} standings`, feed: FEED, league: tableLeague, tables: STANDINGS[tableLeague]! },
    { id: 'teams', type: 'entities', title: 'Pick your teams', feed: FEED, entityKind: 'team', entities },
  ];
  return { id: 'sports', title: 'Sports', icon: 'sports', ...(league ? { league } : {}), date: shown, sections };
}
const entity = (t: Team, viewerId: string): V.LiveEntity => ({ id: t.id, kind: 'team', name: t.name, abbr: t.abbr, logo: `${logoOrigin}/vela/v0/sports-mock/logos/${t.id}.svg`,
  league: t.league, color: `#${t.color}`, key: entityKey(t.id), favorite: favouritesOf(viewerId).has(entityKey(t.id)) });
const STANDINGS: Record<string, V.LiveTable[]> = {
  nfl: [
    { title: 'NFC East', columns: ['Team', 'W', 'L', 'PCT', 'PF', 'PA', 'STRK'], rows: [['Eagles', '9', '2', '.818', '298', '201', 'W4'], ['Cowboys', '7', '4', '.636', '271', '240', 'L1'], ['Commanders', '5', '6', '.455', '233', '252', 'W1'], ['Giants', '4', '7', '.364', '210', '262', 'L2']] },
    { title: 'AFC West', columns: ['Team', 'W', 'L', 'PCT', 'PF', 'PA', 'STRK'], rows: [['Chiefs', '9', '2', '.818', '287', '198', 'W3'], ['Chargers', '7', '4', '.636', '244', '209', 'W2'], ['Broncos', '6', '5', '.545', '230', '221', 'L1'], ['Raiders', '2', '9', '.182', '180', '290', 'L5']] },
  ],
  nba: [{ title: 'Eastern Conference', columns: ['Team', 'W', 'L', 'PCT', 'GB', 'L10'], rows: [['Celtics', '12', '4', '.750', '–', '7-3'], ['Knicks', '10', '6', '.625', '2', '6-4'], ['Raptors', '9', '7', '.563', '3', '6-4'], ['Bucks', '8', '8', '.500', '4', '4-6']] }],
  nhl: [{ title: 'Atlantic Division', columns: ['Team', 'GP', 'W', 'L', 'OTL', 'PTS'], rows: [['Maple Leafs', '22', '14', '6', '2', '30'], ['Bruins', '22', '12', '8', '2', '26'], ['Canadiens', '23', '11', '9', '3', '25'], ['Senators', '21', '10', '10', '1', '21']] }],
  epl: [{ title: 'Premier League', columns: ['Club', 'P', 'W', 'D', 'L', 'GD', 'Pts'], rows: [['Liverpool', '12', '9', '2', '1', '+16', '29'], ['Arsenal', '12', '8', '1', '3', '+12', '25'], ['Man City', '12', '7', '3', '2', '+11', '24'], ['Chelsea', '12', '6', '2', '4', '+5', '20']] }],
};

// Simulation

function scorePlay(sim: Sim, side: 0 | 1, points: number, clock: string): V.LivePlay {
  const t = teamById(side ? sim.home : sim.away)!;
  const category = LEAGUES[sim.league]!.category;
  const what = category === 'football' ? (points === 3 ? 'FIELD GOAL' : points === 6 ? 'TOUCHDOWN (kick blocked)' : 'TOUCHDOWN') : category === 'basketball' ? (points === 3 ? 'three-pointer' : points === 1 ? 'free throw' : 'jump shot') : 'GOAL';
  const lead = `${teamById(sim.away)!.abbr} ${sim.scores[0]}–${sim.scores[1]} ${teamById(sim.home)!.abbr}`;
  return { clock, period: sim.period, text: `${t.short} ${what} · ${lead}`, emphasis: category === 'basketball' && points < 3 ? 'normal' : 'score', competitorId: t.id };
}
const FILLER: Record<string, string[]> = {
  football: ['rush up the middle for 4 yards', 'pass short right complete for 9 yards', 'pass incomplete deep left', 'punt 44 yards, fair catch', 'sacked for a loss of 6', 'rush left end for 11 yards'],
  hockey: ['shot on goal, saved', 'icing', 'hit along the boards', 'faceoff won in the offensive zone'],
  soccer: ['corner kick', 'shot blocked', 'foul in midfield', 'substitution'],
  basketball: [],
};
function step(sim: Sim): boolean {
  const league = LEAGUES[sim.league]!;
  if (sim.state === 'post' && sim.postedAt && Date.now() - sim.postedAt > 20 * tickMs && sim.initial) {
    // A finished replay starts its script again, so live UI always has something moving.
    const fresh = JSON.parse(sim.initial) as Sim;
    Object.assign(sim, fresh, { initial: sim.initial, postedAt: undefined, updatedAt: new Date().toISOString() });
    return true;
  }
  if (sim.state !== 'in') return false;
  if (league.category === 'f1') {
    if (random() < 0.3 && sim.laps) {
      sim.laps = [Math.min(sim.laps[0] + 1, sim.laps[1]), sim.laps[1]];
      const ranking = sim.ranking!;
      const swap = 1 + Math.floor(random() * (ranking.length - 1));
      if (random() < 0.4) [ranking[swap - 1], ranking[swap]] = [{ ...ranking[swap]!, pos: swap }, { ...ranking[swap - 1]!, pos: swap + 1 }];
      ranking.forEach((row, n) => { row.detail = n ? `+${(n * 2.41 + random()).toFixed(3)}` : 'Leader'; });
      if (sim.laps[0] >= sim.laps[1]) { sim.state = 'post'; sim.postedAt = Date.now(); }
      return true;
    }
    return false;
  }
  const rules = RULES[league.category]!;
  const before = clockText(sim, rules);
  sim.clock += rules.countUp ? rules.tick : -rules.tick;
  const clock = clockText(sim, rules);
  let changed = clock !== before;
  if (random() < rules.scoreChance) {
    const side = (random() < 0.5 ? 0 : 1) as 0 | 1;
    const points = rules.points[Math.floor(random() * rules.points.length)]!;
    sim.scores[side] += points;
    sim.lines[side][sim.period - 1] = (sim.lines[side][sim.period - 1] ?? 0) + points;
    sim.plays.unshift(scorePlay(sim, side, points, clock));
    changed = true;
  } else if (FILLER[league.category]!.length && random() < 0.35) {
    const side = (random() < 0.5 ? 0 : 1) as 0 | 1;
    const lines = FILLER[league.category]!;
    sim.plays.unshift({ clock, period: sim.period, text: `${teamById(side ? sim.home : sim.away)!.short} ${lines[Math.floor(random() * lines.length)]}`, emphasis: 'normal', competitorId: side ? sim.home : sim.away });
    changed = true;
  }
  sim.plays.length = Math.min(sim.plays.length, 60);
  // The period ends: the next starts, or the game is final.
  if (rules.countUp && sim.period === 1 && sim.clock >= 45 * 60) { sim.period = 2; changed = true; }
  const ended = rules.countUp ? sim.clock >= 93 * 60 : sim.clock <= 0;
  if (ended) {
    if (rules.countUp || sim.period >= rules.periods && sim.scores[0] !== sim.scores[1]) { sim.state = 'post'; sim.postedAt = Date.now(); }
    else { sim.period++; sim.clock = rules.countUp ? sim.clock : rules.periodSeconds; for (const line of sim.lines) line[sim.period - 1] ??= 0; }
    changed = true;
  }
  if (league.category === 'football' && changed) {
    const downs = ['1st & 10', '2nd & 6', '3rd & 2', '1st & 10', '2nd & 11', '3rd & 4'];
    sim.situation = { ...sim.situation, Down: downs[Math.floor(random() * downs.length)]! };
  }
  // Win probability follows the score and the clock: the same lead counts for more as time runs out.
  const elapsed = progress(sim, rules);
  const margin = sim.scores[1] - sim.scores[0];
  sim.probability = sim.state === 'post' ? (margin > 0 ? 1 : margin < 0 ? 0 : 0.5) : winChance(league.category, margin, elapsed, jitter());
  const last = sim.series.at(-1);
  if (!last || Number(last.t) < elapsed - 0.004 || Math.abs(last.value - sim.probability) > 0.05) sim.series.push({ t: Math.round(elapsed * 10000) / 10000, value: sim.probability });
  return changed;
}
/** The home side's chance from the margin and the time left (a normal model, a little home edge). */
function winChance(category: string, margin: number, elapsed: number, noise = 0): number {
  const sigma = { football: 13, basketball: 12, hockey: 1.7, soccer: 1.4 }[category] ?? 10;
  const remaining = Math.max(0, 1 - elapsed);
  const z = (margin + sigma * 0.06 * remaining) / (sigma * Math.sqrt(remaining) + sigma * 0.05);
  return Math.round(Math.min(0.99, Math.max(0.01, normal(z) + noise)) * 1000) / 1000;
}
function normal(z: number): number {
  // Abramowitz–Stegun erf.
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}
const jitter = () => (random() - 0.5) * 0.03;
/** A live game's probability so far, replayed from its period scores. */
function seedSeries(sim: Sim): void {
  const category = LEAGUES[sim.league]!.category;
  const rules = RULES[category];
  if (!rules) return;
  const now = progress(sim, rules);
  const series: V.LiveProbabilityPoint[] = [];
  const steps = 36;
  for (let n = 0; n <= steps; n++) {
    const t = now * n / steps;
    const at = t * rules.periods;
    const score = (side: 0 | 1) => sim.lines[side].reduce((total, points, period) => total + (period + 1 <= at ? points : period < at ? Math.round(points * (at - period)) : 0), 0);
    series.push({ t: Math.round(t * 10000) / 10000, value: winChance(category, score(1) - score(0), t, n && n < steps ? jitter() : 0) });
  }
  sim.series = series;
  sim.probability = series.at(-1)!.value;
}
const progress = (sim: Sim, rules: Rules) => {
  const total = rules.periods * rules.periodSeconds;
  const done = rules.countUp ? sim.clock : (Math.min(sim.period, rules.periods) - 1) * rules.periodSeconds + (rules.periodSeconds - sim.clock);
  return Math.max(0, Math.min(1, done / total));
};

// The live stream

interface Listener { viewerId: string; events: Set<string>; screens: Set<string>; alerts: boolean; send(name: string, data: unknown): void; close(): void }
const listeners = new Set<Listener>();
const wants = (listener: Listener, sim: Sim) => listener.events.has(sim.id) || listener.screens.size > 0;

function tick(): void {
  const changed: Sim[] = [];
  for (const sim of sims.values()) {
    const wasClose = sim.state === 'in' && LEAGUES[sim.league]!.category !== 'f1' && isClose(sim, RULES[LEAGUES[sim.league]!.category]!);
    const wasState = sim.state;
    if (!step(sim)) continue;
    sim.updatedAt = new Date().toISOString();
    changed.push(sim);
    const category = LEAGUES[sim.league]!.category;
    const close = sim.state === 'in' && category !== 'f1' && isClose(sim, RULES[category]!);
    if (close && !wasClose) alert('close', sim);
    if (sim.state === 'post' && wasState === 'in') alert('final', sim);
    if (sim.state === 'in' && wasState !== 'in') alert('started', sim);
  }
  if (!changed.length) return;
  for (const listener of listeners) {
    const events = changed.filter(sim => wants(listener, sim)).map(sim => presentEvent(sim, listener.viewerId));
    if (events.length) listener.send('update', { events } satisfies V.LiveStreamUpdate);
  }
}
let alerts = 0;
function alert(kind: V.LiveAlertKind, sim: Sim, force = false): void {
  for (const listener of listeners) {
    if (!listener.alerts) continue;
    const favourite = [sim.home, sim.away].find(id => favouritesOf(listener.viewerId).has(entityKey(id)));
    if (!favourite && !force) continue;
    if (spoilered(sim, listener.viewerId) && kind !== 'started') continue;
    const away = teamById(sim.away), home = teamById(sim.home);
    const score = `${away?.short ?? ''} ${sim.scores[0]}–${sim.scores[1]} ${home?.short ?? ''}`;
    const detail = statusOf(sim).detail;
    const title = { started: 'Starting now', close: 'Close game', final: 'Final' }[kind];
    const body = kind === 'started' ? `${away?.short} at ${home?.short} · ${LEAGUES[sim.league]!.name}` : `${score}, ${detail}`;
    listener.send('alert', { id: `alert-${++alerts}`, kind, eventId: sim.id, entityKey: entityKey(favourite ?? sim.home), title, body, at: new Date().toISOString() } satisfies V.LiveAlert);
  }
}

export function liveStream(req: Request, url: URL, viewerId: string, authorized: () => boolean): Response {
  const list = (name: string) => new Set((url.searchParams.get(name) ?? '').split(',').filter(Boolean));
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const encoder = new TextEncoder();
  const listener: Listener = {
    viewerId, events: list('events'), screens: list('screens'), alerts: url.searchParams.get('alerts') === '1',
    send(name, data) { try { controller?.enqueue(encoder.encode(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { listener.close(); } },
    close() { if (heartbeat) clearInterval(heartbeat); listeners.delete(listener); try { controller?.close(); } catch {} },
  };
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    controller = c;
    listeners.add(listener);
    // The current state of everything asked for, so nothing changed between the snapshot read and the connection is lost.
    const current = [...sims.values()].filter(sim => wants(listener, sim)).map(sim => presentEvent(sim, viewerId));
    if (current.length) listener.send('update', { events: current });
    heartbeat = setInterval(() => { if (!authorized()) listener.close(); else listener.send('heartbeat', {}); }, 25_000);
    req.signal.addEventListener('abort', () => listener.close(), { once: true });
  }, cancel: () => listener.close() });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

// Endpoints

type Fail = (cls: V.ProtocolError['class'], code: string, message: string, extra?: Partial<V.ProtocolError>, status?: number) => never;
const json = (data: unknown) => Response.json(data, { headers: { 'Cache-Control': 'no-store' } });
let lineup: V.Channel[] = [];

export function initSports(channels: V.Channel[]): void {
  lineup = channels;
  if (!sportsEnabled || sims.size) return;
  seedFixtures();
  setInterval(tick, tickMs);
}

/** The Sports routes under /vela/v0; undefined for any other path. */
export function sportsApi(req: Request, url: URL, method: string, path: string, viewerId: string, authorized: () => boolean, fail: Fail): Response | undefined {
  if (!sportsEnabled) return undefined;
  logoOrigin ||= url.origin;
  const screenMatch = /^\/screens\/([^/]+)$/.exec(path);
  if (method === 'GET' && screenMatch) {
    const value = screen(decodeURIComponent(screenMatch[1]!), viewerId, url.searchParams.get('league'), url.searchParams.get('date'));
    if (!value) fail('not-found', 'screen_not_found', 'Screen not found');
    return json(value);
  }
  if (method === 'GET' && path === '/live/events') {
    const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
    const events = [...sims.values()].filter(sim => !ids.length || ids.includes(sim.id)).map(sim => presentEvent(sim, viewerId));
    return json({ events } satisfies V.LiveEventsResponse);
  }
  const eventMatch = /^\/live\/events\/([^/]+)(\/reveal)?$/.exec(path);
  if (eventMatch) {
    const sim = sims.get(decodeURIComponent(eventMatch[1]!));
    if (!sim) fail('not-found', 'event_not_found', 'Live event not found');
    if (method === 'GET' && !eventMatch[2]) return json(presentDetail(sim, viewerId));
    if (method === 'POST' && eventMatch[2]) {
      let set = revealed.get(viewerId);
      if (!set) revealed.set(viewerId, set = new Set());
      set.add(sim.id);
      return json(presentDetail(sim, viewerId));
    }
  }
  if (method === 'GET' && path === '/live/stream') return liveStream(req, url, viewerId, authorized);
  if (method === 'GET' && path === '/live/ticker') {
    const events = [...sims.values()].filter(sim => sim.state === 'in' || sim.state === 'post' && now0 - sim.start < 30 * H || sim.state === 'pre' && sim.start - Date.now() < 6 * H)
      .sort(byInterest(viewerId)).map(sim => presentEvent(sim, viewerId));
    return json({ events } satisfies V.LiveEventsResponse);
  }
  if (method === 'GET' && path === '/live/entities') {
    const league = url.searchParams.get('league'), q = (url.searchParams.get('q') ?? '').toLowerCase();
    const entities = TEAMS.filter(t => (!league || t.league === league) && (!q || `${t.name} ${t.abbr}`.toLowerCase().includes(q))).map(t => entity(t, viewerId));
    return json({ entities } satisfies V.LiveEntitiesResponse);
  }
  const favouriteMatch = /^\/favorites\/entities\/([^/]+)$/.exec(path);
  if (favouriteMatch && (method === 'PUT' || method === 'DELETE')) {
    const key = decodeURIComponent(favouriteMatch[1]!);
    if (!TEAMS.some(t => entityKey(t.id) === key)) fail('not-found', 'entity_not_found', 'Entity not found');
    if (method === 'PUT') favouritesOf(viewerId).add(key); else favouritesOf(viewerId).delete(key);
    return json({ accepted: true });
  }
  return undefined;
}

/** The live event on air on a channel (A6), for the playback snapshot and session stream. */
export function liveEventOnChannel(channelId: string | undefined): V.LiveEventRef | null {
  if (!sportsEnabled || !channelId) return null;
  const index = lineup.findIndex(channel => channel.id === channelId);
  // The programme covers the game and its replay's pause after the final whistle.
  const airing = (sim: Sim) => sim.state === 'in' || sim.state === 'post' && sim.postedAt !== undefined;
  const sim = [...sims.values()].find(sim => airing(sim) && sim.channels[0] === index)
    ?? [...sims.values()].find(sim => airing(sim) && sim.channels.includes(index));
  return sim ? { id: sim.id, feed: FEED } : null;
}

/** Admin: change the knobs, or push an alert for an event to every alert listener. */
export function sportsAdmin(body: { providerCap?: number; spoilerFree?: boolean; alert?: { kind: V.LiveAlertKind; eventId: string } }): typeof sportsKnobs {
  if (Number.isFinite(body.providerCap) && body.providerCap! >= 0) sportsKnobs.providerCap = Math.floor(body.providerCap!);
  if (typeof body.spoilerFree === 'boolean') sportsKnobs.spoilerFree = body.spoilerFree;
  const sim = body.alert && sims.get(body.alert.eventId);
  if (sim && body.alert) alert(body.alert.kind, sim, true);
  return sportsKnobs;
}

/** A team crest for the mock's logos: the abbreviation on transparent, drawn over the team colour. */
export function sportsLogo(path: string): Response | undefined {
  const match = /^\/vela\/v0\/sports-mock\/logos\/([a-z0-9-]+)\.svg$/.exec(path);
  const t = match && teamById(match[1]!);
  if (!t) return undefined;
  const size = t.abbr.length > 2 ? 34 : 42;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="200" height="200"><circle cx="50" cy="50" r="46" fill="#${t.color}" stroke="#${t.altColor}" stroke-width="6"/><text x="50" y="50" dy=".35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="${size}" fill="#ffffff">${t.abbr}</text></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } });
}

// Multiview (spec B)

interface Group { owner: string; tiles: Map<number, { channelId: string; sessionId: string }> }
const groups = new Map<string, Group>();
export function createGroup(owner: string): V.MultiviewGroup {
  const groupId = crypto.randomUUID();
  groups.set(groupId, { owner, tiles: new Map() });
  return { groupId, maxTiles: 4 };
}
export function endGroup(owner: string, groupId: string, fail: Fail, stop: (sessionId: string) => void): void {
  const group = groups.get(groupId);
  if (!group || group.owner !== owner) fail('not-found', 'multiview_not_found', 'Multiview group not found');
  for (const tile of group.tiles.values()) stop(tile.sessionId);
  groups.delete(groupId);
}
/** Checks a tile request before its session starts. Every mock channel is one IPTV provider. */
export function admitTile(owner: string, tile: V.MultiviewTile, channelId: string | undefined, active: (sessionId: string) => boolean, fail: Fail): void {
  const group = groups.get(tile.groupId);
  if (!group || group.owner !== owner) fail('not-found', 'multiview_not_found', 'Multiview group not found');
  if (!channelId) fail('request', 'multiview_live_only', 'Multiview tiles play live channels');
  if (!Number.isInteger(tile.tile) || tile.tile < 0 || tile.tile > 3) fail('request', 'invalid_tile', 'Tile must be 0 to 3');
  if (tile.maxHeight !== undefined && (!Number.isInteger(tile.maxHeight) || tile.maxHeight <= 0)) fail('request', 'invalid_max_height', 'maxHeight must be a positive whole number of pixels');
  const cap = sportsKnobs.providerCap;
  if (!cap) return;
  // Tiles on the same channel share one upstream connection.
  const upstreams = new Set([...group.tiles].filter(([index, t]) => index !== tile.tile && active(t.sessionId)).map(([, t]) => t.channelId));
  if (!upstreams.has(channelId) && upstreams.size >= cap) {
    const details: V.ProviderCapDetails = { provider: 'Mock IPTV', max: cap, inUse: upstreams.size };
    fail('capacity', 'provider_connection_cap', `Mock IPTV allows ${cap} connections`, { details, retry: { allowed: false } }, 409);
  }
}
export function placeTile(tile: V.MultiviewTile, channelId: string, sessionId: string): void {
  groups.get(tile.groupId)?.tiles.set(tile.tile, { channelId, sessionId });
}
/** A tile's stream is capped at its declared height, as Ether does: renditions above it leave the plan
 * (the lowest always stays), so a 480 tile plays 360p and a full-screen 2160 one the whole ladder. */
export function capTileHeight(plan: V.PlaybackPlan, tile: V.MultiviewTile): void {
  if (tile.maxHeight === undefined) return;
  for (const path of plan.paths) {
    const kept = path.qualities.filter(quality => (quality.height ?? 0) <= tile.maxHeight!);
    const lowest = [...path.qualities].sort((a, b) => (a.height ?? 0) - (b.height ?? 0))[0];
    path.qualities = kept.length ? kept : lowest ? [lowest] : [];
  }
}
