import { expect, test } from 'bun:test';
import { withRowLinks } from '../src/resolve/row-links';
import { visibleRowItems } from '../src/row-visible';
import type { RNode } from '../src/resolve';
import type { Ctx, Env } from '../src/vocabulary';

test('all skin shelf headings use the shared row affordance', () => {
  expect(withRowLinks({ type: 'text', text: '{row.name}', style: { color: 'red' } })).toMatchObject({ type: 'widget', widget: 'rowLink', style: { color: 'red' } });
});
test('shelves replace speculative paging with a focusable end tile', () => {
  const result = withRowLinks({ type: 'box', children: [
    { type: 'repeat', over: 'row.items', limit: 8, item: { type: 'box' } },
    { type: 'box', children: [{ type: 'widget', widget: 'sentinel', params: { on: 'row' } }] },
  ] });
  expect(result).toMatchObject({ children: [
    { type: 'repeat', limit: 8 }, { type: 'widget', widget: 'rowLink', params: { end: 'true', limit: '8' } },
  ] });
  expect(withRowLinks({ type: 'widget', widget: 'sentinel', params: { on: 'home' } })).toMatchObject({ widget: 'sentinel' });
});
test('active shelf limit also reaches the title for a complete but truncated row', () => {
  const ctx = { row: { items: Array(20).fill({}) } } as Ctx;
  const env = {} as Env;
  const node = { kind: 'box', when: [], children: [{ kind: 'repeat', over: 'row.items', when: [], limit: 8 }] } as unknown as RNode;
  expect(visibleRowItems(node, ctx, env)).toBe(8);
});

test('legacy collection grids receive scroll continuation when the skin omits it', async () => {
  const { resolveDocument } = await import('../src/resolve');
  const { default: mochi } = await import('../../protocol/fixtures/skins/mochi/document');
  const tree = resolveDocument(mochi, 1280).routes.collection!;
  const sentinels: RNode[] = [];
  const visit = (node: RNode) => {
    if (node.kind === 'widget' && node.widget === 'sentinel' && node.params.on === 'collection') sentinels.push(node);
    if (node.kind === 'box') node.children.forEach(visit);
    if (node.kind === 'repeat') visit(node.item);
  };
  visit(tree);
  expect(sentinels.length).toBe(1);
});
