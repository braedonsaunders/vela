import { expect, test } from 'bun:test';
import { heroSegmentDestination, isHeroControl, isHeroSegment } from '../src/hero-pager';

test('arrow keys move among the featured titles, wrapping round; Home and End reach the ends', () => {
  expect(heroSegmentDestination('ArrowRight', 1, 6)).toBe(2);
  expect(heroSegmentDestination('ArrowRight', 5, 6)).toBe(0);
  expect(heroSegmentDestination('ArrowLeft', 0, 6)).toBe(5);
  expect(heroSegmentDestination('Home', 4, 6)).toBe(0);
  expect(heroSegmentDestination('End', 0, 6)).toBe(5);
  expect(heroSegmentDestination('ArrowUp', 2, 6)).toBeNull();
  expect(heroSegmentDestination('ArrowRight', 0, 1)).toBeNull();
});

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
