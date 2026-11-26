import { expect, test } from 'bun:test';
import { revealOffset } from '../src/tv-reveal-policy';

test('a restored search card is fully visible with room for its focus ring', () => {
  expect(revealOffset(490, 190, 0, 540, 35, true)).toBe(156);
  expect(revealOffset(490, 190, 156, 540, 35, true)).toBeUndefined();
  expect(revealOffset(490, 190, 0, 540, 35, false)).toBeUndefined();
});

test('a focused control above the top bar scrolls down into view', () => {
  expect(revealOffset(90, 36, 70, 540, 35, false)).toBe(39);
  expect(revealOffset(10, 36, 70, 540, 35, true)).toBe(0);
});
