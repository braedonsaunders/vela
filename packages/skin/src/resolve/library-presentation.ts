import type { Node, Style } from '../../../protocol/skin';

/** Apply the library's shape to each document's existing card layout after templates expand. */
export function withLibraryPresentation(node: Exclude<Node, { type: 'use' }>, width: number): Exclude<Node, { type: 'use' }> {
  if (node.type !== 'box') return node;
  const styles: Style = {};
  const cover = node.style?.['aspect-ratio']?.replaceAll(' ', '') === '2/3';
  if (cover) styles['aspect-ratio'] = '{library.cardRatio}';
  const isCard = node.press?.action === 'select' && /card\./.test(node.press.arg ?? '');
  if (isCard && node.style?.width && node.style.width !== '100%') styles.width = width < 600 ? '240px' : '320px';
  const grid = node.style?.display === 'grid' && node.children?.some(child => child.type === 'repeat' && /^(library\.(items|collections)|collection.items)$/.test(child.over));
  if (grid) styles['grid-template-columns'] = width < 600 ? 'repeat(auto-fill, minmax(240px, 1fr))' : 'repeat(auto-fill, minmax(280px, 1fr))';
  if (!Object.keys(styles).length) return node;
  // A media card's own cover (docs/media-kinds.md) wins over the library's: a square album, a
  // round artist, a book with a spine, wherever the card is drawn (home rows, search, libraries).
  const own = cover ? MEDIA_COVERS : [];
  const withSpine = cover && node.children ? { children: [...node.children, BOOK_SPINE] } : {};
  return { ...node, ...withSpine, states: [...(node.states ?? []), ...own, ...(['landscape', 'square'] as const).map(card => ({
    when: [{ test: 'library.card', is: 'eq' as const, value: card }],
    style: card === 'square' ? { ...styles, ...(styles.width ? { width: width < 600 ? '150px' : '210px' } : {}), ...(grid ? { 'grid-template-columns': width < 600 ? 'repeat(auto-fill, minmax(140px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))' } : {}) } : styles,
  }))] };
}

const shape = (value: string) => [{ test: 'card.shape', is: 'eq' as const, value }];
const MEDIA_COVERS: NonNullable<Node['states']> = [
  { when: shape('square'), style: { 'aspect-ratio': '1 / 1' } },
  { when: shape('round'), style: { 'aspect-ratio': '1 / 1', 'border-radius': '9999px' } },
  { when: shape('book'), style: { 'aspect-ratio': '2 / 3', 'border-radius': '3px' } },
];
/** A bound book's spine: a crease and a soft highlight down the cover's left edge. */
const BOOK_SPINE: Node = {
  type: 'box',
  when: shape('book'),
  a11y: { hidden: true },
  style: {
    position: 'absolute', top: '0px', bottom: '0px', left: '0px', width: '9%', 'z-index': '2', 'pointer-events': 'none',
    'background-image': 'linear-gradient(90deg, rgba(0, 0, 0, 0.34) 0%, rgba(255, 255, 255, 0.2) 22%, rgba(0, 0, 0, 0.18) 48%, rgba(0, 0, 0, 0) 100%)',
  },
};
