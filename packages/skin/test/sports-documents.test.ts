// The Sports documents say what today's Sports screen says: drawn over the data samples (Ether's
// pinned view models), the texts each view shows, in order, are the legacy wording and choices.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { fill, holds, type RNode } from '../src/resolve';
import { resolveScreenDocument } from '../src/resolve/screen';
import { items, screenRoot } from '../src/screen/items';
import type { ScreenDocument } from '../../protocol/screen';
import type { ScreenPageState } from '../../core/src/screens/types';
import type { Ctx, Env } from '../src/vocabulary';

const dir = join(import.meta.dir, '../../protocol/fixtures/screens/sports');
const json = async <T>(file: string) => await Bun.file(join(dir, file)).json() as T;
interface Sample { sources: Record<string, unknown>; records: Record<string, { rev: number; value: unknown }> }

const envAt = (width: number): Env => ({ small: width < 640, wide: width >= 1200, tv: false, still: true, width, canMultiview: true } as unknown as Env);
const page = (sources: Record<string, unknown>, params: Record<string, string> = {}, errors: ScreenPageState['errors'] = {}): ScreenPageState =>
  ({ href: 'h', key: 'k', params, sources, pending: {}, errors, load: 'ready', rev: 1 });

/** Every text drawn (conditions held), depth first, with the testId of the nearest box above it. */
function texts(tree: RNode, at: Ctx, env: Env): string[] {
  const out: string[] = [];
  const visit = (n: RNode, c: Ctx) => {
    if (!holds(n.when, c, env)) return;
    const node = n as RNode & { children?: RNode[]; item?: RNode; after?: RNode[] };
    if (n.kind === 'text') out.push(fill(n.text, c, env));
    if ((n.kind === 'repeat' || n.kind === 'shelf') && node.item) for (const i of items(n as never, c, env)) visit(node.item, i);
    node.children?.forEach(child => visit(child, c));
    node.after?.forEach(child => visit(child, c));
  };
  visit(tree, at);
  return out;
}

async function draw(document: string, sample: string, width: number, params: Record<string, string> = {}) {
  const doc = await json<ScreenDocument>(document);
  const data = await json<Sample>(sample);
  const env = envAt(width);
  const r = resolveScreenDocument(doc, { width, tv: false }, 'en', {});
  expect(r.warnings).toEqual([]);
  return texts(r.tree, screenRoot(page(data.sources, params), key => data.records[key]), env);
}

describe('the Sports index document', () => {
  test('hero: eyebrow, score, status with the situation, probability and Watch, as today', async () => {
    const t = await draw('index.json', 'data-sample.json', 1440);
    const hero = t.slice(0, t.indexOf('Game details') + 1);
    expect(hero).toEqual(['LIVE', 'NFL · Your team', 'Close game', 'Giants', '24', '–', '27', 'Q4 · 2:14 · 3rd & 6 · NYG 38', 'Eagles',
      'Win probability · PHI 83%', 'Watch on Matchday · 107', 'Add to multiview', 'Game details']);
  });

  test('companion cards: the hero left out, league and clock, channel, then the sides', async () => {
    const t = await draw('index.json', 'data-sample.json', 1440);
    const after = t.slice(t.indexOf('Game details') + 1);
    expect(after.slice(0, 6)).toEqual(['LIVE', 'NHL · 2nd · 8:40', 'Vista Sports 1 · 129', 'Canadiens', '1', 'Maple Leafs']);
    // The F1 companion reads its leaders; an upcoming one its start and records.
    expect(after).toContain('Max Verstappen');
    expect(after).not.toContain('Giants at Eagles');
  });

  test('event cards: close game in the meta, the card line by phase, records before the start', async () => {
    const t = await draw('index.json', 'data-sample.json', 1440);
    const yours = t.slice(t.indexOf('Your teams'));
    expect(yours.slice(0, 9)).toEqual(['Your teams', 'LIVE', 'NFL · Q4 · 2:14', 'Close game', 'Giants', '24', 'Eagles', '27', 'Watch on Matchday · 107']);
    expect(yours).toContain('0-0');
    expect(yours).toContain('Vista Sports 1 · 129');
    expect(t).toContain('Box score and plays');
    expect(t).toContain('Schedule');
    expect(t).toContain('NFL standings');
    expect(t).toContain('Pick your teams');
  });

  test('a phone draws the same words', async () => {
    const desk = await draw('index.json', 'data-sample.json', 1440);
    const phone = await draw('index.json', 'data-sample.json', 390);
    expect(phone).toEqual(desk);
  });

  test('no favourites: the empty row explains how to follow teams', async () => {
    const data = await json<Sample>('data-sample.json');
    const doc = await json<ScreenDocument>('index.json');
    const sources = { ...data.sources, yours: { events: [] }, viewer: { ...(data.sources.viewer as object), favouriteCount: 0 } };
    const r = resolveScreenDocument(doc, { width: 1440, tv: false }, 'en', {});
    const t = texts(r.tree, screenRoot(page(sources), key => data.records[key]), envAt(1440));
    expect(t.slice(t.indexOf('Your teams'), t.indexOf('Your teams') + 2)).toEqual(['Your teams', 'Follow teams below and their games show up here.']);
  });
});

