// The scrub bubble (time and trickplay frame) sits centred over its target but never past
// either end of the timeline.
import { expect, test } from 'bun:test';
import { bubbleLeft } from '../src/widgets/player/present';

test('the bubble centres on its target and stays over the timeline at both ends', () => {
  expect(bubbleLeft(0.5, 1000, 176)).toBe(412);
  expect(bubbleLeft(0.01, 1000, 176)).toBe(0);
  expect(bubbleLeft(0.99, 1000, 176)).toBe(824);
  // A timeline narrower than the bubble starts it at the timeline's start.
  expect(bubbleLeft(0.5, 100, 176)).toBe(0);
  expect(bubbleLeft(0.5, 0, 176)).toBe(0);
});
