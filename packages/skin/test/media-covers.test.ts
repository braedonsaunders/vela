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

test('a person page\'s title grids take the library\'s landscape columns, as library grids do', () => {
  for (const over of ['personPage.movies', 'personPage.tv', 'library.items']) {
    const grid: Exclude<Node, { type: 'use' }> = { type: 'box', style: { display: 'grid' }, children: [{ type: 'repeat', over, item: { type: 'box' } }] };
    const node = withLibraryPresentation(grid, 1440);
    if (node.type !== 'box') throw new Error('box expected');
    const landscape = node.states!.find(state => state.when[0]!.value === 'landscape');
    expect(landscape?.style['grid-template-columns']).toBe('repeat(auto-fill, minmax(280px, 1fr))');
  }
});

test('a person page opened from a library reads that library\'s card shape', async () => {
  const { LIBRARY_VOCABULARY } = await import('../src/widgets/library/vocabulary');
  const read = (key: string, personPage?: { card?: 'landscape' | 'poster' | 'square' }) => LIBRARY_VOCABULARY[key]!({ index: 0 }, { libraries: [], personPage });
  expect(read('library.card', { card: 'landscape' })).toBe('landscape');
  expect(read('library.cardRatio', { card: 'landscape' })).toBe('16 / 9');
  expect(read('library.card')).toBe('poster');
  expect(read('library.cardRatio', {})).toBe('2 / 3');
});
