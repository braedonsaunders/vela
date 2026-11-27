import { describe, expect, test } from 'bun:test';
import type { Snapshot } from '@vela/player-api';
import { CLOCK_REDRAW_MS, QUIET_CLOCK_REDRAW_MS, clockMoved, clockRedrawMs, paceSnapshot, snapshotFacts, withClock } from '../src/widgets/player/snapshot-pace';
import { present } from '../src/widgets/player/present';

const drawSnapshot = (last: Parameters<typeof paceSnapshot>[0], next: Snapshot, now: number) => paceSnapshot(last, next, now) !== null;

const snapshot = (fields: Partial<Snapshot>): Snapshot => ({
  sessionId: 's', sourceGeneration: 1, seekGeneration: 1, state: 'playing', waiting: false, seekTarget: null,
  position: 10, duration: 600, playable: [{ start: 0, end: 30 }], audioTrackId: 'a1', subtitleTrackId: null,
  throughputHistory: [], volume: 1, muted: false, ...fields,
}) as unknown as Snapshot;

describe('player chrome snapshot pacing', () => {
  test('the first snapshot is drawn, and remembered with its time', () => {
    const first = snapshot({});
    expect(paceSnapshot(null, first, 5)).toEqual({ facts: snapshotFacts(first), at: 5 });
  });

  test('a report that only moves the clock waits for the next second', () => {
    const last = { facts: snapshotFacts(snapshot({ position: 10 })), at: 1000 };
    const moved = snapshot({ position: 10.25, playable: [{ start: 0, end: 31 }], throughputHistory: [5e6] });
    expect(drawSnapshot(last, moved, 1250)).toBe(false);
    expect(drawSnapshot(last, moved, 1000 + CLOCK_REDRAW_MS)).toBe(true);
  });

  test('anything the viewer did or must see is drawn at once', () => {
    const last = { facts: snapshotFacts(snapshot({})), at: 1000 };
    expect(drawSnapshot(last, snapshot({ state: 'paused' }), 1010)).toBe(true);
    expect(drawSnapshot(last, snapshot({ waiting: true }), 1010)).toBe(true);
    expect(drawSnapshot(last, snapshot({ seekTarget: 70, seekGeneration: 2 }), 1010)).toBe(true);
    expect(drawSnapshot(last, snapshot({ subtitleTrackId: 's2' }), 1010)).toBe(true);
    expect(drawSnapshot(last, snapshot({ failure: { kind: 'network', message: 'x', recoverable: true } } as Partial<Snapshot>), 1010)).toBe(true);
  });

  test('the facts leave out the clock, so equal facts compare equal across ticks', () => {
    expect(snapshotFacts(snapshot({ position: 1 }))).toBe(snapshotFacts(snapshot({ position: 2, duration: 601 })));
    // The native event's own stamp changes with every report.
    const stamped = (stamp: number) => ({ ...snapshot({ totalFrames: stamp }), timeStamp: stamp }) as unknown as Snapshot;
    expect(snapshotFacts(stamped(1))).toBe(snapshotFacts(stamped(2)));
    expect(snapshotFacts(snapshot({ volume: 1 }))).not.toBe(snapshotFacts(snapshot({ volume: 0.5 })));
  });

  test('a redraw for the clock keeps the drawn facts (same objects) under the new clock', () => {
    const tracks = [{ id: 'a1', label: 'English', language: 'en' }];
    const drawn = snapshot({ audioTracks: tracks, format: { video: { codec: 'hevc' } } } as unknown as Partial<Snapshot>);
    const next = snapshot({ position: 11, playable: [{ start: 0, end: 32 }], audioTracks: [{ id: 'a1', label: 'English', language: 'en' }],
      format: { video: { codec: 'hevc' } } } as unknown as Partial<Snapshot>);
    const shown = withClock(drawn, next, snapshotFacts(drawn) === snapshotFacts(next));
    expect(shown.position).toBe(11);
    expect(shown.playable).toEqual([{ start: 0, end: 32 }]);
    expect(shown.audioTracks).toBe(drawn.audioTracks);
    expect(snapshotFacts(shown)).toBe(snapshotFacts(next));
    // A change of facts draws the new report as it is.
    expect(withClock(drawn, snapshot({ state: 'paused' }), false).state).toBe('paused');
    expect(withClock(null, next, true)).toBe(next);
  });

  test('the chrome\'s menus keep their rows while only the clock moves', () => {
    const plan = { sessionId: 's', sourceGeneration: 1, seekGeneration: 1, selectedPathId: 'p', paths: [], audioTracks: [{ id: 'a1', name: 'English' }],
      subtitleTracks: [], chapters: [], positionSeconds: 0 } as never;
    const first = snapshot({ audioTracks: [], subtitleTracks: [], renditions: [], capabilities: { pip: false, fullscreen: false, audioSwitch: true } } as unknown as Partial<Snapshot>);
    const a = present(plan, first);
    const b = present(plan, withClock(first, snapshot({ position: 12, audioTracks: [], subtitleTracks: [], renditions: [], capabilities: { pip: false, fullscreen: false, audioSwitch: true } } as unknown as Partial<Snapshot>), true));
    expect(b.position).toBe(12);
    expect(b.audio).toBe(a.audio);
    expect(b.qualities).toBe(a.qualities);
  });
});

