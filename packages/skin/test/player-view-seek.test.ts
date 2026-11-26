import { expect, test } from 'bun:test';
import { restartAt } from '../src/widgets/player/present';

test('Try again and a return to the foreground start again at a zero the player presented', () => {
  // A Start Over to 0 s, confirmed and reported paused, on a title opened with a 1800 s resume point.
  expect(restartAt(0, true)).toBe(0);
  // A zero reported while loading is a reset clock: the title's own start point stands.
  expect(restartAt(0, false)).toBeUndefined();
  expect(restartAt(1815, false)).toBe(1815);
});
