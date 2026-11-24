// A route is drawn as a scroll view with its content inside. A title page drawn as a frame the
// window's height must give its content that height, or the region inside it that scrolls grows to
// its full length and the episode list cannot be scrolled (#41).
import { describe, expect, mock, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('react-native-reanimated', () => ({ cubicBezier: (...values: number[]) => values }));
mock.module('../src/fonts', () => ({ fontFace: (name: string) => name }));
const { boxStyle } = await import('../src/translate');
const { scrollStyles } = await import('../src/scroll-styles');
const { resolveDocument } = await import('../src/resolve');
const { cinematicDoc } = await import('../../protocol/fixtures/skins/cinematic');
type RNode = import('../src/resolve').RNode;
type SkinDocument = import('../../protocol/skin').SkinDocument;

const measure = (width: number, height: number) => ({ viewport: { width, height, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, fontSize: 16, axis: 'x' as const });

describe('scrollStyles', () => {
  const frame = { height: '100%', minHeight: 0, overflowY: 'hidden', flexDirection: 'column', paddingTop: 8 } as Record<string, unknown>;

  test('a route that sets its height on the web gives its content that height, and keeps it', () => {
    const [content, scroller] = scrollStyles(frame, true, true);
    expect(content).toMatchObject({ height: '100%', minHeight: 0, flexDirection: 'column', paddingTop: 8 });
    expect(scroller).toMatchObject({ height: '100%', overflowY: 'hidden' });
    expect(scroller.minHeight).toBeUndefined();
    expect(scrollStyles({ maxHeight: 600 }, true, true)[0]).toEqual({ maxHeight: 600 });
  });

  test('a route without a height leaves its content to grow, so the window scrolls it', () => {
    const [content, scroller] = scrollStyles({ minHeight: '100%', position: 'relative' }, true, true);
    expect(content).toEqual({ minHeight: '100%' });
    expect(scroller).toEqual({ position: 'relative' });
  });

  test('a scroll box inside a page, and a native route, keep their height on the scroll view', () => {
    expect(scrollStyles(frame, false, true)[0].height).toBeUndefined();
    expect(scrollStyles(frame, false, true)[1].minHeight).toBe(0);
    expect(scrollStyles(frame, true, false)[0].height).toBeUndefined();
  });
});

const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const folder of readdirSync(fixtures, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(fixtures, e.name, 'document.ts'))).map(e => e.name).sort())
  documents.push([folder, (await import(join(fixtures, folder, 'document.ts'))).default as SkinDocument]);

type Box = Extract<RNode, { kind: 'box' }>;
const literal = (node: Box) => Object.fromEntries(Object.entries(node.base.style).filter((e): e is [string, string] => typeof e[1] === 'string'));
const clips = (overflow: unknown) => overflow === 'hidden' || overflow === 'clip';
const scrolls = (overflow: unknown) => overflow === 'auto' || overflow === 'scroll';

/** Whether a box inside a bounded parent holds a region that scrolls: the region and every box
 * between take the space left (flex-grow) and stop at no more than the window (min-height 0, or
 * Lounge's person page's 100vh), or have a height of their own. */
function boundedRegion(node: Box, m: ReturnType<typeof measure>, depth = 0): boolean {
  return depth < 4 && node.children.some(child => {
    if (child.kind !== 'box') return false;
    const { style: drawn, fx } = boxStyle(literal(child), m);
    const style = drawn as Record<string, unknown>;
    if (style.position === 'absolute') return false;
    const bounded = style.height !== undefined || (Number(style.flexGrow) > 0 && typeof style.minHeight === 'number' && style.minHeight <= m.viewport.height);
    return bounded && (fx.scrollY || scrolls(style.overflowY) || boundedRegion(child, m, depth + 1));
  });
}

describe('every built-in title page scrolls on the web', () => {
  for (const [name, doc] of documents) for (const [width, height] of [[1920, 1080], [1366, 768], [1536, 864], [390, 844]] as const) {
    test(`${name} at ${width}x${height}`, () => {
      const m = measure(width, height);
      const resolved = resolveDocument(doc, width, 'en');
      for (const tree of [resolved.routes.title, resolved.routes.person, resolved.mediaTitle]) {
        if (!tree || tree.kind !== 'box') continue;
        const { style } = boxStyle(literal(tree), m);
        const [content, scroller] = scrollStyles(style as Record<string, unknown>, true, true);
        if (content.height === undefined) {
          // The window scrolls the page: the route must not clip it.
          expect(clips(scroller.overflowY) || clips(scroller.overflow)).toBe(false);
        } else {
          // A frame: its content has the frame's height, and a region inside takes what is left and scrolls.
          expect(content.height === scroller.height).toBe(true);
          expect(boundedRegion(tree, m)).toBe(true);
        }
      }
    });
  }
});