describe('the clock out of sight', () => {
  const at = (position: number, extra: Partial<Parameters<typeof clockRedrawMs>[0]> = {}) =>
    clockRedrawMs({ quiet: true, live: false, position, duration: 6000, markers: [{ startSeconds: 100, endSeconds: 160 }], ...extra });
  test('a resting chrome over a title draws the clock rarely, except near a skip range or the end', () => {
    expect(at(30)).toBe(QUIET_CLOCK_REDRAW_MS);
    expect(at(92)).toBe(CLOCK_REDRAW_MS);
    expect(at(130)).toBe(CLOCK_REDRAW_MS);
    expect(at(161)).toBe(CLOCK_REDRAW_MS);
    expect(at(175)).toBe(QUIET_CLOCK_REDRAW_MS);
    expect(at(5992)).toBe(CLOCK_REDRAW_MS);
  });
  test('a standing chrome, a menu or a live picture draws every second', () => {
    expect(at(30, { quiet: false })).toBe(CLOCK_REDRAW_MS);
    expect(at(30, { live: true })).toBe(CLOCK_REDRAW_MS);
  });
});

test('a paused title\'s reports with the clock where it was draw nothing new', () => {
  const drawn = snapshot({ state: 'paused', position: 40, playable: [{ start: 40, end: 70 }] });
  expect(clockMoved(drawn, snapshot({ state: 'paused', position: 40, playable: [{ start: 40, end: 70 }] }))).toBe(false);
  expect(clockMoved(drawn, snapshot({ state: 'paused', position: 40, playable: [{ start: 40, end: 72 }] }))).toBe(true);
  expect(clockMoved(drawn, snapshot({ position: 41, playable: [{ start: 41, end: 70 }] }))).toBe(true);
  expect(clockMoved(null, drawn)).toBe(true);
});

test('the server\'s reason for no adaptive path reads as its own words, a bare code as a plain line', async () => {
  const { adaptiveUnavailableText } = await import('../src/widgets/player/present');
  expect(adaptiveUnavailableText(undefined)).toBe('');
  expect(adaptiveUnavailableText('  ')).toBe('');
  expect(adaptiveUnavailableText('The source has no regular keyframes')).toBe('The source has no regular keyframes');
  expect(adaptiveUnavailableText('keyframe_grid')).toBe("Automatic quality isn't available for this title");
});

test('the localized message comes before the reason code', async () => {
  const { adaptiveUnavailableText } = await import('../src/widgets/player/present');
  expect(adaptiveUnavailableText('keyframe_grid', 'Las calidades automáticas no están disponibles')).toBe('Las calidades automáticas no están disponibles');
});
