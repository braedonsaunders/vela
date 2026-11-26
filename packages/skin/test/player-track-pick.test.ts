import { expect, test } from 'bun:test';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { settlePick } from '../src/widgets/player/present';

// Version A plays file a; the switch to version B plays file b at the next source generation.
const planOf = (source: string | undefined, generation: number) => ({
  sessionId: 's1', sourceGeneration: generation, seekGeneration: 0, selectedPathId: 'p',
  paths: [{ id: 'p', ...(source ? { sourceId: source } : {}) }],
}) as unknown as PlaybackPlan;
const report = (generation: number, more: Partial<Snapshot>) =>
  ({ sessionId: 's1', sourceGeneration: generation, seekGeneration: 0, audioTrackId: '1', subtitleTrackId: null, ...more }) as Snapshot;
const a = planOf('a', 0), b = planOf('b', 1);
const offOnA = { sessionId: 's1', source: 'a', trackId: null };

test('an Off chosen on version A is not confirmed by version B reporting its own Off after the switch', () => {
  expect(settlePick(offOnA, 'subtitle', report(1, { subtitleTrackId: null }), b)).toBe('drop');
});

test('with version B published before the switch reply, B\'s Off report does not confirm A\'s Off either', () => {
  // The event stream shows B while the reply is outstanding: the hook already holds B's plan.
  expect(settlePick(offOnA, 'subtitle', report(1, {}), b)).toBe('drop');
  expect(settlePick({ sessionId: 's1', source: 'a', trackId: '2' }, 'audio', report(1, { audioTrackId: '2' }), b)).toBe('drop');
});

test('a pick made on version B before the switch reply arrives is confirmed by B\'s report', () => {
  expect(settlePick({ sessionId: 's1', source: 'b', trackId: null }, 'subtitle', report(1, {}), b)).toBe('confirm');
  expect(settlePick({ sessionId: 's1', source: 'b', trackId: '5' }, 'subtitle', report(1, { subtitleTrackId: '5' }), b)).toBe('confirm');
});

test('a pick on version A is confirmed by A\'s report', () => {
  expect(settlePick(offOnA, 'subtitle', report(0, {}), a)).toBe('confirm');
  expect(settlePick({ sessionId: 's1', source: 'a', trackId: '2' }, 'audio', report(0, { audioTrackId: '2' }), a)).toBe('confirm');
  // Until the player has applied it, the pick waits; a subtitle the player cannot show is dropped.
  expect(settlePick({ sessionId: 's1', source: 'a', trackId: '3' }, 'subtitle', report(0, { pendingSubtitleTrackId: '3' }), a)).toBe('wait');
  expect(settlePick({ sessionId: 's1', source: 'a', trackId: '2' }, 'audio', report(0, { audioTrackId: '1' }), a)).toBe('wait');
  expect(settlePick({ sessionId: 's1', source: 'a', trackId: '3' }, 'subtitle', report(0, { subtitleError: 'unsupported' }), a)).toBe('drop');
});

test('without a file identity on the plans, a pick is confirmed as before', () => {
  expect(settlePick({ sessionId: 's1', source: undefined, trackId: null }, 'subtitle', report(1, {}), planOf(undefined, 1))).toBe('confirm');
});
