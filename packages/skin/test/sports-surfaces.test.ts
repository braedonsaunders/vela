// Sports' surface documents say what today's overlays say (widgets/live-overlay): the score bug
// live, behind live (the score as of the picture from timed plays, hidden for untimed ones), under
// spoilers and for a field; the ticker's items; the alert toast's Watch or "On this channel now".
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fill, holds, type RNode } from '../src/resolve';
import { resolveScreenDocument } from '../src/resolve/screen';
import { items, screenRoot } from '../src/screen/items';
import type { ScreenDocument, SurfaceContext } from '../../protocol/screen';
import type { ScreenPageState } from '../../core/src/screens/types';
import type { Ctx, Env } from '../src/vocabulary';

const dir = join(import.meta.dir, '../../protocol/fixtures/screens/sports/surfaces');
const env = { small: false, wide: true, tv: false, still: true, width: 1440, canMultiview: true } as unknown as Env;

function texts(tree: RNode, at: Ctx): string[] {
  const out: string[] = [];
  const visit = (n: RNode, c: Ctx) => {
    if (!holds(n.when, c, env)) return;
    const node = n as RNode & { children?: RNode[]; item?: RNode };
    if (n.kind === 'text') out.push(fill(n.text, c, env));
    if ((n.kind === 'repeat' || n.kind === 'marquee') && node.item) for (const i of items(n as never, c, env)) visit(node.item, i);
    node.children?.forEach(child => visit(child, c));
  };
  visit(tree, at);
  return out;
}

async function draw(name: string, sources: Record<string, unknown>, records: Record<string, unknown>, context: SurfaceContext = {}) {
  const doc = await Bun.file(join(dir, `${name}.json`)).json() as ScreenDocument;
  const r = resolveScreenDocument(doc, { width: 1440 }, 'en', {});
  expect(r.warnings).toEqual([]);
  const page: ScreenPageState = { href: 'h', key: 'k', params: {}, sources, pending: {}, errors: {}, load: 'ready', rev: 1, context };
  return texts(r.tree, screenRoot(page, key => (key in records ? { rev: 1, value: records[key] } : undefined)));
}

const side = (abbr: string, score: string, extra: Record<string, unknown> = {}) =>
  ({ id: `nfl-${abbr.toLowerCase()}`, name: abbr, short: abbr, abbr, color: '#123456', score, winner: false, loser: false, possession: false, ...extra });
const nfl = (extra: Record<string, unknown> = {}) => ({
  id: 'sports:nfl', feed: 'sports', phase: 'live', state: 'in', detail: 'Q4 · 2:14', spoiler: false, scored: true,
  league: { id: 'nfl', name: 'NFL', label: 'NFL' }, sides: [side('NYG', '24', { possession: true }), side('PHI', '27')],
  situation: [{ label: 'Down', value: '3rd & 6' }, { label: 'Ball', value: 'NYG 38' }], watch: { targets: [], airing: [] }, ...extra,
});
const timed = { plays: [
  { clock: '9:00', period: 1, text: 'TD', at: '2026-11-24T19:00:00.000Z', score: {}, scores: ['7', '0'] },
  { clock: '2:30', period: 3, text: 'FG', at: '2026-11-24T19:40:00.000Z', score: {}, scores: ['17', '20'] },
], playsNewest: [{ at: '2026-11-24T19:40:00.000Z' }] };
const untimed = { plays: [{ clock: '9:00', period: 1, text: 'TD' }], playsNewest: [{ clock: '9:00', period: 1, text: 'TD' }] };
const game = { game: { event: { $record: 'event:sports:nfl' }, detail: { $record: 'detail:sports:nfl' } } };
const records = (event: unknown, detail: unknown = timed) => ({ 'event:sports:nfl': event, 'detail:sports:nfl': detail });

