import { expect, test } from 'bun:test';
import type { Node } from '../../protocol/skin';
import { withLibraryPresentation } from '../src/resolve/library-presentation';

const art: Exclude<Node, { type: 'use' }> = { type: 'box', style: { 'aspect-ratio': '2 / 3', position: 'relative' }, children: [{ type: 'image', src: '{card.poster}' }] };

test('a poster cover takes each media card shape before the library shape', () => {
  const node = withLibraryPresentation(art, 1280);
  if (node.type !== 'box') throw new Error('box expected');
  const shapes = node.states!.map(state => `${state.when[0]!.test}=${state.when[0]!.value}`);
  expect(shapes.slice(0, 3)).toEqual(['card.shape=square', 'card.shape=round', 'card.shape=book']);
  expect(shapes.slice(3)).toEqual(['library.card=landscape', 'library.card=square']);
  expect(node.states![1]!.style['border-radius']).toBe('9999px');
  // A book gets its spine over the cover, drawn only for book cards.
  const spine = node.children!.at(-1)!;
  expect(spine.when).toEqual([{ test: 'card.shape', is: 'eq', value: 'book' }]);
  expect(spine.a11y?.hidden).toBe(true);
});

test('boxes that are not covers are left alone', () => {
  const plain: Exclude<Node, { type: 'use' }> = { type: 'box', style: { 'aspect-ratio': '16 / 9' }, children: [] };
  expect(withLibraryPresentation(plain, 1280)).toBe(plain);
});
