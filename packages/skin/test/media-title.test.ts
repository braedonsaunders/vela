// A music, book or audiobook title opens in the document's own title page: the media page takes
// the frame's scroll region, the frame and its close control stay (resolve/media-title.ts).
import { expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { resolveDocument, type RNode } from '../src/resolve';
import { mediaTitleTree, TITLE_SCROLL_ID } from '../src/resolve/media-title';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import type { Node, SkinDocument } from '../../protocol/skin';

const fixtures = join(import.meta.dir, '../../protocol/fixtures/skins');
const documents: [string, SkinDocument][] = [['cinematic', cinematicDoc]];
for (const folder of readdirSync(fixtures, { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(fixtures, e.name, 'document.ts'))).map(e => e.name).sort())
  documents.push([folder, (await import(join(fixtures, folder, 'document.ts'))).default as SkinDocument]);

function find(node: RNode, test: (node: RNode) => boolean): RNode[] {
  const own = test(node) ? [node] : [];
  if (node.kind === 'box') return [...own, ...node.children.flatMap(child => find(child, test))];
  if (node.kind === 'repeat') return [...own, ...find(node.item, test)];
  return own;
}
const testId = (node: RNode) => typeof node.testId === 'string' ? node.testId : '';

test('the scroll region holds the media page and keeps a close control, nothing of the film page', () => {
  const close: Node = { type: 'box', press: { action: 'back' }, testId: 'detail-close' };
  const title: Node = { type: 'box', testId: 'detail-route', children: [
    { type: 'box', testId: 'detail-frame', motion: 'velaOpen', children: [
      { type: 'box', id: TITLE_SCROLL_ID, children: [
        { type: 'text', text: '{detail.name}' },
        { type: 'box', children: [{ type: 'widget', widget: 'titleActions' }] },
        { type: 'box', when: [{ test: 'env.load', is: 'eq', value: 'failed' }], children: [close] },
        { type: 'box', when: [{ test: 'env.small' }], children: [close] },
      ] },
    ] },
  ] };
  const tree = mediaTitleTree(title) as Extract<Node, { type: 'box' }>;
  const frame = tree.children![0] as Extract<Node, { type: 'box' }>;
  expect(frame.motion).toBe('velaOpen');
  const region = frame.children![0] as Extract<Node, { type: 'box' }>;
  expect(region.children!.map(child => child.type === 'widget' ? child.widget : 'box')).toEqual(['mediaPage', 'box']);
  expect(JSON.stringify(region.children![1])).toContain('detail-close');
  // The document's own tree is left as it was.
  expect((title.children![0] as Extract<Node, { type: 'box' }>).children![0]).not.toBe(region);
});

test('a title page without a scroll region gives no media tree', () => {
  expect(mediaTitleTree({ type: 'box', children: [{ type: 'text', text: 'x' }] })).toBeUndefined();
  expect(mediaTitleTree(undefined)).toBeUndefined();
});

test('every built-in document opens media titles in its own title page, with its close control', () => {
  for (const [name, doc] of documents) for (const width of [390, 1440]) {
    const resolved = resolveDocument(doc, width);
    const media = resolved.mediaTitle;
    expect(media, `${name} @${width}`).toBeDefined();
    expect(find(media!, node => node.kind === 'widget' && node.widget === 'mediaPage').length, name).toBe(1);
    expect(find(media!, node => ['detail-close', 'detail-back'].includes(testId(node))).length, name).toBeGreaterThan(0);
    // The frame's motion and testIds are the title page's own.
    const frames = (tree: RNode) => find(tree, node => testId(node) === 'detail-frame').map(node => node.motion?.keyframes ?? '');
    expect(frames(media!), name).toEqual(frames(resolved.routes.title!));
    expect(find(media!, node => node.kind === 'widget' && node.widget === 'titleActions').length, name).toBe(0);
  }
});

test('the inline media slot preserves modal framing and close controls for the active skin', () => {
  for (const [name, doc] of documents) for (const width of [390, 1440]) {
    const { mediaTitle, mediaTitleSlot } = resolveDocument(doc, width);
    expect(mediaTitleSlot, name).toBeDefined();
    const slotCount = (tree: RNode) => find(tree, node => node.kind === 'slot' && node.slot === 'children').length;
    expect(slotCount(mediaTitleSlot!), name).toBe(slotCount(mediaTitle!) + 1);
    expect(find(mediaTitleSlot!, node => node.kind === 'widget' && node.widget === 'mediaPage')).toEqual([]);
    expect(find(mediaTitleSlot!, node => ['detail-close', 'detail-back'].includes(testId(node))))
      .toEqual(find(mediaTitle!, node => ['detail-close', 'detail-back'].includes(testId(node))));
  }
});
