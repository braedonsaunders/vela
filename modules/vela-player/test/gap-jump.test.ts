import { expect, test } from 'bun:test';
import { gapJump, TINY_GAP_SECONDS } from '../web/engine/gap-jump';

test('a live start jumps the hole in front of its first media, however wide', () => {
  // The lab, November 2026: the playlist put the first segment at 0 s; its media began at 5 s.
  expect(gapJump(0, [{ start: 5, end: 29.976 }], true)).toBeCloseTo(5.01, 5);
  expect(gapJump(712, [{ start: 750, end: 790 }], true)).toBeCloseTo(750.01, 5);
});

test('once played, only a tiny hole is stepped over; a wide one is left to visible recovery', () => {
  expect(gapJump(10, [{ start: 10 + TINY_GAP_SECONDS - 0.05, end: 20 }], false)).toBeCloseTo(10.21, 5);
  expect(gapJump(10, [{ start: 15, end: 20 }], false)).toBeNull();
});

test('a playhead inside (or at the edge of) buffered media stays where it is', () => {
  expect(gapJump(6, [{ start: 5, end: 30 }], true)).toBeNull();
  expect(gapJump(4.99, [{ start: 5, end: 30 }], true)).toBeNull();
  // Nothing ahead: still loading, nothing to jump to.
  expect(gapJump(40, [{ start: 5, end: 30 }], true)).toBeNull();
  expect(gapJump(0, [], true)).toBeNull();
});

test('the nearest media ahead is the one jumped to', () => {
  const ranges = [{ start: 60, end: 70 }, { start: 20, end: 30 }, { start: 2, end: 4 }];
  expect(gapJump(10, ranges, true)).toBeCloseTo(20.01, 5);
});

test('a tiny hole is stepped over from just short of the range before it', () => {
  // Seen on the mock: the playhead stopped at 1444.89, the next range began at 1445 after 1444.95.
  const ranges = [{ start: 1440.96, end: 1444.95 }, { start: 1445, end: 1480.95 }];
  expect(gapJump(1444.89, ranges, false)).toBeCloseTo(1445.01, 5);
  expect(gapJump(1444.89, ranges, true)).toBeCloseTo(1445.01, 5);
  // Well inside a range, with the next one far ahead: nothing to do, live start or not.
  expect(gapJump(1442, ranges, true)).toBeNull();
});
