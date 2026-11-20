import { expect, test } from 'bun:test';
import { gridOffsets, gridRowAt, gridWindow } from '../src/web-grid-layout';

test('variable measured rows preserve their place between estimated rows', () => {
  const offsets = gridOffsets(4, new Map([[1, 50], [3, 200]]), 100, 12);
  expect(offsets).toEqual([0, 112, 174, 286, 486]);
  expect(gridRowAt(offsets, 173)).toBe(1);
  expect(gridRowAt(offsets, 174)).toBe(2);
  expect(gridWindow(offsets, 174, 100, 0)).toEqual({ start: 2, end: 3 });
  expect(gridWindow(offsets, 174, 100, 1)).toEqual({ start: 1, end: 4 });
});

test('the row budget is independent of catalogue size and clips both ends', () => {
  const offsets = gridOffsets(10_000, new Map(), 100, 0);
  expect(gridWindow(offsets, -1000, 500)).toEqual({ start: 0, end: 0 });
  expect(gridWindow(offsets, 0, 300)).toEqual({ start: 0, end: 6 });
  expect(gridWindow(offsets, 200_000, 300)).toEqual({ start: 1998, end: 2006 });
  expect(gridWindow(offsets, 999_950, 300)).toEqual({ start: 9997, end: 10_000 });
});
