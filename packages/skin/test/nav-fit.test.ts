// A navigation row kept to one line (`fit: 'nav'`): which destinations leave for More, the copy
// that measures the row, the bindings documents read, and the skins whose top bars use it.
import { describe, expect, test } from 'bun:test';
import { fitKey, measureCopy, navOverflow, sameOverflow, type FitItem } from '../src/nav-fit';
import { holds, resolveDocument, type RNode } from '../src/resolve';
import { accessor, type Env } from '../src/vocabulary';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import broadcast from '../../protocol/fixtures/skins/broadcast/document';
import jellytwin from '../../protocol/fixtures/skins/jellytwin/document';
import kids from '../../protocol/fixtures/skins/kids/document';
import latenight from '../../protocol/fixtures/skins/latenight/document';
import lounge from '../../protocol/fixtures/skins/lounge/document';
import mochi from '../../protocol/fixtures/skins/mochi/document';
import type { SkinDocument } from '../../protocol/skin';

// A row laid out from 6px padding with a 4px gap: Home, five libraries, More, Search.
function laidOut(widths: [string | null, number][], padding = 6, gap = 4): { items: FitItem[]; row: number } {
  let x = padding;
  const items = widths.map(([key, width]) => { const item = { key, x, width }; x += width + gap; return item; });
  return { items, row: x - gap + padding };
}
const bar = laidOut([['home', 80], ['movies', 90], ['shows', 100], ['world', 140], ['live', 80], ['books', 80], ['more', 90], [null, 110]]);

