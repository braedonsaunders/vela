import { expect, test } from 'bun:test';
import { backToLiveLeft } from '../src/widgets/player/live-focus';

test('Back to live hands its focus on once its own press has taken the picture to the edge', () => {
  // Pressed, it gives way to the LIVE mark: focus goes to the play toggle.
  expect(backToLiveLeft(true, false)).toBe(true);
  // Pressed, still on offer (the engine has not got there yet): nothing moves.
  expect(backToLiveLeft(true, true)).toBe(false);
  // Never pressed (the picture caught up by itself, or focus is elsewhere): nothing moves.
  expect(backToLiveLeft(false, false)).toBe(false);
});
