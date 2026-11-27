import { expect, test } from 'bun:test';
import { isRowCardFrame, rowCardAspect } from '../src/resolve/row-presentation';
import type { BoxNode } from '../../protocol/skin';

test('only supported row shapes override the skin aspect', () => {
  expect(['poster', 'landscape', 'square'].map(rowCardAspect)).toEqual(['2 / 3', '16 / 9', '1 / 1']);
  expect([undefined, '', 'round', 'unknown'].map(rowCardAspect)).toEqual([undefined, undefined, undefined, undefined]);
});

test('the frame can wrap an animated artwork layer, but decorative boxes keep their own ratio', () => {
  const style = { 'aspect-ratio': '2 / 3' };
  const frame: BoxNode = {
    type: 'box', style,
    children: [{ type: 'box', children: [{ type: 'image', src: '{card.poster}' }] }],
  };
  expect(isRowCardFrame(frame, style)).toBe(true);
  expect(isRowCardFrame(frame, {})).toBe(false);
  expect(isRowCardFrame({ ...frame, children: [{ type: 'image', src: '{card.logo}' }] }, style)).toBe(false);
});
