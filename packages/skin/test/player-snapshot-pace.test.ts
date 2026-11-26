import { describe, expect, test } from 'bun:test';
import type { Snapshot } from '@vela/player-api';
import { CLOCK_REDRAW_MS, paceSnapshot, snapshotFacts } from '../src/widgets/player/snapshot-pace';

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
});
