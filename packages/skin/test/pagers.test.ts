import { expect, test } from 'bun:test';
import { NO_PAGERS, pagerScope, withPager } from '../../../apps/vela/src/pagers';

test('a row pager reports into its own route only, and an unchanged report keeps the value', () => {
  const home = pagerScope('home', 'home'), movies = pagerScope('library', '1');
  const first = withPager({}, home, 'continue', { atStart: true, atEnd: false });
  expect(first[home]).toEqual({ continue: { atStart: true, atEnd: false } });
  expect(first[movies] ?? NO_PAGERS).toBe(NO_PAGERS);
  expect(withPager(first, home, 'continue', { atStart: true, atEnd: false })).toBe(first);
  const second = withPager(first, movies, 'recent', { atStart: false, atEnd: true });
  expect(second[home]).toBe(first[home]);
  expect(withPager(second, home, 'continue', { atStart: false, atEnd: false })[movies]).toBe(second[movies]);
});
