import { expect, test } from 'bun:test';
import { resolveDocument, holds, fill, type RNode } from '../src/resolve';
import { VOCABULARY, type Ctx, type Env } from '../src/vocabulary';
import { cinematicDoc as cinematic } from '../../protocol/fixtures/skins/cinematic';

const episode = { contextParts: [{ label: 'The Gilded Age', select: 'show:1' }, { label: 'Season 1', select: 'season:2' }, { label: 'Episode 1', select: '' }] };
const ctx = { index: 0, card: episode } as unknown as Ctx;

test('card.contextLine joins the context parts into one line', () => {
  expect(VOCABULARY['card.contextLine']!(ctx, {} as Env)).toBe('The Gilded Age\u00a0·\u00a0Season 1\u00a0·\u00a0Episode 1');
  expect(VOCABULARY['card.contextLine']!({ index: 0, card: { contextParts: [] } } as unknown as Ctx, {} as Env)).toBe('');
});

/** The box around a card's context links (the velaCardContext template, as drawn in a home row). */
function cardContext(node: RNode): RNode | undefined {
  if (node.kind === 'repeat') return cardContext(node.item);
  if (node.kind !== 'box') return undefined;
  if (node.children.some(child => child.kind === 'box' && child.children.some(c => c.kind === 'repeat' && c.over === 'card.contextParts'))) return node;
  for (const child of node.children) { const found = cardContext(child); if (found) return found; }
  return undefined;
}

test('a phone card reads its context as one line; a wider card keeps the links', () => {
  const drawn = (small: boolean) => {
    const env = { small, width: small ? 390 : 1280 } as unknown as Env;
    const found: string[] = [];
    const walk = (node: RNode) => {
      if (!holds(node.when, ctx, env)) return;
      if (node.kind === 'text') found.push(fill(node.text, ctx, env));
      if (node.kind === 'box') node.children.forEach(walk);
      if (node.kind === 'repeat' && node.over === 'card.contextParts') found.push('links');
    };
    walk(cardContext(resolveDocument(cinematic, small ? 390 : 1280).routes.home!)!);
    return found;
  };
  expect(drawn(true)).toEqual(['The Gilded Age\u00a0·\u00a0Season 1\u00a0·\u00a0Episode 1']);
  expect(drawn(false)).toEqual(['links']);
});
