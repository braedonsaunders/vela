import { expect, test } from 'bun:test';
import { rowLinkTakesDirectionalFocus, takesDirectionalFocus } from '../src/focus-stop-policy';

test('hero indicators and pointer paging controls never enter directional focus order', () => {
  expect(takesDirectionalFocus('pickHero', '2')).toBe(false);
  expect(takesDirectionalFocus('pickHero', '{index}')).toBe(false);
  expect(takesDirectionalFocus('toggle', 'hero-paused')).toBe(false);
  expect(takesDirectionalFocus('pagePrev', 'continue')).toBe(false);
  expect(takesDirectionalFocus('pageNext', 'continue')).toBe(false);
});

test('content actions remain directional focus stops', () => {
  expect(takesDirectionalFocus('play', 'movie')).toBe(true);
  expect(takesDirectionalFocus('navigate', 'details')).toBe(true);
  expect(takesDirectionalFocus('toggle', 'menu')).toBe(true);
});

test('row headings are pointer-only and the final See all card takes focus', () => {
  expect(rowLinkTakesDirectionalFocus(false)).toBe(false);
  expect(rowLinkTakesDirectionalFocus(true)).toBe(true);
});
