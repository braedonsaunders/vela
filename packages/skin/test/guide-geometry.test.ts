import { expect, test } from 'bun:test';
import { railWidth, rowHeight } from '../src/widgets/guide/geometry';

test('TV guide gives channels more room without changing desktop or phone geometry', () => {
  expect(rowHeight(false, true)).toBeGreaterThan(rowHeight(false));
  expect(railWidth(false, true)).toBeGreaterThan(railWidth(false));
  expect(rowHeight(true)).toBe(68);
  expect(railWidth(true)).toBe(84);
});
