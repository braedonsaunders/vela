import type { Node, Style } from '../../../protocol/skin';

/** Apply the library's shape to each document's existing card layout after templates expand. */
export function withLibraryPresentation(node: Exclude<Node, { type: 'use' }>, width: number): Exclude<Node, { type: 'use' }> {
  if (node.type !== 'box') return node;
  const styles: Style = {};
  if (node.style?.['aspect-ratio']?.replaceAll(' ', '') === '2/3') styles['aspect-ratio'] = '{library.cardRatio}';
  const isCard = node.press?.action === 'select' && /card\./.test(node.press.arg ?? '');
  if (isCard && node.style?.width && node.style.width !== '100%') styles.width = width < 600 ? '240px' : '320px';
  const grid = node.style?.display === 'grid' && node.children?.some(child => child.type === 'repeat' && /^(library\.(items|collections)|collection.items)$/.test(child.over));
  if (grid) styles['grid-template-columns'] = width < 600 ? 'repeat(auto-fill, minmax(240px, 1fr))' : 'repeat(auto-fill, minmax(280px, 1fr))';
  if (!Object.keys(styles).length) return node;
  return { ...node, states: [...(node.states ?? []), ...(['landscape', 'square'] as const).map(card => ({
    when: [{ test: 'library.card', is: 'eq' as const, value: card }],
    style: card === 'square' ? { ...styles, ...(styles.width ? { width: width < 600 ? '150px' : '210px' } : {}), ...(grid ? { 'grid-template-columns': width < 600 ? 'repeat(auto-fill, minmax(140px, 1fr))' : 'repeat(auto-fill, minmax(200px, 1fr))' } : {}) } : styles,
  }))] };
}
