import { expect, test } from 'bun:test';
import { shouldRefocusSearch } from '../src/widgets/search/focus-policy';

test('the action and following press.focus do not blur a newly focused search field', () => {
  expect(shouldRefocusSearch(false, -Infinity, 1000)).toBe(false);
  expect(shouldRefocusSearch(true, 1000, 1016)).toBe(false);
});

test('a later header search can reopen a keyboard dismissed with Android Back', () => {
  expect(shouldRefocusSearch(true, 1000, 2000)).toBe(true);
  expect(shouldRefocusSearch(false, 1000, 2000)).toBe(false);
});