test('every navigate to the game page passes the event record key (a ref param)', async () => {
  const doc = await json<ScreenDocument>('index.json');
  const data = await json<Sample>('data-sample.json');
  const env = envAt(1440);
  const r = resolveScreenDocument(doc, { width: 1440, tv: false }, 'en', {});
  const events: string[] = [];
  const visit = (n: RNode, c: Ctx) => {
    if (!holds(n.when, c, env)) return;
    const node = n as RNode & { children?: RNode[]; item?: RNode; after?: RNode[]; press?: { action: string; args?: Record<string, unknown> } };
    if (node.press?.action === 'navigate' && node.press.args?.event) events.push(fill(node.press.args.event as never, c, env));
    if ((n.kind === 'repeat' || n.kind === 'shelf') && node.item) for (const i of items(n as never, c, env)) visit(node.item, i);
    node.children?.forEach(child => visit(child, c));
  };
  visit(r.tree, screenRoot(page(data.sources), key => data.records[key]));
  expect(events.length).toBeGreaterThan(5);
  expect(events.every(e => e.startsWith('event:org.ether.sports:sports:'))).toBe(true);
});

test('All leagues: a generic standings heading; a failed schedule says so instead of "no games"', async () => {
  const doc = await json<ScreenDocument>('index.json');
  const data = await json<Sample>('data-sample.json');
  const r = resolveScreenDocument(doc, { width: 1440, tv: false }, 'en', {});
  const standings = data.sources.standings as { league: object };
  const sources = { ...data.sources, standings: { ...standings, league: { id: '', name: '', label: '' } }, schedule: { date: '2026-11-24', days: [], events: [] } };
  const t = texts(r.tree, screenRoot(page(sources, {}, { schedule: { code: 'timeout', retry: true } } as never), key => data.records[key]), envAt(1440));
  expect(t).toContain('Standings');
  expect(t).not.toContain(' standings');
  expect(t).toContain('The schedule could not be loaded.');
  expect(t).not.toContain('No games on this day.');
  const quiet = texts(r.tree, screenRoot(page(sources), key => data.records[key]), envAt(1440));
  expect(quiet).toContain('No games on this day.');
});

