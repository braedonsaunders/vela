import { expect, test } from 'bun:test';
import { onlyClockMoved } from '../src/store/plan-clock';
import type { PlaybackPlan } from '../src/wire';

const plan = (extra: Partial<PlaybackPlan> = {}) => ({
  sessionId: 's1', revision: 4, state: 'playing', positionSeconds: 120, sourceGeneration: 1, seekGeneration: 1,
  audioTracks: [{ id: 'a1' }], subtitleTracks: [], selectedAudioTrackId: 'a1', ...extra,
} as unknown as PlaybackPlan);

test('a plan that only moves the server\'s clock is the same plan to show', () => {
  expect(onlyClockMoved(plan(), plan({ positionSeconds: 121, revision: 5 }))).toBe(true);
  // Equal content in new objects (the event stream decodes every plan afresh).
  expect(onlyClockMoved(plan(), plan({ audioTracks: [{ id: 'a1' }] } as Partial<PlaybackPlan>))).toBe(true);
});

test('anything else, or another session, is a new plan', () => {
  expect(onlyClockMoved(plan(), plan({ state: 'paused', revision: 5 } as Partial<PlaybackPlan>))).toBe(false);
  expect(onlyClockMoved(plan(), plan({ seekGeneration: 2, positionSeconds: 600 }))).toBe(false);
  expect(onlyClockMoved(plan(), plan({ selectedAudioTrackId: 'a2' } as Partial<PlaybackPlan>))).toBe(false);
  expect(onlyClockMoved(plan(), plan({ sessionId: 's2' }))).toBe(false);
  expect(onlyClockMoved(plan(), { ...plan(), extra: true } as unknown as PlaybackPlan)).toBe(false);
});
