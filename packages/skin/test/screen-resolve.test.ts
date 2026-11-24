// Screen documents resolved for the renderer (docs/plugin-screens.md): refusals, the colour rule,
// tokens, templates and the kit with their arguments, viewport variants, blocks and collections.
import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RENDERER_VERSION, fill, holds, type RNode } from '../src/resolve';
import { checkScreenDocument, heldColours, resolveScreenDocument } from '../src/resolve/screen';
import { fold, styleHole } from '../src/resolve/screen-style';
import { itemKey, items, screenRoot } from '../src/screen/items';
import type { ScreenDocument } from '../../protocol/screen';
import type { Node } from '../../protocol/skin';
import type { ScreenPageState } from '../../core/src/screens/types';
import type { Ctx, Env } from '../src/vocabulary';

const env = { small: false, tv: false, still: false, width: 1440 } as Env;
const doc = (tree: Node, extra: Partial<ScreenDocument> = {}): ScreenDocument =>
  ({ schema: 1, kind: 'screen', renderer: 19, screen: 'probe', page: 'index', version: '1', title: 'Probe', presentation: 'section', sources: {}, tree, ...extra });
const resolve = (d: ScreenDocument, width = 1440, tv = false) => resolveScreenDocument(d, { width, tv }, 'en', {});
const page = (sources: Record<string, unknown>, extra: Partial<ScreenPageState> = {}): ScreenPageState =>
  ({ href: 'h', key: 'k', params: {}, sources, pending: {}, errors: {}, load: 'ready', rev: 1, ...extra });
const records: Record<string, { rev: number; value: unknown }> = {
  'event:a': { rev: 1, value: { id: 'a', title: 'A at B', score: '3', at: '2026-11-24T20:00:00Z' } },
  'event:b': { rev: 1, value: { id: 'b', title: 'C at D', score: '1', at: '2026-11-24T20:10:00Z' } },
  'event:c': { rev: 1, value: { id: 'c', title: 'E at F', score: '0', at: '2026-11-24T20:20:00Z' } },
};
const root = (sources: Record<string, unknown>, extra: Partial<ScreenPageState> = {}): Ctx => screenRoot(page(sources, extra), key => records[key]);
const box = (n: RNode) => n as Extract<RNode, { kind: 'box' }>;
const textOf = (n: RNode, c: Ctx) => fill((n as Extract<RNode, { kind: 'text' }>).text, c, env);
const style = (n: RNode, row: string, c: Ctx = root({})) => fill(n.base.style[row], c, env);

describe('refusals', () => {
  test('a document over this renderer is refused on its version, never half-drawn', () => {
    expect(() => resolve(doc({ type: 'box' }, { renderer: RENDERER_VERSION + 1 }))).toThrow(`needs renderer ${RENDERER_VERSION + 1}`);
    expect(() => resolve(doc({ type: 'box' }, { renderer: 18 }))).toThrow('renderer 19 or more');
  });
  test('a required block or kit name this client lacks refuses the document', () => {
    expect(() => resolve(doc({ type: 'box' }, { requires: ['lineGraph', 'vela:switch'] }))).not.toThrow();
    expect(() => resolve(doc({ type: 'box' }, { requires: ['hologram'] }))).toThrow('needs hologram');
  });
  test('limits: palette, strings, bytes, depth and nodes', () => {
    const palette = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`c${i}`, '#123456']));
    expect(() => resolve(doc({ type: 'box' }, { palette }))).toThrow('palette colours');
    expect(() => resolve(doc({ type: 'box' }, { palette: { a: 'nope' } }))).toThrow('not a colour');
    expect(() => resolve(doc({ type: 'text', text: 'x'.repeat(4097) }))).toThrow('a string of 4097');
    expect(() => checkScreenDocument(doc({ type: 'box' }, { strings: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`k${i}`, 'x'.repeat(4000)])) }))).toThrow('bytes');
    let deep: Node = { type: 'box' };
    for (let i = 0; i < 40; i++) deep = { type: 'box', children: [deep] };
    expect(() => resolve(doc(deep))).toThrow('nests at most 32');
    expect(() => resolve(doc({ type: 'box', children: Array.from({ length: 4001 }, () => ({ type: 'box' }) as Node) }))).toThrow('at most 4000 nodes');
  });
  test('envelope: schema, kind and a tree', () => {
    expect(() => resolve({ ...doc({ type: 'box' }), schema: 2 } as unknown as ScreenDocument)).toThrow('schema 2');
    expect(() => resolve({ ...doc({ type: 'box' }), kind: 'skin' } as unknown as ScreenDocument)).toThrow('Not a screen document');
  });
});

