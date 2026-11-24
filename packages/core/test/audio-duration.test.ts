import { expect, test } from 'bun:test';
import { shownDuration } from '../src/store/audio';

// The bar's length for the playing item: the plan's, refined by the engine that reads the file.

test("a live transcode's growing length never replaces the plan's", () => {
  // An <audio> element on Ether's stream.m4a while it is produced: 5 s, then 10 s of a 324.5 s track.
  expect(shownDuration(5, 324.5)).toBe(324.5);
  expect(shownDuration(10.02, 324.5)).toBe(324.5);
  expect(shownDuration(Infinity, 324.5)).toBe(324.5);
  expect(shownDuration(Number.NaN, 324.5)).toBe(324.5);
  expect(shownDuration(0, 324.5)).toBe(324.5);
});

test("the engine's own reading of a whole file refines the plan's, also when the plan has none", () => {
  // The gapless player's trim of the 29.85 s Curtains Up skit.
  expect(shownDuration(29.8267, 29.85)).toBe(29.8267);
  expect(shownDuration(325.1, 324.5)).toBe(325.1);
  expect(shownDuration(48, 0)).toBe(48);
  expect(shownDuration(0, 0)).toBe(0);
});