describe('the Sports game document', () => {
  test('score band, where to watch, probability, tables and plays newest first', async () => {
    const t = await draw('game.json', 'data-game.json', 1440);
    expect(t.slice(0, 13)).toEqual(['LIVE', 'NFL · Lincoln Financial Field, Philadelphia', 'Close game',
      'New York Giants', '4-7', '24', '–', '27', 'Q4 · 2:14', 'Philadelphia Eagles', '9-2', 'Down', '3rd & 6']);
    // Possession comes from the side (sides[].possession), drawn last like legacy's third chip.
    expect(t.slice(t.indexOf('Ball'), t.indexOf('Ball') + 4)).toEqual(['Ball', 'NYG 38', 'Possession', 'PHI']);
    expect(t).toContain('Where to watch');
    expect(t).toContain('Watch on Matchday · 107');
    expect(t).toContain('Watch on Metro Sports 1 · 120');
    expect(t).toContain('On FOX');
    expect(t).not.toContain('Watch from start');
    const legend = t.slice(t.indexOf('Win probability') + 1, t.indexOf('Win probability') + 3);
    expect(legend).toEqual(['NYG 17%', 'PHI 83%']);
    const plays = t.slice(t.indexOf('Plays') + 1);
    expect(plays.slice(0, 2)).toEqual(['2:14', 'Barkley rush right for 7 yards']);
  });

  test("the game's own tables are not lit (legacy lights only standings)", async () => {
    const doc = await json<ScreenDocument>('game.json');
    const tables: RNode[] = [];
    const visit = (n: RNode) => {
      const node = n as RNode & { children?: RNode[]; item?: RNode };
      if (n.kind === 'table') tables.push(n);
      node.children?.forEach(visit);
      if (node.item) visit(node.item);
    };
    visit(resolveScreenDocument(doc, { width: 1440, tv: false }, 'en', {}).tree);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every(t => (t as RNode & { highlight?: boolean }).highlight === false)).toBe(true);
  });

  test('an upcoming game says when it starts under the clock', async () => {
    const data = await json<Sample>('data-game.json');
    const doc = await json<ScreenDocument>('game.json');
    const key = Object.keys(data.records).find(k => k.startsWith('event:'))!;
    const records = { ...data.records, [key]: { rev: 2, value: { ...(data.records[key]!.value as object), phase: 'upcoming', state: 'pre', scored: false, start: new Date(Date.now() + 3 * 3_600_000).toISOString() } } };
    const r = resolveScreenDocument(doc, { width: 390, tv: false }, 'en', {});
    const t = texts(r.tree, screenRoot(page(data.sources), k => records[k]), envAt(390));
    // The start is always three hours ahead of the clock, so the line may read "Starts Tomorrow 1:00 AM" near midnight.
    expect(t.some(x => /^Starts (Today |Tomorrow )?\d/.test(x))).toBe(true);
  });

  test('a phone names the teams short', async () => {
    const t = await draw('game.json', 'data-game.json', 390);
    expect(t).toContain('Giants');
    expect(t).not.toContain('New York Giants');
  });
});

describe('tabs pin', () => {
  test('an empty bound param takes the shown default once; nothing else is written', async () => {
    const { pinnedParamValue } = await import('../src/blocks/layout-math');
    const base = { pin: true, param: 'teamsLeague', paramValue: '', defaultValue: 'nfl', optionValues: ['nfl', 'nba'] };
    expect(pinnedParamValue(base)).toBe('nfl');
    expect(pinnedParamValue({ ...base, pin: false })).toBeUndefined();
    expect(pinnedParamValue({ ...base, paramValue: 'nba' })).toBeUndefined();
    expect(pinnedParamValue({ ...base, defaultValue: '' })).toBeUndefined();
    // A default that is not one of the shown options is not pinned (nothing is shown for it).
    expect(pinnedParamValue({ ...base, defaultValue: 'mlb' })).toBeUndefined();
    expect(pinnedParamValue({ ...base, param: undefined })).toBeUndefined();
  });

  test('the team picker pins its league; the schedule days do not', async () => {
    const doc = await json<ScreenDocument>('index.json');
    const tabs: (RNode & { pin?: boolean; bind: { param?: string } })[] = [];
    const visit = (n: RNode) => {
      const node = n as RNode & { children?: RNode[]; item?: RNode };
      if (n.kind === 'tabs') tabs.push(n as never);
      node.children?.forEach(visit);
      if (node.item) visit(node.item);
    };
    visit(resolveScreenDocument(doc, { width: 1440, tv: false }, 'en', {}).tree);
    const byParam = Object.fromEntries(tabs.map(t => [t.bind.param, t.pin === true]));
    expect(byParam).toEqual({ league: false, date: false, teamsLeague: true });
  });
});