describe('colours and tokens', () => {
  test('literal colours: white and black at any opacity, transparent, the palette and $ui; anything else is transparent with a warning', () => {
    const warned: string[] = [];
    expect(heldColours('1px solid #ff0000', c => warned.push(c))).toBe('1px solid transparent');
    expect(heldColours('#ffffffd1', c => warned.push(c))).toBe('#ffffffd1');
    expect(heldColours('rgba(0, 0, 0, 0.4) red', c => warned.push(c))).toBe('rgba(0, 0, 0, 0.4) transparent');
    expect(heldColours('linear-gradient(110deg, {e|tint}, $ui.page) solid white', c => warned.push(c))).toBe('linear-gradient(110deg, {e|tint}, $ui.page) solid white');
    expect(warned).toEqual(['#ff0000', 'red']);
    const r = resolve(doc({ type: 'box', style: { color: '#ff0000', 'background-color': '$palette.onTeam', 'border-color': '#000000' } }, { palette: { onTeam: '#ffd7dc' } }));
    expect(style(r.tree, 'color')).toBe('transparent');
    expect(style(r.tree, 'background-color')).toBe('#ffd7dc');
    expect(style(r.tree, 'border-color')).toBe('#000000');
    expect(r.warnings.length).toBe(1);
  });
  test('tokens fold min(), max() and color-mix() over $ui and numbers; vw stays for drawing', () => {
    const r = resolve(doc({ type: 'box', style: { 'border-radius': '$radiusPanel', padding: '0 $gutter', 'background-color': '$card', 'border-color': '$hairline' } }, {
      tokens: { radiusPanel: 'min($ui.radiusPanel * 0.6, 22px)', gutter: 'max(28px, 4vw)', card: 'color-mix(in srgb, $ui.page 8%, $ui.raised 92%)', hairline: 'color-mix(in srgb, $ui.ink 8%, transparent)' },
    }));
    // 28 x 0.6 = 16.8 lands on a half point, as look.px rounded it.
    expect(style(r.tree, 'border-radius')).toBe('17px');
    expect(style(r.tree, 'padding')).toBe('0 max(28px, 4vw)');
    expect(style(r.tree, 'background-color')).toMatch(/^#[0-9a-f]{8}$/);
    expect(style(r.tree, 'border-color')).toBe('#f5f1e914');
    expect(() => resolve(doc({ type: 'box' }, { tokens: { x: '$other' } }))).toThrow('reads only $ui');
    expect(fold('max(1.5px, calc(52px * 0.05)) solid')).toBe('2.6px solid');
    expect(fold('min(14px, 18px) max(28px, 4vw)')).toBe('14px max(28px, 4vw)');
  });
  test('a hole in a style is validated once filled, and a bound color-mix folds when drawn', () => {
    expect(styleHole('width', '18')).toBe('18');
    expect(styleHole('background-color', 'url(x)')).toBe('transparent');
    expect(styleHole('width', 'calc(1px); x: y')).toBe('0');
    const r = resolve(doc({ type: 'box', style: { width: '{src.p.away|percent}%', 'background-color': 'color-mix(in srgb, {src.p.color} 50%, transparent)', color: '{src.p.evil}' } }));
    const c = root({ p: { away: 0.18, color: '#ff0000', evil: 'red;background:url(x)' } });
    expect(style(r.tree, 'width', c)).toBe('18%');
    expect(style(r.tree, 'background-color', c)).toBe('#ff000080');
    expect(style(r.tree, 'color', c)).toBe('transparent');
  });
  test('document keyframes animate color to a $ui token; motion presets carry their frames', () => {
    const r = resolve(doc({ type: 'text', text: '{src.s}', onChange: { value: '{src.s}', motion: 'flash' } }, {
      keyframes: { pop: { '0%': { scale: 1 }, '12%': { scale: 1.16, color: '$ui.accent' }, '100%': { scale: 1 } } },
      motion: { flash: { keyframes: 'doc:pop', duration: 1360, still: { keyframes: 'none', duration: 0 } } },
    }));
    expect(r.tree.onChange?.motion.frames?.['doc:pop']?.['12%']).toEqual({ transform: [{ scale: 1.16 }], color: '#dcb998' });
    expect(fill(r.tree.onChange!.value, root({ s: '4' }), env)).toBe('4');
    expect(() => resolve(doc({ type: 'box' }, { keyframes: { x: { '0%': { color: '#ff0000' } } } }))).toThrow('$ui token');
  });
});

describe('templates, the kit and variants', () => {
  test('with is read as {arg.*}: literal, a single hole kept as its value, and text', () => {
    const r = resolve(doc({ type: 'use', template: 'line', with: { label: 'Score', side: '{src.e.sides.0}', note: 'n:{src.e.n}' } }, {
      templates: { line: { type: 'box', children: [
        { type: 'text', text: '{arg.label} {arg.side.name} {arg.note} [{arg.missing}]' },
        { type: 'box', style: { 'background-color': '{arg.side|crest}' } },
      ] } },
    }));
    const c = root({ e: { n: 7, sides: [{ name: 'Leafs', color: '#00205b' }] } });
    expect(textOf(box(r.tree).children[0]!, c)).toBe('Score Leafs n:7 []');
    expect(style(box(r.tree).children[1]!, 'background-color', c)).toBe('#00205b');
  });
  test('a with value naming a token resolves as that token in a style', () => {
    const r = resolve(doc({ type: 'use', template: 'dot', with: { ink: '$ui.ink', gap: '$gap' } }, { tokens: { gap: '6px' },
      templates: { dot: { type: 'box', style: { color: '{arg.ink}', gap: '{arg.gap}' } } } }));
    expect(style(r.tree, 'color')).toBe('#f5f1e9');
    expect(style(r.tree, 'gap')).toBe('6px');
  });
  test("a caller's own fields keep reading the caller's arguments inside the template", () => {
    const r = resolve(doc({ type: 'use', template: 'outer', with: { prefix: 'fav' } }, {
      templates: {
        outer: { type: 'use', template: 'inner', testId: 'card-{arg.prefix}', with: { label: '{arg.prefix}!' } },
        inner: { type: 'text', text: '{arg.label}/{arg.prefix}' },
      },
    }));
    const c = root({});
    expect(fill(r.tree.testId, c, env)).toBe('card-fav');
    expect(textOf(r.tree, c)).toBe('fav!/');
  });
  test("children draw at the template's children slot; the use's style merges over the template's", () => {
    const r = resolve(doc({ type: 'use', template: 'vela:panel', style: { margin: '0 4px' }, children: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }));
    const panel = box(r.tree);
    expect(panel.children.map(child => textOf(child, root({})))).toEqual(['one', 'two']);
    expect(style(panel, 'padding')).toBe('18px');
    expect(style(panel, 'margin')).toBe('0 4px');
    expect(panel.readingStop).toBeUndefined();
    expect(box(resolve(doc({ type: 'use', template: 'vela:panel', with: { focusable: 'true' } })).tree).readingStop).toBe(true);
    const bound = box(resolve(doc({ type: 'use', template: 'vela:panel', with: { focusable: '{src.rows|count|lt:11}' } })).tree);
    expect(holds(bound.readingStopWhen, root({ rows: [1, 2] }), env)).toBe(true);
    expect(holds(bound.readingStopWhen, root({ rows: Array.from({ length: 12 }) }), env)).toBe(false);
  });
  test('every kit template resolves; pill draws primary from its argument; a press on the use lands on its root', () => {
    for (const name of ['vela:pill', 'vela:chip', 'vela:tab', 'vela:heading', 'vela:panel', 'vela:crest', 'vela:liveBadge', 'vela:switch', 'vela:placeholder', 'vela:failure']) {
      expect(() => resolve(doc({ type: 'use', template: name, with: { label: 'x', size: '24px', width: '10px', height: '10px' } }))).not.toThrow();
    }
    const pill = box(resolve(doc({ type: 'use', template: 'vela:pill', with: { label: '{src.l}', glyph: 'play-fill', primary: '{src.p}' },
      press: { action: 'play', args: { channel: '{src.ch}' } } })).tree);
    const c = root({ l: 'Watch', p: true, ch: 'ch-1' });
    expect(fill(pill.label, c, env)).toBe('Watch');
    expect(pill.states.findIndex(s => holds(s.when, c, env))).toBe(1); // primary, not small
    expect(fill(pill.press!.args!.channel, c, env)).toBe('ch-1');
    // A whole-hole argument keeps its raw value for typed plugin actions; text stays text.
    const fav = box(resolve(doc({ type: 'box', press: { action: 'plugin', args: { name: 'ether.favorite', on: '{src.f|not}', ref: 'x-{src.k}' },
      optimistic: { source: 'viewer', path: 'f', value: '{src.f|not}' } } })).tree);
    const fc = root({ f: true, k: 'a' });
    expect(fav.press!.argValues!.on!(fc, env)).toBe(false);
    expect(fav.press!.argValues!.ref).toBeUndefined();
    expect(fav.press!.optimistic!.raw!(fc, env)).toBe(false);
    expect((pill.children[0] as Extract<RNode, { kind: 'icon' }>).symbol).toBe('play-fill');
    // An unknown kit template draws nothing, with a warning; an unknown document template refuses.
    expect(resolve(doc({ type: 'use', template: 'vela:hologram' })).warnings[0]).toContain('vela:hologram');
    expect(() => resolve(doc({ type: 'use', template: 'nope' }))).toThrow('Unknown template nope');
  });
  test('the crest draws its initials as the image fallback', () => {
    const crest = box(resolve(doc({ type: 'use', template: 'vela:crest', with: { logo: '{src.logo}', abbr: 'TOR', color: '{src.c}', size: '52px', ring: 'true' } })).tree);
    const image = crest.children[0] as Extract<RNode, { kind: 'image' }>;
    expect(image.kind).toBe('image');
    expect(textOf(box(image.fallback!).children[0]!, root({}))).toBe('TOR');
    expect(style(crest, 'width')).toBe('52px');
    expect(style(crest, 'border', root({ c: '#00205b' }))).toBe('2.6px solid #00205b');
  });
  test('viewport variants: small, wide, then tv last; per-class block values pick the class', () => {
    const node: Node = { type: 'box', style: { width: '1px' }, small: { width: '2px' }, wide: { width: '3px' }, tv: { width: '4px' } };
    expect(style(resolve(doc(node), 390).tree, 'width')).toBe('2px');
    expect(style(resolve(doc(node), 1000).tree, 'width')).toBe('1px');
    expect(style(resolve(doc(node), 1440).tree, 'width')).toBe('3px');
    expect(style(resolve(doc(node), 1920, true).tree, 'width')).toBe('4px');
    const shelf: Node = { type: 'shelf', over: 'src.x', as: 'e', item: { type: 'box' }, itemWidth: { default: '286px', small: 'min(272px, 74vw)', tv: '300px' } };
    expect((resolve(doc(shelf), 390).tree as Extract<RNode, { kind: 'shelf' }>).itemWidth).toBe('min(272px, 74vw)');
    expect((resolve(doc(shelf), 1920, true).tree as Extract<RNode, { kind: 'shelf' }>).itemWidth).toBe('300px');
    expect((resolve(doc(shelf), 1440).tree as Extract<RNode, { kind: 'shelf' }>).itemWidth).toBe('286px');
  });
});

describe('collections', () => {
  const sources = { list: { events: [{ $record: 'event:a' }, { $record: 'event:b' }, { $record: 'event:c' }] } };
  const repeat = (extra: Record<string, unknown>) => resolve(doc({ type: 'repeat', over: 'src.list.events', as: 'g', item: { type: 'text', text: '{g.title}#{$index}' }, ...extra } as Node)).tree as Extract<RNode, { kind: 'repeat' }>;
  const drawn = (node: Extract<RNode, { kind: 'repeat' }>, c = root(sources)) => items(node, c, env).map(i => textOf(node.item, i));
  test('as binds each item by name, following its record; skip, exclude and limit apply in that order', () => {
    expect(drawn(repeat({}))).toEqual(['A at B#0', 'C at D#1', 'E at F#2']);
    expect(drawn(repeat({ skip: 1 }))).toEqual(['C at D#0', 'E at F#1']);
    expect(drawn(repeat({ exclude: '{src.list.events.0.$key}', limit: 1 }))).toEqual(['C at D#0']);
  });
  test('key: a template or a bare path, else the record key', () => {
    const keyed = repeat({ key: 'id' });
    expect(items(keyed, root(sources), env).map(i => itemKey(keyed, i, env))).toEqual(['a', 'b', 'c']);
    const plain = repeat({});
    expect(items(plain, root(sources), env).map(i => itemKey(plain, i, env))).toEqual(['event:a', 'event:b', 'event:c']);
  });
  test('asOf keeps items at or before the picture time, newest last, a limit keeping the newest; untimed items are the live state', () => {
    const timed = repeat({ asOf: { at: 'g.at', time: '{context.pictureTime}' }, limit: 1 });
    expect(drawn(timed, root(sources, { context: { pictureTime: '2026-11-24T20:15:00Z' } }))).toEqual(['C at D#0']);
    expect(drawn(timed, root(sources, { context: {} }))).toEqual(['E at F#0']);
    const all = repeat({ asOf: { at: 'at', time: '{context.pictureTime}' } });
    expect(drawn(all, root({ list: { events: [{ title: 'x' }, { title: 'y' }] } }, { context: { pictureTime: '2026-11-24T19:00:00Z' } }))).toEqual(['x#0', 'y#1']);
  });
  test("the app's skin rewrites never touch a screen: an alias named row keeps its text", () => {
    const r = resolve(doc({ type: 'repeat', over: 'src.rows', as: 'row', item: { type: 'text', text: '{row.name}' } })).tree as Extract<RNode, { kind: 'repeat' }>;
    expect(r.item.kind).toBe('text');
    expect(items(r, root({ rows: [{ name: 'Verstappen' }] }), env).map(i => textOf(r.item, i))).toEqual(['Verstappen']);
  });
  test('a condition may be written as a hole', () => {
    const r = resolve(doc({ type: 'text', text: 'x', when: [{ test: '{src.on}' }] }));
    expect(holds(r.tree.when, root({ on: true }), env)).toBe(true);
    expect(holds(r.tree.when, root({ on: false }), env)).toBe(false);
  });
  test('an alias may not shadow a binding root', () => {
    expect(() => repeat({ as: 'src' })).toThrow('binding root');
  });
  test('tabs: the chip is a box drawn per option, reading {$tab.*}; label and testId belong to the chip', () => {
    const tabs = resolve(doc({ type: 'tabs', over: 'src.leagues', as: 'l', value: '{l.id}', label: '{l.label}', bind: { param: 'league', clear: ['x'] },
      all: 'All', testId: 'league-{l.id}', chip: 'vela:chip', size: 'small' })).tree as Extract<RNode, { kind: 'tabs' }>;
    expect(tabs.chip.kind).toBe('box');
    expect(tabs.bind).toEqual({ param: 'league', clear: ['x'] });
    expect(tabs.small).toBe(true);
    expect(tabs.testId).toBeUndefined();
    const c = root({ leagues: [{ id: 'nfl', label: 'NFL' }] });
    const option = items({ over: '', limit: 1000, items: tabs.items }, c, env)[0]!;
    expect(fill(tabs.label, option, env)).toBe('NFL');
    expect(fill(tabs.chip.testId, option, env)).toBe('league-nfl');
    expect(() => resolve(doc({ type: 'tabs', over: 'src.x', as: 'l', value: '', label: '', bind: {} }))).toThrow('exactly one');
    const after = resolve(doc({ type: 'tabs', over: 'src.x', as: 'l', value: '{l.id}', label: '{l.id}', bind: { state: 'tab' },
      after: [{ type: 'text', text: '{src.note}' }] })).tree as Extract<RNode, { kind: 'tabs' }>;
    expect(after.after?.map(n => textOf(n, root({ note: 'Hide scores' })))).toEqual(['Hide scores']);
    expect(after.bind).toEqual({ state: 'tab' });
  });
  test('blocks resolve their fields: table and lineGraph read raw values', () => {
    const r = resolve(doc({ type: 'sections', gap: '30px', children: [
      { type: 'table', data: 'src.t', compact: true },
      { type: 'lineGraph', series: 'src.s', sides: 'src.sides', live: '{src.live|eq:live}', height: { default: '132px', small: '96px' } },
      { type: 'player', channel: '{src.ch}' },
    ] }));
    const sections = r.tree as Extract<RNode, { kind: 'sections' }>;
    expect(sections.gap).toBe('30px');
    const c = root({ t: { title: 'T', rows: [] }, s: [0.5, 0.6], live: 'live', ch: 'channel:1' });
    const [table, graph, player] = sections.children as [Extract<RNode, { kind: 'table' }>, Extract<RNode, { kind: 'lineGraph' }>, Extract<RNode, { kind: 'player' }>];
    expect(table.data(c, env)).toEqual({ title: 'T', rows: [] });
    expect(graph.series(c, env)).toEqual([0.5, 0.6]);
    expect(fill(graph.live, c, env)).toBe('true');
    expect(graph.height).toBe('132px');
    expect(fill(player.channel, c, env)).toBe('channel:1');
  });
});

describe('fixtures', () => {
  const dir = join(import.meta.dir, '../../protocol/fixtures/screens');
  const files = readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())
    .flatMap(d => readdirSync(join(dir, d.name)).filter(f => f.endsWith('.json') && !f.startsWith('data')).map(f => join(d.name, f)));
  test.each(files)('%s resolves on a phone, a desktop and a TV without warnings', async file => {
    const fixture = await Bun.file(join(dir, file)).json() as ScreenDocument;
    for (const [width, tv] of [[390, false], [1440, false], [1920, true]] as const) {
      const r = resolveScreenDocument(fixture, { width, tv }, 'en', {});
      expect(r.warnings).toEqual([]);
    }
  });
  test('the Sports index draws the data sample: the hero card from the record pool', async () => {
    const index = await Bun.file(join(dir, 'sports/index.json')).json() as ScreenDocument;
    const sample = await Bun.file(join(dir, 'sports/data-sample.json')).json() as { sources: Record<string, unknown>; records: Record<string, { rev: number; value: unknown }> };
    const r = resolveScreenDocument(index, { width: 1440 }, 'en', {});
    const c = screenRoot(page(sample.sources), key => sample.records[key]);
    const texts: string[] = [];
    const visit = (n: RNode, at: Ctx) => {
      if (!holds(n.when, at, env)) return;
      if (n.kind === 'text') texts.push(fill(n.text, at, env));
      if (n.kind === 'repeat') for (const i of items(n, at, env)) visit(n.item, i);
      if (n.kind === 'box' || n.kind === 'sections') n.children.forEach(child => visit(child, at));
    };
    visit(r.tree, c);
    expect(texts).toContain('Canadiens');
    expect(texts.some(t => /^Watch on .+ · \d+$/.test(t))).toBe(true);
  });
});

