import { expect, test } from 'bun:test';
import { withHeroArtwork } from '../src/resolve/hero-artwork';
import type { Node } from '../../protocol/skin';

test('custom skin backdrop slots retain layout and search guards but mount even without artwork', () => {
  const node: Node = { type: 'box', when: [{ test: 'hero.backdrop' }, { test: 'env.searching', not: true }], children: [
    { type: 'image', src: '{hero.backdrop}', alt: '', style: { height: '600px' }, small: { height: '300px' } },
  ] };
  const result = withHeroArtwork(node);
  expect(result.when).toEqual([{ test: 'env.searching', not: true }]);
  if (result.type !== 'box') throw new Error('expected stage');
  expect(result.children?.[0]).toMatchObject({ type: 'widget', widget: 'heroArtwork', style: { height: '600px' }, small: { height: '300px' } });
  expect(node.when).toHaveLength(2);
});

test('legacy poster fallback no longer covers the shared backdrop and trailer stage', () => {
  const result = withHeroArtwork({ type: 'image', src: '{hero.poster}', alt: '', when: [{ test: 'hero.backdrop', not: true }] });
  expect(result).toEqual({ type: 'box', style: { display: 'none' } });
});

test('phone-only poster stages also receive backdrop recovery and ambient fallback', () => {
  const result = withHeroArtwork({ type: 'image', src: '{hero.poster}', alt: '', when: [{ test: 'env.small' }, { test: 'hero.poster' }] });
  expect(result).toMatchObject({ type: 'widget', widget: 'heroArtwork', when: [{ test: 'env.small' }] });
});

test('text-only featured skins receive a background without adding a second stage to illustrated skins', () => {
  const node: Node = { type: 'repeat', over: 'home.hero', item: { type: 'box', children: [{ type: 'text', text: '{hero.name}' }] } };
  const result = withHeroArtwork(node);
  if (result.type !== 'repeat' || result.item.type !== 'box') throw new Error('expected hero');
  expect(result.item.children?.[0]).toMatchObject({ type: 'widget', widget: 'heroArtwork' });
  expect(withHeroArtwork(result)).toEqual(result);
});
