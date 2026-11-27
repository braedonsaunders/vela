import { libraryCardRatio } from '@vela/core';
import type { BoxNode, Node, Style } from '../../../protocol/skin';

/** Only explicit shapes override a skin's choice of frame. */
export function rowCardAspect(card: unknown): string | undefined {
  if (card === 'poster' || card === 'landscape' || card === 'square') return libraryCardRatio(card);
  return undefined;
}

function hasCardArt(node: Node): boolean {
  if (node.type === 'image') return node.src === '{card.poster}' || node.src === '{card.backdrop}';
  return node.type === 'box' && !!node.children?.some(hasCardArt);
}

/** Skin shelves put the aspect on the artwork box, sometimes with an inner layer for motion. */
export function isRowCardFrame(node: BoxNode, style: Style): boolean {
  return !!style['aspect-ratio'] && !!node.children?.some(hasCardArt);
}
