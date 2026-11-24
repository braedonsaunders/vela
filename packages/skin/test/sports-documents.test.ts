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
const page = (sources: Record<string, unknown>, params: Record<string, string> = {}): ScreenPageState =>
  ({ href: 'h', key: 'k', params, sources, pending: {}, errors: {}, load: 'ready', rev: 1 });

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

describe('the Sports game document', () => {
  test('score band, where to watch, probability, tables and plays newest first', async () => {
    const t = await draw('game.json', 'data-game.json', 1440);
    expect(t.slice(0, 13)).toEqual(['LIVE', 'NFL · Lincoln Financial Field, Philadelphia', 'Close game',
      'New York Giants', '4-7', '24', '–', '27', 'Q4 · 2:14', 'Philadelphia Eagles', '9-2', 'Down', '3rd & 6']);
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

  test('a phone names the teams short', async () => {
    const t = await draw('game.json', 'data-game.json', 390);
    expect(t).toContain('Giants');
    expect(t).not.toContain('New York Giants');
  });
});
