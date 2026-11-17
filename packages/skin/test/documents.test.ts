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
    expect(() => resolveDocument({ ...doc, renderer: RENDERER_VERSION + 1 }, 1440)).toThrow(`needs renderer ${RENDERER_VERSION + 1}`);
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
  const { withBase } = await import('../src/resolve/inherit');
  const { velaBase } = await import('../src/resolve/base');
  const broadcast = documents.find(([name]) => name === 'broadcast')![1];
  const lateNight = documents.find(([name]) => name === 'latenight')![1];
  const topPadding = (doc: SkinDocument) => {
    const route = withBase(doc, velaBase).routes!.library!;
    if (route.type !== 'box' || route.children?.[3]?.type !== 'box') throw new Error('missing toolbar');
    return [route.children[3].style?.['padding-top'], route.children[3].small?.['padding-top']];
  };
  expect(topPadding(broadcast)).toEqual(['0px', '0px']);
  expect(topPadding(lateNight)).toEqual(['84px', '104px']);
});

test('every detail header is field-driven for movies, episodes and plugin media, with or without logos', async () => {
  const { detailModel } = await import('../../core/src/discovery/models');
  const { fill, holds } = await import('../src/resolve');
  type Env = import('../src/vocabulary').Env;
  type Title = import('../../core/src/wire').Title;
  for (const kind of ['movie', 'episode', 'plugin-audiobook']) {
    for (const logo of [false, true]) {
      for (const context of [false, true]) {
        const name = `${kind} title`;
        const data: Title = { id: 'probe', kind: kind as Title['kind'], name, summary: '', genres: [],
          ...(context ? { showName: 'A series', seasonNumber: 2, episodeNumber: 3 } : {}),
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
          const walk = (n: RNode) => {
            if (!holds(n.when, { index: 0 }, env)) return;
            if (n.role === 'heading' && n.level === 1 && ((n.kind === 'text' && fill(n.text, { index: 0 }, env) === name) || (n.kind === 'image' && fill(n.alt, { index: 0 }, env) === name))) headings.push(n);
            if (n.kind === 'text' && fill(n.text, { index: 0 }, env) === 'A series · Season 2, Episode 3') contexts.push('context');
            if (n.kind === 'box') n.children.forEach(walk);
          };
          walk(resolved.routes.title!);
          expect(headings.length).toBeGreaterThan(0);
          expect(contexts.length > 0).toBe(context);
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