describe('a long status line (Ether puts the last play in detail)', () => {
  test('the phone centre columns leave room for teams and give live status two lines', async () => {
    for (const [file, centre, twoLineCount] of [['index.json', 'sports-hero-centre', 2], ['game.json', 'sports-game-centre', 1]] as const) {
      const doc = await json<ScreenDocument>(file);
      let found: RNode | undefined;
      const visit = (n: RNode) => {
        const node = n as RNode & { children?: RNode[]; item?: RNode };
        if (n.testId && fill(n.testId, screenRoot(page({}), () => undefined), envAt(390)) === centre) found = n;
        node.children?.forEach(visit);
        if (node.item) visit(node.item);
      };
      visit(resolveScreenDocument(doc, { width: 390, tv: false }, 'en', {}).tree);
      expect(found).toBeDefined();
      const style = found!.base.style as Record<string, unknown>;
      const value = (k: string) => fill(style[k] as never, screenRoot(page({}), () => undefined), envAt(390));
      expect(value('max-width')).toBe('60%');
      expect(value('flex-shrink')).toBe('1');
      const texts: RNode[] = [];
      const collect = (n: RNode) => { const node = n as RNode & { children?: RNode[] }; if (n.kind === 'text') texts.push(n); node.children?.forEach(collect); };
      collect(found!);
      const clamp = (t: RNode) => fill((t.base.style as Record<string, unknown>)['line-clamp'] as never, screenRoot(page({}), () => undefined), envAt(390));
      expect(texts.filter(t => clamp(t) === '2')).toHaveLength(twoLineCount);
      expect(texts.filter(t => clamp(t) === '1').length).toBeGreaterThan(0);
      // The big score, dash, and spoiler label can take their natural sizes.
      expect(texts.filter(t => !['1', '2'].includes(clamp(t))).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('a long single-word team name (lab: "Tennessee", "Maryland" at 390 px)', () => {
  test('the phone hero and game band draw names on one line with an ellipsis, never broken inside the word', async () => {
    const sample = await json<Sample>('data-sample.json');
    const game = await json<Sample>('data-game.json');
    const longNames = (records: Sample['records']) => Object.fromEntries(Object.entries(records).map(([key, rec]) => {
      const value = rec.value as { sides?: { short: string; name: string }[] };
      if (!key.startsWith('event:') || !value.sides) return [key, rec];
      return [key, { ...rec, value: { ...value, sides: [{ ...value.sides[0]!, short: 'Tennessee', name: 'Tennessee' }, { ...value.sides[1]!, short: 'Maryland', name: 'Maryland' }] } }];
    }));
    for (const [file, data] of [['index.json', sample], ['game.json', game]] as const) {
      const doc = await json<ScreenDocument>(file);
      const records = longNames(data.records);
      const env = envAt(390);
      const r = resolveScreenDocument(doc, { width: 390, tv: false }, 'en', {});
      const names: RNode[] = [];
      const visit = (n: RNode, c: Ctx) => {
        if (!holds(n.when, c, env)) return;
        const node = n as RNode & { children?: RNode[]; item?: RNode };
        if (n.kind === 'text' && ['Tennessee', 'Maryland'].includes(fill(n.text, c, env))) names.push(n);
        if ((n.kind === 'repeat' || n.kind === 'shelf') && node.item) for (const i of items(n as never, c, env)) visit(node.item, i);
        node.children?.forEach(child => visit(child, c));
      };
      visit(r.tree, screenRoot(page(data.sources), key => records[key]));
      expect(names.length).toBeGreaterThan(1);
      for (const n of names) {
        const style = n.base.style as Record<string, unknown>;
        const value = (k: string) => fill(style[k] as never, screenRoot(page({}), () => undefined), env);
        expect(value('line-clamp')).toBe('1');
        expect(value('text-overflow')).toBe('ellipsis');
      }
    }
  });
});
