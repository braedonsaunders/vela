import { expect, test } from 'bun:test';
import { behindLive } from '../web/engine/live-behind';

test('normal live latency and segment-by-segment edge jumps never show as behind', () => {
  // Lag is measured past the latency target: a fresh segment moves it a few seconds, then it shrinks.
  for (const lag of [0, 0.3, 2, 4, 6, 9.9]) expect(behindLive(lag, false, 2)).toBe(false);
  expect(behindLive(null, false, 2)).toBe(false);
});

test('a real lag shows, and holds until playback is nearly back, so it cannot flicker', () => {
  expect(behindLive(10, false, 2)).toBe(true);
  expect(behindLive(6, true, 2)).toBe(true);
  expect(behindLive(3.5, true, 2)).toBe(true);
  expect(behindLive(3, true, 2)).toBe(false);
});

test('long segments raise the threshold to two segments', () => {
  expect(behindLive(10, false, 6)).toBe(false);
  expect(behindLive(12, false, 6)).toBe(true);
});
