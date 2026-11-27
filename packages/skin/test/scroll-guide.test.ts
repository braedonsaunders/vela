// On TV a menu or drawer (a box with `escape`) is a focus guide: it takes focus when it opens and
// keeps it inside while open. The profile menus scroll so they fit short phones; drawn as a bare
// scroll view they lost that guide, so on Android TV focus walked out of the open menu onto the page
// behind and on tvOS it never got in (0.2.79).
import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('react-native-reanimated', () => ({ cubicBezier: (...values: number[]) => values }));
mock.module('../src/fonts', () => ({ fontFace: (name: string) => name }));
const { boxStyle } = await import('../src/translate');
const { GEOMETRY, guidedScrollStyles, scrollGuide, scrollStyles } = await import('../src/scroll-styles');
const { resolveDocument } = await import('../src/resolve');
const { cinematicDoc } = await import('../../protocol/fixtures/skins/cinematic');
type RNode = import('../src/resolve').RNode;
type SkinDocument = import('../../protocol/skin').SkinDocument;
type Box = Extract<RNode, { kind: 'box' }>;

describe('scrollGuide', () => {
  test('a menu that scrolls keeps its escape scope guide on TV', () => {
    expect(scrollGuide(true, false, false, true)).toBe('scope');
  });

  test('a row that scrolls sideways is one region on TV, menu or not', () => {
    expect(scrollGuide(true, false, true, false)).toBe('row');
    expect(scrollGuide(true, false, true, true)).toBe('row');
  });

  test('a route and any other vertical scroll box get no guide, and nothing does off TV', () => {
    expect(scrollGuide(true, true, false, true)).toBeUndefined();
    expect(scrollGuide(true, false, false, false)).toBeUndefined();
    expect(scrollGuide(false, false, false, true)).toBeUndefined();
    expect(scrollGuide(false, false, true, false)).toBeUndefined();
  });
});

describe('guidedScrollStyles', () => {
  const menu = {
    position: 'absolute', top: 56, right: 77, zIndex: 30, width: 260, maxHeight: 1012,
    borderRadius: 20, borderWidth: 1, backgroundColor: '#14171c', opacity: 0.5, transform: [{ scale: 0.98 }],
  } as Record<string, unknown>;

  test('the guide takes the menu\'s place on the page', () => {
    const [guide] = guidedScrollStyles(menu);
    expect(guide).toEqual({ position: 'absolute', top: 56, right: 77, zIndex: 30, width: 260, maxHeight: 1012 });
  });

  test('the scroll view keeps the paint and motion, fills the guide and shrinks to its maximum', () => {
    const [guide, scroll] = guidedScrollStyles(menu);
    expect(scroll).toEqual({ borderRadius: 20, borderWidth: 1, backgroundColor: '#14171c', opacity: 0.5, transform: [{ scale: 0.98 }], flexGrow: 1, flexShrink: 1 });
    for (const key of Object.keys(scroll)) if (key !== 'flexGrow' && key !== 'flexShrink') expect(guide[key]).toBeUndefined();
  });

  test('no row is lost or drawn twice', () => {
    const [guide, scroll] = guidedScrollStyles(menu);
    expect(Object.keys(guide).length + Object.keys(scroll).length - 2).toBe(Object.keys(menu).length);
    expect([...Object.keys(guide)].every(key => GEOMETRY.has(key))).toBe(true);
  });
});

// Every built-in document's menus and drawers that scroll are drawn inside their scope's guide.
const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const folder of readdirSync(fixtures, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(fixtures, e.name, 'document.ts'))).map(e => e.name).sort())
  documents.push([folder, (await import(join(fixtures, folder, 'document.ts'))).default as SkinDocument]);

const m = { viewport: { width: 1920, height: 1080, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, fontSize: 16, axis: 'x' as const };
const literal = (node: Box) => Object.fromEntries(Object.entries(node.base.style).filter((e): e is [string, string] => typeof e[1] === 'string'));

function scrollingScopes(node: RNode | undefined, found: Box[] = []): Box[] {
  if (node?.kind !== 'box') return found;
  if (node.escape?.length) {
    const { fx } = boxStyle(literal(node), m);
    if (fx.scrollY || fx.scrollX) found.push(node);
  }
  for (const child of node.children) scrollingScopes(child, found);
  return found;
}

describe('built-in menus that scroll keep their guide on TV', () => {
  test('the Vela base profile menu scrolls (the case this guards)', () => {
    const resolved = resolveDocument(cinematicDoc, 1920, 'en');
    expect(scrollingScopes(resolved.shell).some(node => node.returnFocus === 'profile-menu-trigger')).toBe(true);
  });

  for (const [name, doc] of documents) {
    test(name, () => {
      const resolved = resolveDocument(doc, 1920, 'en');
      for (const scope of scrollingScopes(resolved.shell)) {
        const { style, fx } = boxStyle(literal(scope), m);
        const horizontal = !!fx.scrollX && !fx.scrollY;
        expect(scrollGuide(true, false, horizontal, true)).toBe(horizontal ? 'row' : 'scope');
        const [, scroller] = scrollStyles(style as Record<string, unknown>, false, false);
        const [guide] = guidedScrollStyles(scroller);
        // The guide holds the menu's place over the page.
        if (scroller.position === 'absolute') expect(guide.position).toBe('absolute');
        if (scroller.zIndex !== undefined) expect(guide.zIndex).toBe(scroller.zIndex);
      }
    });
  }
});
