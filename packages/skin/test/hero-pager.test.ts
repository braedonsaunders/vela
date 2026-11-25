import { expect, test } from 'bun:test';
import { isHeroControl, isHeroSegment } from '../src/hero-pager';

test('only a per-title pickHero is a segment; previous, next and pause still drive the rotation', () => {
  expect(isHeroSegment('pickHero', '2', 2, true)).toBe(true);
  // Next, drawn inside the title on show, names another title than its own item.
  expect(isHeroSegment('pickHero', '3', 2, true)).toBe(false);
  expect(isHeroSegment('pickHero', '2', 2, false)).toBe(false);
  expect(isHeroSegment('select', '2', 2, true)).toBe(false);
  expect(isHeroControl('pickHero', '3')).toBe(true);
  expect(isHeroControl('toggle', 'hero-paused')).toBe(true);
  expect(isHeroControl('toggle', 'menu')).toBe(false);
});