describe('the score bug', () => {
  test('live: sides, the score, the status and the situation, as today', async () => {
    expect(await draw('scorebug', game, records(nfl()), { chrome: false })).toEqual(['NYG', '24', '–', '27', 'PHI', 'Q4 · 2:14', 'Down', '3rd & 6', 'Ball', 'NYG 38']);
  });

  test('behind live with timed plays: the score and clock of the last play on screen, still live', async () => {
    const at = (time: string): SurfaceContext => ({ delayed: true, pictureTime: time });
    expect(await draw('scorebug', game, records(nfl({ state: 'post', phase: 'final', detail: 'Final' })), at('2026-11-24T19:45:00.000Z')))
      .toEqual(['NYG', '17', '–', '20', 'PHI', 'P3 · 2:30']);
    expect(await draw('scorebug', game, records(nfl()), at('2026-11-24T19:10:00.000Z'))).toEqual(['NYG', '7', '–', '0', 'PHI', 'P1 · 9:00']);
    expect(await draw('scorebug', game, records(nfl()), at('2026-11-24T18:00:00.000Z'))).toEqual(['NYG', '0', '–', '0', 'PHI']);
  });

  test('behind live with untimed plays: scores withheld, and why', async () => {
    expect(await draw('scorebug', game, records(nfl(), untimed), { delayed: true, pictureTime: '2026-11-24T19:45:00.000Z' }))
      .toEqual(['NYG', 'vs', 'PHI', 'Live', 'Scores hidden while behind live']);
  });

  test('a spoiler-free viewer: no scores, Live, and Reveal', async () => {
    const hidden = nfl({ spoiler: true, scored: false, situation: [], sides: [side('NYG', ''), side('PHI', '')] });
    expect(await draw('scorebug', game, records(hidden))).toEqual(['NYG', 'vs', 'PHI', 'Live', 'Scores hidden', 'Reveal']);
  });

  test('before the start: "@" and the start; a held game says why', async () => {
    const pre = nfl({ state: 'pre', phase: 'upcoming', detail: '7:30 PM', scored: false, situation: [], sides: [side('NYG', ''), side('PHI', '')] });
    expect(await draw('scorebug', game, records(pre))).toEqual(['NYG', '@', 'PHI', '7:30 PM']);
    expect(await draw('scorebug', game, records({ ...pre, state: 'postponed', detail: '' }))).toEqual(['NYG', 'vs', 'PHI', 'Postponed']);
  });

  test('a field: its name, the lap and the leader', async () => {
    const race = { id: 'sports:f1', feed: 'sports', phase: 'live', state: 'in', detail: 'Lap 31/50', spoiler: false, scored: false, title: 'Las Vegas Grand Prix',
      league: { id: 'f1', name: 'Formula 1', label: 'F1' }, situation: [], ranking: [{ place: '1', pos: 1, name: 'Verstappen', abbr: 'VER' }] };
    expect(await draw('scorebug', game, records(race, untimed))).toEqual(['F1 · Las Vegas Grand Prix', 'Lap 31/50', 'VER P1']);
  });
});

describe('the ticker', () => {
  test('each game: its tag, league, sides and scores, then a status that does not repeat the tag', async () => {
    const final = { ...nfl({ state: 'post', phase: 'final', detail: 'Final' }), id: 'sports:nba', league: { label: 'NBA' } };
    const sources = { live: { events: [{ $record: 'event:sports:nfl' }, { $record: 'event:sports:nba' }] } };
    expect(await draw('ticker', sources, { 'event:sports:nfl': nfl(), 'event:sports:nba': final }))
      .toEqual(['Scores', 'Live', 'NFL', 'NYG', '24', 'PHI', '27', 'Q4 · 2:14', 'Final', 'NBA', 'NYG', '24', 'PHI', '27']);
    expect(await draw('ticker', sources, { 'event:sports:nfl': nfl(), 'event:sports:nba': final }, { event: 'event:sports:nfl' }))
      .toEqual(['Scores', 'Final', 'NBA', 'NYG', '24', 'PHI', '27']);
    expect(await draw('ticker', { live: { events: [] } }, {})).toEqual(['Scores', 'No games on right now']);
  });
});

describe('the alert toast', () => {
  const alert = { id: 'a', kind: 'close', title: 'Close game', body: 'Giants 24–27 Eagles', at: '', ref: 'event:sports:nfl' };
  const watching = nfl({ watch: { targets: [], airing: [], primary: { channelId: 'channel-7', name: 'Matchday', number: '107' } } });
  test('Watch where a channel carries the game, and Multiview over a channel', async () => {
    expect(await draw('alert', game, records(watching), { alert })).toEqual(['Close game', '✕', 'Giants 24–27 Eagles', 'Watch · Matchday · 107']);
    expect(await draw('alert', game, records(watching), { alert, channel: 'channel:channel-9' }))
      .toEqual(['Close game', '✕', 'Giants 24–27 Eagles', 'Watch · Matchday · 107', 'Multiview']);
  });
  test('the game on the channel playing: "On this channel now"', async () => {
    expect(await draw('alert', game, records(watching), { alert, channel: 'channel:channel-7' })).toEqual(['Close game', '✕', 'Giants 24–27 Eagles', 'On this channel now']);
  });
});
