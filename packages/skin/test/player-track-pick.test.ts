import { expect, test } from 'bun:test';
import type { PlaybackPlan, Snapshot } from '@vela/player-api';
import { planSource, settlePick } from '../src/widgets/player/present';

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

test('without a source id, the version id tells the files apart', () => {
  // Version A and version B name no source; the server says which version each plan plays.
  const version = (selected: string, generation: number, playing?: string | null) => ({ ...planOf(undefined, generation), selectedVersionId: selected,
    ...(playing !== undefined ? { playingVersionId: playing } : {}) }) as PlaybackPlan;
  const onA = version('va', 0), onB = version('vb', 1);
  const off = { sessionId: 's1', source: planSource(onA), trackId: null };
  expect(settlePick(off, 'subtitle', report(1, {}), onB)).toBe('drop');
  expect(settlePick(off, 'subtitle', report(0, {}), onA)).toBe('confirm');
  // With Auto chosen the selected version stays the same; the release playing is the file.
  const auto = { sessionId: 's1', source: planSource(version('auto', 0, 'r1')), trackId: null };
  expect(settlePick(auto, 'subtitle', report(1, {}), version('auto', 1, 'r2'))).toBe('drop');
});

test('a plan without paths names its file by its version, or by nothing, and does not throw', () => {
  const noPaths = (more: Partial<PlaybackPlan>) => ({ sessionId: 's1', sourceGeneration: 0, seekGeneration: 0, ...more }) as unknown as PlaybackPlan;
  expect(planSource(noPaths({ selectedVersionId: 'va' }))).toBe('va');
  expect(planSource(noPaths({}))).toBeUndefined();
  expect(settlePick({ sessionId: 's1', source: undefined, trackId: '2' }, 'audio', report(0, { audioTrackId: '2' }), noPaths({}))).toBe('confirm');
});
