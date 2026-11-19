import { expect, test } from 'bun:test';
import { shellHasLibraryTabs } from '../src/widgets/library/navigation';

test('only shells placing library tabs suppress the page copy', () => {
  expect(shellHasLibraryTabs(undefined)).toBe(false);
  expect(shellHasLibraryTabs({ type: 'slot', slot: 'children' })).toBe(false);
  expect(shellHasLibraryTabs({ type: 'box', children: [{ type: 'widget', widget: 'libraryToolbar' }] })).toBe(false);
  expect(shellHasLibraryTabs({ type: 'box', children: [{ type: 'widget', widget: 'libraryTabs' }, { type: 'slot', slot: 'children' }] })).toBe(true);
});

test('only compact shells put library view tabs beside destinations', async () => {
  const { resolveDocument } = await import('../src/resolve');
  const { velaBase } = await import('../src/resolve/base');
  const count = (width: number) => {
    let tabs = 0;
    const walk = (node: import('../src/resolve').RNode) => {
      if (node.base.style.display === 'none') return;
      if (node.kind === 'widget' && node.widget === 'libraryTabs') tabs++;
      if (node.kind === 'box') node.children.forEach(walk);
      if (node.kind === 'repeat') walk(node.item);
    };
    walk(resolveDocument(velaBase, width).shell!);
    return tabs;
  };
  expect(count(390)).toBe(1);
  expect(count(1200)).toBe(0);
  expect(count(1920)).toBe(0);
});
