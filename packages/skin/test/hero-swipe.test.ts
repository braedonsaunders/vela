import { expect, test } from 'bun:test';
import { heroSwipe } from '../src/hero-swipe-logic';

test('hero swipes advance once and wrap both ways', () => {
  expect(heroSwipe(-90, 10, 0, 3)).toBe(1);
  expect(heroSwipe(-90, 10, 2, 3)).toBe(0);
  expect(heroSwipe(90, 10, 0, 3)).toBe(2);
});
test('taps, short drags, vertical scrolling and a single hero do not select', () => {
  for (const [dx, dy] of [[0, 0], [30, 3], [70, 80], [60, 50]]) expect(heroSwipe(dx, dy, 0, 3)).toBeNull();
  expect(heroSwipe(-90, 0, 0, 1)).toBeNull();
  expect(heroSwipe(-90, 0, 0, 0)).toBeNull();
});
