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

test('the phone navigation names Live TV once, whether or not the server lists it as a library', async () => {
  const { resolveDocument, holds, fill } = await import('../src/resolve');
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
  const shown = (libraries: { id: string; kind: string; name: string }[]) => {
    const env = { section: 'live', libraries, flags: [] } as unknown as import('../src/vocabulary').Env;
    const names: string[] = [];
    // The labels sit in the 36pt pill drawn inside the trigger's 44pt target.
    const pill = trigger.children.find(child => child.kind === 'box');
    if (pill?.kind !== 'box') throw new Error('no phone navigation pill');
    for (const child of pill.children) {
      if (child.kind === 'text' && holds(child.when, { index: 0 }, env)) names.push(fill(child.text, { index: 0 }, env));
      if (child.kind === 'repeat' && child.item.kind === 'text') {
        for (const dest of libraries) if (holds(child.item.when, { index: 0, dest } as never, env)) names.push(fill(child.item.text, { index: 0, dest } as never, env));
      }
    }
    return names;
  };
  expect(shown([{ id: 'movies', kind: 'movies', name: 'Movies' }, { id: 'live', kind: 'live', name: 'Live TV' }])).toEqual(['Live TV']);
  expect(shown([{ id: 'movies', kind: 'movies', name: 'Movies' }])).toEqual(['Live TV']);
});
