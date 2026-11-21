import { expect, test } from 'bun:test';
import { behindLive, liveLag } from '../web/engine/live-behind';

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

test('lag is measured past the latency target, and not before playback is inside the window', () => {
  expect(liveLag(1416, 1368, 6, 1400)).toBe(10);
  expect(liveLag(1416, 1368, 6, 1412)).toBe(0);
  // Starting or recovering: position 0 is where the engine is about to leave, not 1,404 s of lag.
  expect(liveLag(1416, 1368, 6, 0)).toBeNull();
  expect(liveLag(null, null, 6, 10)).toBeNull();
  expect(liveLag(1416, null, 6, Number.NaN)).toBeNull();
  expect(liveLag(1416, null, 6, 1390)).toBe(20);
});