describe('half points', () => {
  test('a unitless line height beside a px font size draws as px(size x line), on half points everywhere', async () => {
    const { lineHeightPoints } = await import('../src/resolve/screen-style');
    expect(lineHeightPoints('11.5px', '1.25')).toBe('14.5px');
    expect(lineHeightPoints('12.5px', '1.25')).toBe('15.5px');
    expect(lineHeightPoints('52px', '1.12')).toBe('58px');
    expect(lineHeightPoints('16px', '1.12')).toBe('18px');
    expect(lineHeightPoints('{src.x}', '1.25')).toBeUndefined();
    expect(lineHeightPoints('14px', '18px')).toBeUndefined();
    const r = resolve(doc({ type: 'text', text: 'x', style: { 'font-size': '13.5px', 'line-height': '1.25', 'letter-spacing': '0.8px' } }));
    expect(style(r.tree, 'line-height')).toBe('17px');
    expect(style(r.tree, 'letter-spacing')).toBe('1px');
  });

  test('with a scale, each px length lands on half points once scaled (look.px)', async () => {
    const { halfPoints } = await import('../src/resolve/screen-style');
    expect(halfPoints('13px 0 2.5px 0.8px 11.25px', 1)).toBe('13px 0 2.5px 1px 11.5px');
    // 13 x 1.25 = 16.25 -> 16.5 points -> 13.2px.
    expect(halfPoints('13px 0 2.5px', 1.25)).toBe('13.2px 0 2.4px');
    expect(halfPoints('#13pxx a-13px', 1.25)).toBe('#13pxx a-13px');
    const r = resolveScreenDocument(doc({ type: 'box', style: { padding: '13px', width: '{src.w}' } }), { width: 1920, tv: true, scale: 1.25 }, 'en', {});
    expect(fill(r.tree.base.style.padding, root({}), env)).toBe('13.2px');
  });
});

describe('budgets', () => {
  test("a block's items cost as a repeat's; a repeat of at most one item costs as the page", async () => {
    const { treesReport } = await import('../../../tools/skin-budget');
    const card: Node = { type: 'box', children: Array.from({ length: 30 }, () => ({ type: 'text', text: 'x' }) as Node) };
    const shelf = resolve(doc({ type: 'shelf', over: 'src.x', as: 'e', item: card }));
    expect(treesReport([['tree', shelf.tree]]).pages[0]!.perItem).toBe(31);
    const hero = resolve(doc({ type: 'repeat', over: 'src.x', as: 'e', limit: 1, item: card }));
    expect(treesReport([['tree', hero.tree]]).pages[0]).toMatchObject({ perItem: 0, nodes: 32 });
  });
});
