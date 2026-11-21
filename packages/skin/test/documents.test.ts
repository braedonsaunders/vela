// Every built-in skin document (packages/protocol/fixtures/skins) resolves at a phone, desktop
// and TV width within its budgets, draws the same on every platform, names only icons the
// renderer can draw, and stays within this client's renderer version: the checks
// `bun tools/skin.ts check` reports, as assertions.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RENDERER_VERSION, resolveDocument, type ResolvedDocument, type RNode } from '../src/resolve';
import { portabilityReport } from '../src/resolve/portability';
import { SYMBOLS } from '../src/icons';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import type { SkinDocument } from '../../protocol/skin';
import { perfReport } from '../../../tools/skin-budget';

const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const folders = readdirSync(fixtures, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(fixtures, entry.name, 'document.ts')))
  .map(entry => entry.name)
  .sort();
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const folder of folders) documents.push([folder, (await import(join(fixtures, folder, 'document.ts'))).default as SkinDocument]);

const WIDTHS = [390, 1440, 1920];

function symbols(resolved: ResolvedDocument): string[] {
  const found = new Set<string>();
  const walk = (node: RNode) => {
    if (node.kind === 'icon' && node.symbol && !node.paths) found.add(node.symbol);
    if (node.kind === 'box') node.children.forEach(walk);
    if (node.kind === 'repeat') walk(node.item);
  };
  if (resolved.shell) walk(resolved.shell);
  for (const tree of Object.values(resolved.routes)) if (tree) walk(tree);
  return [...found];
}