describe('navOverflow', () => {
  test('a row that fits without More keeps every destination', () => {
    const withoutMore = bar.row - 90 - 4;
    expect(navOverflow(withoutMore, bar.row, bar.items)).toEqual([]);
    expect(navOverflow(2000, bar.row, bar.items)).toEqual([]);
  });

  test('destinations leave from the end, last first, making room for More and Search', () => {
    // Home, Movies, Shows, More, Search: 6 + 80 + 90 + 100 + 90 + 110 + 4 gaps of 4 + 6 = 498.
    expect(navOverflow(498, bar.row, bar.items)).toEqual(['world', 'live', 'books']);
    expect(navOverflow(496, bar.row, bar.items)).toEqual(['shows', 'world', 'live', 'books']);
    // Just short of every destination without More: More (90) needs Books' and Live's room.
    expect(navOverflow(bar.row - 96, bar.row, bar.items)).toEqual(['live', 'books']);
  });

  test('sub-pixel layout does not push out a tab that fits', () => {
    expect(navOverflow(497.4, bar.row, bar.items)).toEqual(['world', 'live', 'books']);
  });

  test('Home always stays, however little room there is', () => {
    expect(navOverflow(10, bar.row, bar.items)).toEqual(['movies', 'shows', 'world', 'live', 'books']);
  });

  test('nothing measured or no room yet reports nothing out', () => {
    expect(navOverflow(500, 0, [])).toEqual([]);
    expect(navOverflow(0, bar.row, bar.items)).toEqual([]);
  });

  test('an item not laid out (display: none, reported at 0,0) is left out of the row', () => {
    const shown = laidOut([['home', 80], ['movies', 90], ['more', 60]]);
    const hidden = [{ key: 'tv', x: 0, width: 0 }, ...shown.items];
    expect(navOverflow(shown.row - 64, shown.row, hidden)).toEqual([]);
    expect(navOverflow(shown.row - 66, shown.row, hidden)).toEqual(['movies']);
  });

  test('answers compare by their keys in order', () => {
    expect(sameOverflow(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOverflow(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOverflow([], ['a'])).toBe(false);
  });
});

describe('the measuring copy', () => {
  const pill = (resolveDocument(lounge, 1440).shell! as RNode);
  const row = find(pill, node => node.kind === 'box' && node.fit === 'nav') as Extract<RNode, { kind: 'box' }>;

  test('lays the row out at natural width, always drawn, never named or pressed', () => {
    const copy = measureCopy({ ...row, base: { style: { ...row.base.style, flex: '1', width: '100%', 'overflow-x': 'auto', position: 'absolute' } } });
    expect(copy.fit).toBeUndefined();
    expect(copy.when).toEqual([]);
    expect(copy.press).toBeUndefined();
    expect(copy.id).toBeUndefined();
    expect(copy.base.style).toMatchObject({ 'flex-shrink': '0', display: 'flex', 'flex-direction': 'row' });
    for (const rowName of ['flex', 'width', 'max-width', 'overflow-x', 'position']) expect(copy.base.style[rowName]).toBeUndefined();
  });

  test('items are keyed by destination, More, or nothing', () => {
    const more = find(row, node => node.navMore === true)!;
    expect(fitKey(more, undefined)).toBe('more');
    expect(fitKey(row, { action: 'home', arg: '' })).toBe('home');
    expect(fitKey(row, { action: 'live', arg: '' })).toBe('live');
    expect(fitKey(row, { action: 'library', arg: 'books' })).toBe('books');
    // A library's slot is keyed by its library, even where it presses Live TV.
    expect(fitKey(row, { action: 'live', arg: '' }, 'tv-library')).toBe('tv-library');
    expect(fitKey(row, { action: 'search', arg: '' })).toBeNull();
  });
});

describe('the More bindings', () => {
  const libraries = [{ id: 'movies', name: 'Movies', kind: 'movies', backdrop: '' }, { id: 'tv', name: 'Live', kind: 'live', backdrop: '' }];
  const env = (extra: Partial<Env>) => ({ libraries, section: 'home', ...extra }) as Env;
  const read = (key: string, e: Env, dest = libraries[0]) => accessor(key)!({ index: 0, dest }, e);

  test('nothing is out until the row reports it', () => {
    expect(read('nav.more', env({}))).toBe('false');
    expect(read('dest.more', env({}))).toBe('false');
    expect(read('nav.moreOn', env({}))).toBe('false');
  });

  test('a library left out is in More, and More is current while it is on show', () => {
    expect(read('nav.more', env({ navOut: ['movies'] }))).toBe('true');
    expect(read('dest.more', env({ navOut: ['movies'] }))).toBe('true');
    expect(read('nav.moreOn', env({ navOut: ['movies'] }))).toBe('false');
    expect(read('nav.moreOn', env({ navOut: ['movies'], section: 'movies' }))).toBe('true');
    expect(read('nav.liveMore', env({ navOut: ['live'] }))).toBe('true');
    // A live library stands for Live TV.
    expect(read('nav.moreOn', env({ navOut: ['tv'], section: 'live' }))).toBe('true');
  });

  test('the measuring copy draws More and every destination', () => {
    const measuring = env({ navMeasuring: true, navOut: [] });
    expect(read('nav.more', measuring)).toBe('true');
    expect(read('dest.more', env({ navMeasuring: true, navOut: ['movies'] }))).toBe('false');
  });
});

function find(node: RNode, match: (node: RNode) => boolean): RNode | undefined {
  if (match(node)) return node;
  if (node.kind === 'box') for (const child of node.children) { const found = find(child, match); if (found) return found; }
  if (node.kind === 'repeat') return find(node.item, match);
  return undefined;
}
function all(node: RNode, match: (node: RNode) => boolean, out: RNode[] = []): RNode[] {
  if (match(node)) out.push(node);
  if (node.kind === 'box') for (const child of node.children) all(child, match, out);
  if (node.kind === 'repeat') all(node.item, match, out);
  return out;
}

// Every skin with a top bar of destinations keeps it to one line with a More menu at desktop and TV widths.
const bars: [string, SkinDocument][] = [['cinematic', cinematicDoc], ['lounge', lounge], ['kids', kids], ['mochi', mochi], ['latenight', latenight], ['broadcast', broadcast], ['jellytwin', jellytwin]];
describe.each(bars)('%s keeps its top bar to one line', (_, doc) => {
  test.each([1024, 1440, 1920])('at %ipx', width => {
    const shell = resolveDocument(doc, width).shell!;
    const rows = all(shell, node => node.kind === 'box' && node.fit === 'nav');
    expect(rows).toHaveLength(1);
    const row = rows[0] as Extract<RNode, { kind: 'box' }>;
    // The room is its parent's width, so the row never scrolls or clips.
    for (const rowName of ['overflow-x', 'overflow', 'mask-image', 'flex']) expect(row.base.style[rowName]).toBeUndefined();
    // Every library tab in the row can leave for More.
    const repeat = find(row, node => node.kind === 'repeat' && node.over === 'nav.destinations') as Extract<RNode, { kind: 'repeat' }>;
    const dest = { id: 'books', name: 'Books', kind: 'books', backdrop: '' };
    const env = (navOut: string[]) => ({ libraries: [dest], section: 'home', navOut, flags: [], canLive: true }) as unknown as Env;
    expect(holds(repeat.item.when, { index: 0, dest }, env([]))).toBe(true);
    expect(holds(repeat.item.when, { index: 0, dest }, env(['books']))).toBe(false);
    // More: one control in the row, opening a menu that Escape closes back onto it.
    const more = all(row, node => node.navMore === true);
    expect(more).toHaveLength(1);
    const trigger = find(more[0]!, node => node.kind === 'box' && node.press?.action === 'only' && node.press.arg === 'more') as Extract<RNode, { kind: 'box' }>;
    expect(trigger).toBeDefined();
    expect(trigger.a11y?.current).toHaveLength(1);
    expect(trigger.a11y?.expanded).toHaveLength(1);
    const menu = find(shell, node => node.escape?.includes('more') ?? false)!;
    expect(menu.returnFocus).toBe(trigger.id);
    expect(trigger.press!.focus).toBe(menu.id);
    expect(find(menu, node => node.kind === 'repeat' && node.over === 'nav.destinations')).toBeDefined();
  });
});
