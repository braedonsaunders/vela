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