test('the built-in documents are found', () => {
  expect(folders.length).toBeGreaterThanOrEqual(8);
  const ids = documents.map(([, doc]) => doc.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('every built-in person route reuses its title close and library card', () => {
  const walk = (node: RNode, predicate: (node: RNode) => boolean): boolean => predicate(node)
    || node.kind === 'box' && node.children.some(child => walk(child, predicate))
    || node.kind === 'repeat' && walk(node.item, predicate);
  for (const [, doc] of documents) {
    const resolved = resolveDocument(doc, 1920, 'en');
    const person = resolved.routes.person!;
    expect(person).toBeDefined();
    expect(walk(person, n => n.kind === 'box' && n.press?.action === 'back')).toBe(true);
    expect(walk(person, n => n.kind === 'repeat' && n.over === 'personPage.movies')).toBe(true);
    expect(walk(person, n => n.kind === 'box' && n.press?.action === 'select')).toBe(true);
  }
});

test('cast has a focus target only when its adapter can open the person', async () => {
  const { holds } = await import('../src/resolve');
  const findCast = (node: RNode): RNode | undefined => {
    if (node.kind === 'repeat' && node.over === 'detail.cast') return node.item;
    if (node.kind === 'repeat') return findCast(node.item);
    if (node.kind === 'box') for (const child of node.children) { const found = findCast(child); if (found) return found; }
    return undefined;
  };
  for (const [, doc] of documents) {
    const tile = findCast(resolveDocument(doc, 1920).routes.title!);
    expect(tile).toBeDefined();
    const count = (node: RNode, canOpen: boolean): number => {
      const context = { index: 0, person: { name: 'Mara', role: '', portrait: '', canOpen } };
      if (!holds(node.when, context, {} as never)) return 0;
      return (node.kind === 'box' && node.press?.action === 'person' ? 1 : 0)
        + (node.kind === 'box' ? node.children.reduce((sum, child) => sum + count(child, canOpen), 0) : 0);
    };
    expect(count(tile!, false)).toBe(0);
    expect(count(tile!, true)).toBe(1);
  }
});

test('Mochi has one navigation set across the compact breakpoint and selected states', async () => {
  const { fill, holds } = await import('../src/resolve');
  const { collection } = await import('../src/vocabulary');
  type Env = import('../src/vocabulary').Env;
  type Ctx = import('../src/vocabulary').Ctx;
  const doc = documents.find(([name]) => name === 'mochi')![1];
  for (const width of [390, 719, 720, 1280]) for (const section of ['home', 'live', 'movies']) {
    const env = { width, small: width < 640, section, viewer: 'Demo', canLive: true, still: true, flags: [],
      libraries: [{ id: 'movies', name: 'Movies', kind: 'movies', backdrop: '' }, { id: 'live', name: 'Live TV', kind: 'live', backdrop: '' }],
    } as unknown as Env;
    const names: string[] = [];
    const walk = (node: RNode, ctx: Ctx) => {
      if (!holds(node.when, ctx, env)) return;
      const layer = node.states.find(state => holds(state.when, ctx, env))?.layer ?? node.base;
      if (fill(layer.style.display, ctx, env) === 'none') return;
      if (node.kind === 'box') {
        if (node.press && node.label) names.push(fill(node.label, ctx, env));
        node.children.forEach(child => walk(child, ctx));
      } else if (node.kind === 'repeat') collection(node.over, ctx, env, node.limit).forEach(item => walk(node.item, item));
    };
    walk(resolveDocument(doc, width, 'en').shell!, { index: 0 });
    for (const name of ['Home', 'Movies', 'Live TV']) expect(names.filter(item => item === name)).toHaveLength(1);
  }
});

describe.each(documents)('built-in skin %s', (_folder, doc) => {
  test('is a schema-1 document with a valid id and version', () => {
    expect(doc.schema).toBe(1);
    expect(doc.id).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
    expect(doc.version).toMatch(/^[0-9A-Za-z.+-]+$/);
    expect(doc.renderer).toBeLessThanOrEqual(RENDERER_VERSION);
  });

  test.each(WIDTHS)('resolves at %ipx within its budgets', width => {
    const resolved = resolveDocument(doc, width, 'en');
    expect(resolved.id).toBe(doc.id);
    expect(Object.keys(resolved.routes).length).toBeGreaterThan(0);
    const failures = perfReport(resolved).findings.filter(f => f.level === 'error');
    expect(failures).toEqual([]);
  });

  test('draws the same on every platform', () => {
    expect(portabilityReport(doc).filter(f => f.level === 'error')).toEqual([]);
  });

  test('names only icons the renderer can draw', () => {
    const missing = symbols(resolveDocument(doc, 1440, 'en')).filter(symbol => !SYMBOLS[symbol]);
    expect(missing).toEqual([]);
  });

  test('a copy that needs a newer renderer is refused on its version', () => {
    expect(() => resolveDocument({ ...doc, renderer: RENDERER_VERSION + 1,
      routes: { title: { type: 'use', template: 'unbuilt-future-part' } },
    }, 1440)).toThrow(`needs renderer ${RENDERER_VERSION + 1}`);
  });
});

describe('portability checker', () => {
  const page = (style: Record<string, string>, extra: Record<string, unknown> = {}) =>
    ({ schema: 1, id: 'probe', name: 'Probe', version: '1', renderer: 1, routes: { home: { type: 'box', children: [{ type: 'box', style, ...extra }] } } }) as unknown as SkinDocument;
  const errors = (doc: SkinDocument) => portabilityReport(doc).filter(f => f.level === 'error').map(f => f.row);

  test('refuses rows native cannot draw', () => {
    expect(errors(page({ 'position': 'fixed' }))).toEqual(['position']);
    expect(errors(page({ 'display': 'inline-block' }))).toEqual(['display']);
    expect(errors(page({ 'text-shadow': '0 1px red, 0 2px blue' }))).toEqual(['text-shadow']);
    expect(errors(page({ '-webkit-text-stroke': '1px red' }))).toEqual(['-webkit-text-stroke']);
    expect(errors(page({ 'grid-area': 'a' }))).toEqual(['grid-area']);
    expect(errors(page({ 'mask-image': 'url(a.png)' }))).toEqual(['mask-image']);
  });

  test('passes and approximates portable rows', () => {
    const report = portabilityReport(page({ 'display': 'grid', 'text-shadow': '0 1px rgba(0, 0, 0, 0.5)', 'filter': 'blur(2px)' }));
    expect(report.every(f => f.level === 'warning')).toBe(true);
    expect(report.map(f => f.row).sort()).toEqual(['display', 'filter']);
  });

  test('sticky pins only a direct child of a page root or a vertical scroll box', () => {
    expect(errors(page({ position: 'sticky' }))).toEqual([]);
    const nested = { schema: 1, id: 'probe', name: 'Probe', version: '1', renderer: 1, routes: { home: { type: 'box', children: [
      { type: 'box', children: [{ type: 'box', style: { position: 'sticky' } }] },
      { type: 'box', style: { 'overflow-y': 'auto' }, children: [{ type: 'box', style: { position: 'sticky' } }] },
    ] } } } as unknown as SkinDocument;
    expect(portabilityReport(nested).filter(f => f.level === 'error').map(f => f.at)).toEqual(['routes.home.children[0].children[0].style']);
  });

  test('checks state, hover and width-keyed styles', () => {
    const doc = page({}, { hover: { position: 'fixed' }, below: { 600: { display: 'table' } }, states: [{ style: { 'box-sizing': 'content-box' } }] });
    expect(errors(doc).sort()).toEqual(['box-sizing', 'display', 'position']);
  });
});

test('inherited library reserves header space only for overlay navigation', async () => {
  const { overlayHeaderOffset, withBase } = await import('../src/resolve/inherit');
  const { velaBase } = await import('../src/resolve/base');
  const broadcast = documents.find(([name]) => name === 'broadcast')![1];
  const lateNight = documents.find(([name]) => name === 'latenight')![1];
  const kids = documents.find(([name]) => name === 'kids')![1];
  const topPadding = (doc: SkinDocument) => {
    const route = withBase(doc, velaBase).routes!.library!;
    if (route.type !== 'box' || route.children?.[3]?.type !== 'box') throw new Error('missing toolbar');
    return [route.children[3].style?.['padding-top'], route.children[3].small?.['padding-top']];
  };
  expect(topPadding(broadcast)).toEqual(['0px', '0px']);
  expect(topPadding(lateNight)).toEqual(['calc(56px + env(safe-area-inset-top))', 'calc(56px + env(safe-area-inset-top))']);
  expect(overlayHeaderOffset(kids.slots?.shell)).toEqual({ wide: '100px', small: '68px' });
  expect(topPadding(kids)).toEqual(['100px', '68px']);
});

test('live library tabs use the catalogue grid without an empty alternative-view spacer', async () => {
  const { holds, resolveDocument } = await import('../src/resolve');
  const { velaBase } = await import('../src/resolve/base');
  const route = resolveDocument(velaBase, 1440).routes.library!;
  const find = (node: RNode): RNode | undefined => node.id === 'vela-library-alternative' ? node
    : node.kind === 'box' ? node.children.map(find).find(Boolean)
    : node.kind === 'repeat' ? find(node.item) : undefined;
  const alternative = find(route);
  expect(alternative).toBeDefined();
  const env = { load: 'ready', library: { view: 'live' } } as unknown as import('../src/vocabulary').Env;
  expect(holds(alternative?.when, { index: 0 }, env)).toBe(false);
});

test('a custom library route inherits the shared view switch and alternative views', async () => {
  const { withBase } = await import('../src/resolve/inherit');
  const { velaBase } = await import('../src/resolve/base');
  const own = documents.find(([name]) => name === 'index')![1];
  const custom = { ...own, routes: { ...own.routes, library: { type: 'box' as const, children: [] } } };
  const route = withBase(custom, velaBase).routes!.library!;
  expect(route.type).toBe('box');
  if (route.type !== 'box') throw new Error('expected library frame');
  expect(route.children?.slice(0, 2)).toEqual([
    { type: 'use', template: 'velaLibraryViews' },
    { type: 'use', template: 'velaLibraryAlternative' },
  ]);
  expect(route.children?.[2]?.when).toEqual([{ test: 'library.view', is: 'eq', value: 'library' }]);
});

test('every detail header is field-driven for movies, episodes and plugin media, with or without logos', async () => {
  const { detailModel } = await import('../../core/src/discovery/models');
  const { fill, holds } = await import('../src/resolve');
  const { collection } = await import('../src/vocabulary');
  type Env = import('../src/vocabulary').Env;
  type Ctx = import('../src/vocabulary').Ctx;
  type Title = import('../../core/src/wire').Title;
  for (const kind of ['movie', 'episode', 'plugin-audiobook']) {
    for (const logo of [false, true]) {
      for (const context of [false, true]) {
        const name = `${kind} title`;
        const data: Title = { id: 'probe', kind: kind as Title['kind'], name, summary: '', genres: [],
          ...(context ? { showId: 'show', seasonId: 'season', showName: 'A series', seasonNumber: 2, episodeNumber: 3 } : {}),
          artwork: logo ? [{ id: 'logo', kind: 'logo', tag: '', sizes: [{ width: 500, height: 120, url: 'https://media.example/logo.svg' }] }] : [],
        };
        const model = detailModel({ title: data, extras: [], chapters: [], cast: [] });
        expect(model.title[0]?.name).toBe(name);
        expect(model.title[0]?.logo).toBe(logo ? 'https://media.example/logo.svg' : '');
        expect(model.title[0]?.episodeContext).toBe(context ? 'A series · Season 2, Episode 3' : '');
        for (const [, doc] of documents) for (const width of [390, 1440]) {
          const resolved = resolveDocument(doc, width, 'en');
          const env = { detail: model, load: 'ready', route: 'title', entry: 'probe', small: width < 640, tv: false, still: true, flags: [], season: '' } as unknown as Env;
          const headings: RNode[] = [], contexts: string[] = [];
          const walk = (n: RNode, c: Ctx) => {
            if (!holds(n.when, c, env)) return;
            if (n.role === 'heading' && n.level === 1 && ((n.kind === 'text' && fill(n.text, c, env) === name) || (n.kind === 'image' && fill(n.alt, c, env) === name))) headings.push(n);
            if (n.kind === 'box' && n.role === 'link' && n.press) contexts.push(fill(n.press.arg, c, env));
            if (n.kind === 'box') n.children.forEach(child => walk(child, c));
            if (n.kind === 'repeat') collection(n.over, c, env, n.limit).forEach(item => walk(n.item, item));
          };
          walk(resolved.routes.title!, { index: 0 });
          expect(headings.length).toBeGreaterThan(0);
          expect(contexts.length > 0).toBe(context);
          if (context) expect(contexts).toEqual(expect.arrayContaining(['show|', 'season|season||show', 'probe|']));
          for (const heading of headings) if (heading.kind === 'image') {
            const css = Object.fromEntries(Object.entries(heading.base.style).map(([k, v]) => [k, fill(v, { index: 0 }, env)]));
            expect(css.width).toBeDefined();
            expect(css.width).not.toBe('auto');
            expect(css.width).not.toBe('0px');
          }
        }
      }
    }
  }
});

test('every skin receives only the selected season episodes from the shared collection', async () => {
  const { collection, accessor } = await import('../src/vocabulary');
  const { detailModel } = await import('../../core/src/discovery/models');
  type Env = import('../src/vocabulary').Env;
  const base = { name: 'Show', summary: '', genres: [], artwork: [] };
  const detail = detailModel({ title: { ...base, id: 'show', kind: 'show' },
    seasons: ['s1','s2'].map(id => ({ ...base, id, kind: 'season' })),
    episodes: ['s1','s2'].flatMap(seasonId => [1,2].map(n => ({ ...base, id: `${seasonId}-${n}`, kind: 'episode', seasonId }))), extras: [], chapters: [], cast: [],
  });
  for (const [, doc] of documents) {
    // All built-in detail lists use the same resolved collection contract.
    const readsEpisodes = (node: RNode): boolean => node.kind === 'repeat'
      ? node.over === 'detail.episodes' || readsEpisodes(node.item)
      : node.kind === 'box' && node.children.some(readsEpisodes);
    expect(readsEpisodes(resolveDocument(doc, 1440).routes.title!)).toBe(true);
    for (const season of ['', 's1', 's2', 'another-show-season']) {
      const env = { detail, season } as Env;
      expect(collection('detail.episodes', { index: 0 }, env, 100).map(c => c.card!.id)).toEqual(season === 's2' ? ['s2-1','s2-2'] : ['s1-1','s1-2']);
      expect(accessor('season.on')!({ index: 0, card: detail.seasons[season === 's2' ? 1 : 0] }, env)).toBe('true');
    }
  }
});

describe('the brand mark', () => {
  const brands = (node: RNode | undefined): number => !node ? 0
    : node.kind === 'box' ? (node.brand ? 1 : 0) + node.children.reduce((n, child) => n + brands(child), 0)
    : node.kind === 'repeat' ? brands(node.item) : 0;
  // A logo that presses home is a pointer shortcut, never a keyboard or TV focus stop.
  test.each(documents)('%s marks a logo that presses home as the brand', (_name, doc) => {
    const shell = resolveDocument(doc, 1920, 'en').shell;
    // A skin's own shell labels a pressable logo Vela home (Index's masthead is text and presses
    // nothing); a skin without its own shell inherits the base's, which has one.
    const hasLogo = doc.slots?.shell ? /velaHome\}/.test(JSON.stringify(doc.slots.shell)) : true;
    expect(brands(shell) > 0).toBe(hasLogo);
  });
});

test('every built-in title synopsis uses the shared expandable part at every width', () => {
  for (const [, doc] of documents) for (const width of WIDTHS) {
    const summaries: Extract<RNode, { kind: 'text' }>[] = [];
    const walk = (node: RNode) => {
      if (node.kind === 'text' && node.summary) summaries.push(node);
      if (node.kind === 'box') node.children.forEach(walk);
      if (node.kind === 'repeat') walk(node.item);
    };
    walk(resolveDocument(doc, width, 'en').routes.title!);
    expect(summaries.length).toBeGreaterThan(0);
    for (const summary of summaries) expect(Number(summary.base.style['line-clamp'])).toBeGreaterThan(0);
  }
});

test('legacy summary bindings expand too, and shared parts retain caller typography and states', () => {
  const doc: SkinDocument = { schema: 1, renderer: 16, id: 'synopsis', name: 'Synopsis', version: '1', swatches: [], routes: {
    title: { type: 'box', children: [
      { type: 'text', text: '{detail.summary}' },
      { type: 'use', template: 'velaSummary', style: { 'font-size': '20px' }, small: { 'font-size': '14px' },
        above: { '1800': { 'font-size': '28px' } }, states: [{ when: [{ test: 'env.tv' }], style: { 'line-clamp': '4' } }] },
    ] },
  } };
  expect(resolveDocument({ ...doc, renderer: 15, routes: { title: { type: 'text', text: '{detail.summary}' } } }, 1440).routes.title)
    .toMatchObject({ kind: 'text', summary: true });
  for (const [width, font] of [[390, '14px'], [1440, '20px'], [1920, '28px']] as const) {
    const tree = resolveDocument(doc, width, 'en').routes.title!;
    if (tree.kind !== 'box') throw new Error('Expected synopsis container');
    expect(tree.children[0]).toMatchObject({ kind: 'text', summary: true });
    expect(tree.children[1]).toMatchObject({ kind: 'text', summary: true, base: { style: { 'font-size': font, 'line-clamp': '3' } } });
    expect(tree.children[1]!.states[0]!.layer.style['line-clamp']).toBe('4');
  }
});

test('every skin has one full-row play target per episode and no separate up-next panel', () => {
  for (const [, doc] of documents) {
    const title = resolveDocument(doc, 1920, 'en').routes.title;
    let episodes = 0;
    const presses = (n: RNode): number => (n.kind === 'box' ? (n.press ? 1 : 0) + n.children.reduce((sum, c) => sum + presses(c), 0) : n.kind === 'repeat' ? presses(n.item) : 0);
    const walk = (n: RNode) => {
      if (n.kind === 'repeat') {
        expect(n.over).not.toBe('detail.upNext');
        if (n.over === 'detail.episodes') {
          episodes++;
          expect(n.item.kind).toBe('box');
          if (n.item.kind === 'box') {
            expect(n.item.press?.action).toBe('play');
            expect(n.item.motion).toBeUndefined();
            expect(presses(n.item), doc.id).toBe(1);
            expect(n.item.base.style.width).toBe('100%');
            expect(n.item.base.style['padding-left']).toBe('16px');
            expect(n.item.base.style['padding-right']).toBe('16px');
            expect(n.item.base.focus).toBeDefined();
          }
        }
        walk(n.item);
      } else if (n.kind === 'box') n.children.forEach(walk);
    };
    if (title) walk(title);
    expect(episodes).toBeGreaterThan(0);
  }
});

test('the shared shell offers Live TV on a library page without a live library', async () => {
  const { holds } = await import('../src/resolve');
  type Env = import('../src/vocabulary').Env;
  const shell = resolveDocument(cinematicDoc, 1920).shell!;
  const live: RNode[] = [];
  const walk = (node: RNode) => {
    if (node.kind === 'box') {
      if (node.press?.action === 'live') live.push(node);
      node.children.forEach(walk);
    } else if (node.kind === 'repeat') walk(node.item);
  };
  walk(shell);
  expect(live.length).toBeGreaterThan(0);
  const env = (canLive: boolean, libraries: { kind: string }[], navOut: string[] = []) => ({ canLive, libraries, navOut }) as unknown as Env;
  for (const node of live) {
    // In the bar, or in its More menu while the bar has no room for it.
    const movies = [{ kind: 'movies' }, { kind: 'shows' }];
    expect(holds(node.when, { index: 0 }, env(true, movies)) || holds(node.when, { index: 0 }, env(true, movies, ['live']))).toBe(true);
    expect(holds(node.when, { index: 0 }, env(false, []))).toBe(false);
    expect(holds(node.when, { index: 0 }, env(true, [{ kind: 'live' }]))).toBe(false);
  }
});

test('every skin provides library tabs, facets and card shapes at phone, desktop and TV widths', async () => {
  const { fill, holds } = await import('../src/resolve');
  const { libraryCardRatio } = await import('../../core/src/library-presentation');
  const walk = (node: RNode, visit: (node: RNode) => void) => {
    visit(node);
    if (node.kind === 'box') node.children.forEach(child => walk(child, visit));
    if (node.kind === 'repeat') walk(node.item, visit);
  };
  for (const [name, doc] of documents) for (const width of WIDTHS) {
    const tree = resolveDocument(doc, width).routes.library!;
    const widgets: string[] = [];
    let shapes = 0;
    walk(tree, node => {
      if (node.kind === 'widget') widgets.push(node.widget);
      if (!node.states.some(state => state.when.some(test => test.value === 'landscape'))) return;
      for (const card of ['landscape', 'square'] as const) {
        const env = { library: { model: { presentation: { card } } } } as any;
        const style = Object.assign({}, node.base.style, ...node.states.filter(s => holds(s.when, { index: 0 }, env)).map(s => s.layer.style));
        if (style['aspect-ratio']) {
          expect(fill(style['aspect-ratio'], { index: 0 }, env), `${name} ${width} ${card}`).toBe(libraryCardRatio(card));
          shapes++;
        }
      }
    });
    expect(widgets.filter(widget => widget === 'libraryToolbar'), name).toHaveLength(1);
    expect(shapes, `${name} ${width}`).toBeGreaterThan(0);
  }
});

test('library identity precedes shared search and facets in every skin', async () => {
  const { fill } = await import('../src/resolve');
  for (const [name, doc] of documents) for (const width of WIDTHS) {
    const sequence: string[] = [];
    const env = { library: { model: { name: 'Library identity' } } } as any;
    const visit = (node: RNode) => {
      if (node.kind === 'widget' && node.widget === 'libraryToolbar') sequence.push('filters');
      if (node.kind === 'text' && node.role === 'heading' && fill(node.text, { index: 0 }, env) === 'Library identity') sequence.push('header');
      if (node.kind === 'box') node.children.forEach(visit);
    };
    visit(resolveDocument(doc, width).routes.library!);
    expect(sequence.indexOf('header'), `${name} ${width}`).toBeGreaterThanOrEqual(0);
    expect(sequence.indexOf('header'), `${name} ${width}`).toBeLessThan(sequence.indexOf('filters'));
  }
});

test('every skin includes a focusable people grid and shared continuation at phone and TV widths', () => {
  const find = (node: RNode, predicate: (node: RNode) => boolean): RNode | undefined => {
    if (predicate(node)) return node;
    if (node.kind === 'box') for (const child of node.children) { const found = find(child, predicate); if (found) return found; }
    if (node.kind === 'repeat') return find(node.item, predicate);
    return undefined;
  };
  for (const [, doc] of documents) for (const width of [390, 1920]) {
    const library = resolveDocument(doc, width).routes.library!;
    const people = find(library, n => n.kind === 'repeat' && n.over === 'library.people');
    expect(people).toBeDefined();
    expect(find(people!, n => n.kind === 'box' && n.press?.action === 'select')).toBeDefined();
    expect(find(people!, n => n.kind === 'image')).toBeDefined();
    expect(find(library, n => n.kind === 'widget' && n.widget === 'sentinel' && n.params.on === 'library')).toBeDefined();
  }
});

test('every built-in skin shows the viewer in a badge that can carry their avatar', () => {
  // Index has no profile control, only the reader's name in its rail; the others put the badge in the
  // control that opens the profile menu (Kids: its grown-ups gate).
  for (const [name, doc] of documents) for (const width of [390, 1440]) {
    const badges: { pressed: boolean; style: Record<string, unknown> }[] = [];
    const walk = (node: RNode, pressed: boolean) => {
      if (node.kind === 'text' && node.avatar) badges.push({ pressed, style: node.base.style });
      if (node.kind === 'box') node.children.forEach(child => walk(child, pressed || !!node.press));
      if (node.kind === 'repeat') walk(node.item, pressed);
    };
    walk(resolveDocument(doc, width, 'en').shell!, false);
    expect(badges.length, `${name} ${width}`).toBeGreaterThan(0);
    if (name !== 'index') expect(badges.some(badge => badge.pressed), `${name} ${width}`).toBe(true);
    for (const badge of badges) {
      expect(badge.style.width, `${name} ${width}`).toBeDefined();
      expect(badge.style.height, `${name} ${width}`).toBeDefined();
    }
  }
});

test('every person page scrolls in its frame and shows a close at every width', async () => {
  const { holds, resolveDocument } = await import('../src/resolve');
  type Env = import('../src/vocabulary').Env;
  for (const [name, doc] of documents) for (const width of [390, 1440]) {
    const person = resolveDocument(doc, width, 'en').routes.person!;
    const env = { width, small: width < 640, load: 'ready', personPage: {} } as unknown as Env;
    // The path from the route down to the filmography grid.
    const path = (node: RNode, trail: RNode[]): RNode[] | undefined => {
      if (node.kind === 'repeat' && node.over === 'personPage.movies') return trail;
      if (node.kind === 'box') for (const child of node.children) { const found = path(child, [...trail, node]); if (found) return found; }
      if (node.kind === 'repeat') return path(node.item, [...trail, node]);
      return undefined;
    };
    const trail = path(person, [])!;
    expect(trail, name).toBeDefined();
    // The grid is never inside the close strip: an overlay with no height of its own to scroll in.
    for (const ancestor of trail) expect(JSON.stringify(ancestor.base).includes('"pointer-events":"box-none"'), name).toBe(false);
    const holdsClose = (node: RNode): boolean => node.kind === 'box' && node.press?.action === 'back';
    const visibleClose = (node: RNode): boolean => holds(node.when, { index: 0 }, env)
      && (holdsClose(node) || node.kind === 'box' && node.children.some(visibleClose));
    expect(visibleClose(person), `${name} at ${width}`).toBe(true);
    // The region the page scrolls in is on the path.
    expect(trail.some(node => node.role === 'region'), `${name} at ${width}`).toBe(true);
  }
});
