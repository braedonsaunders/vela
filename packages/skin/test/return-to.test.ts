import { expect, test } from 'bun:test';
import { safeReturnTo } from '../../../apps/vela/src/return-to';

test('sign-in return destinations stay inside the app', () => {
  expect(safeReturnTo('/title/movie-1?library=films')).toBe('/title/movie-1?library=films');
  expect(safeReturnTo('https://example.com/title/movie-1')).toBe('/');
  expect(safeReturnTo('//example.com/title/movie-1')).toBe('/');
  expect(safeReturnTo('/sign-in')).toBe('/');
});
