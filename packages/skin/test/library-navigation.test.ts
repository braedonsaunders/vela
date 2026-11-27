import { expect, test } from 'bun:test';
import { shellHasLibraryTabs } from '../src/widgets/library/navigation';

test('only shells placing library tabs suppress the page copy', () => {
  expect(shellHasLibraryTabs(undefined)).toBe(false);
  expect(shellHasLibraryTabs({ type: 'slot', slot: 'children' })).toBe(false);
  expect(shellHasLibraryTabs({ type: 'box', children: [{ type: 'widget', widget: 'libraryToolbar' }] })).toBe(false);
  expect(shellHasLibraryTabs({ type: 'box', children: [{ type: 'widget', widget: 'libraryTabs' }, { type: 'slot', slot: 'children' }] })).toBe(true);
});

test('the shared phone shell leaves library view tabs in the page toolbar', async () => {
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
  expect(count(390)).toBe(0);
  expect(count(1200)).toBe(0);
  expect(count(1920)).toBe(0);
});

test('the shared phone shell provides a discoverable destination menu', async () => {
  const { resolveDocument } = await import('../src/resolve');
  const { velaBase } = await import('../src/resolve/base');
  const find = (node: import('../src/resolve').RNode, id: string): import('../src/resolve').RNode | undefined => {
    if (node.id === id) return node;
    if (node.kind === 'box') for (const child of node.children) { const found = find(child, id); if (found) return found; }
    if (node.kind === 'repeat') return find(node.item, id);
    return undefined;
  };
  const compact = find(resolveDocument(velaBase, 390).shell!, 'mobile-navigation-trigger');
  const wide = find(resolveDocument(velaBase, 1200).shell!, 'mobile-navigation-trigger');
  expect(compact?.base.style.display).toBe('flex');
  expect(compact?.kind === 'box' && compact.press).toEqual({ action: 'toggle', arg: 'navigation' });
  expect(wide?.base.style.display).toBe('none');
  expect(compact?.a11y?.expanded).toHaveLength(1);
  expect(JSON.stringify(resolveDocument(velaBase, 390).shell)).not.toContain('"widget":"libraryTabs"');
});

test('the phone navigation keeps a section label even when the library fails to load', async () => {
  const { resolveDocument, fill } = await import('../src/resolve');
  const { velaBase } = await import('../src/resolve/base');
  type RNode = import('../src/resolve').RNode;
  const find = (node: RNode, id: string): RNode | undefined => {
    if (node.id === id) return node;
    if (node.kind === 'box') for (const child of node.children) { const found = find(child, id); if (found) return found; }
    if (node.kind === 'repeat') return find(node.item, id);
    return undefined;
  };
  const trigger = find(resolveDocument(velaBase, 390, 'en').shell!, 'mobile-navigation-trigger');
  if (trigger?.kind !== 'box') throw new Error('no phone navigation trigger');
  const label = trigger.children.find(node => node.kind === 'text');
  if (label?.kind !== 'text') throw new Error('no phone navigation label');
  const libraries = [
    { id: 'movies', kind: 'movies', name: 'Movies' },
    { id: 'broadcast', kind: 'live', name: 'Broadcast' },
  ];
  const shown = (section: string, destinations = libraries) => fill(label.text, { index: 0 }, {
    section, libraries: destinations, load: 'failed',
  } as unknown as import('../src/vocabulary').Env);

  expect(shown('home')).toBe('Home');
  expect(shown('live')).toBe('Live TV');
  expect(shown('live', [])).toBe('Live TV');
  expect(shown('movies')).toBe('Movies');
  expect(shown('missing-library')).toBe('Library');
  expect(shown('movies', [{ id: 'movies', kind: 'movies', name: ' ' }])).toBe('Library');
});
