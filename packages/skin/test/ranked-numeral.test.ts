import { expect, test } from 'bun:test';
import { row, shelfRow, tileRow, wideRow } from '../src/resolve/vela-base/cards';
import type { Node } from '../../protocol/skin';

function numerals(node: Node): Extract<Node, { type: 'text' }>[] {
  if (node.type === 'text') return node.text === '{index.label}' ? [node] : [];
  const kids = [...('children' in node && node.children ? node.children : []), ...('item' in node && node.item ? [node.item as Node] : [])];
  return kids.flatMap(numerals);
}

test('a phone draws the Top 10 numeral against the artwork, not the captioned card', () => {
  // Small art heights: poster 112 x 168, tile 112 x 112, landscape 220 x 123.75. The numeral is
  // 1.12 of the art's height between paddings of 0.08 of it, so its ink stays on the art and in
  // its own box. Any other card template is sized as the poster.
  for (const [shelf, size, margin, pad] of [[row, '188px', '-25px', '13px'], [tileRow, '125px', '-17px', '9px'], [wideRow, '139px', '-19px', '10px'], [shelfRow(true, 'customCard'), '188px', '-25px', '13px']] as const) {
    const found = numerals(shelf);
    expect(found).toHaveLength(4); // 1-9 and 10, in the plain and the ranked shelf
    for (const numeral of found) {
      expect(numeral.small).toMatchObject({ 'align-self': 'flex-start', 'font-size': size, 'margin-right': margin, 'padding-top': pad, 'padding-bottom': pad });
      // Wide screens and TV keep the numeral standing on the card's foot as before.
      expect(numeral.style).toMatchObject({ 'font-size': '348px', 'padding-bottom': '52px', 'margin-right': '-50px' });
    }
  }
});
