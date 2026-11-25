import { expect, test } from 'bun:test';
import { opensAtTop, pinOpeningScroll } from '../src/opening-scroll';

test('title and plugin-screen details open at the top', () => {
  expect(opensAtTop('title')).toBe(true);
  expect(opensAtTop('screen')).toBe(true);
  expect(opensAtTop('home')).toBe(false);
  expect(opensAtTop('collection')).toBe(false);
});

test('opening scroll stays pinned only through focus settlement and before viewer input', () => {
  expect(pinOpeningScroll(1_000, 2_400, false)).toBe(true);
  expect(pinOpeningScroll(1_000, 2_401, false)).toBe(false);
  expect(pinOpeningScroll(1_000, 1_100, true)).toBe(false);
});
