import { expect, test } from 'bun:test';
import { shellHasLibraryTabs } from '../src/widgets/library/navigation';

test('only shells placing library tabs suppress the page copy', () => {
  expect(shellHasLibraryTabs(undefined)).toBe(false);
  expect(shellHasLibraryTabs({ type: 'slot', slot: 'children' })).toBe(false);
  expect(shellHasLibraryTabs({ type: 'box', children: [{ type: 'widget', widget: 'libraryToolbar' }] })).toBe(false);
  expect(shellHasLibraryTabs({ type: 'box', children: [{ type: 'widget', widget: 'libraryTabs' }, { type: 'slot', slot: 'children' }] })).toBe(true);
});
