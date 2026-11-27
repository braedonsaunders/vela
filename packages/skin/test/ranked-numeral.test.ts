import { expect, test } from 'bun:test';
import { row, tileRow, wideRow } from '../src/resolve/vela-base/cards';
import type { Node } from '../../protocol/skin';

function numerals(node: Node): Extract<Node, { type: 'text' }>[] {
  if (node.type === 'text') return node.text === '{index.label}' ? [node] : [];
  const kids = [...('children' in node && node.children ? node.children : []), ...('item' in node && node.item ? [node.item as Node] : [])];
  return kids.flatMap(numerals);
}

test('a phone draws the Top 10 numeral against the artwork, not the captioned card', () => {
  // Small art heights: poster 112 x 168, tile 112 x 112, landscape 220 x 124. The numeral's
  // 0.74 line puts its foot about 0.765 of its size below its top, so its size follows the art.
  for (const [shelf, size, margin] of [[row, '220px', '-30px'], [tileRow, '147px', '-20px'], [wideRow, '162px', '-22px']] as const) {
    const found = numerals(shelf);
    expect(found).toHaveLength(4); // 1-9 and 10, in the plain and the ranked shelf
    for (const numeral of found) {
      expect(numeral.small).toMatchObject({ 'align-self': 'flex-start', 'padding-bottom': '0px', 'font-size': size, 'margin-right': margin });
      // Wide screens and TV keep the numeral standing on the card's foot as before.
      expect(numeral.style).toMatchObject({ 'font-size': '348px', 'padding-bottom': '52px', 'margin-right': '-50px' });
    }
  }
});
