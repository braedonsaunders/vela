// Where the playhead goes when it sits in front of buffered media it cannot reach.
//
// A rounding hole between fragments (up to TINY_GAP_SECONDS) is always stepped over. Until a live
// stream has first played, a hole of any size is jumped too: a relay that starts from its backlog
// can publish media whose timestamps begin later than its playlist says (Ether, November 2026: the
// first segment, listed at 0 s, carried 5 s), and a playhead left at the playlist's time waits in
// front of that hole for ever while the buffer fills beyond it. Later holes stay visible: the
// stall policy recovers them.

export const TINY_GAP_SECONDS = 0.25;
/** Inside a range (or this close to its start) the playhead can play on. */
const NEAR_SECONDS = 0.02;
/** Land just inside the range, past any rounding at its edge. */
const LAND_SECONDS = 0.01;

export interface MediaRange {
  start: number;
  end: number;
}

export function timeRanges(ranges: TimeRanges): MediaRange[] {
  return Array.from({ length: ranges.length }, (_, i) => ({ start: ranges.start(i), end: ranges.end(i) }));
}

/** Media ahead across the same rounding gaps that playback can step over. */
export function playableBufferAhead(currentTime: number, ranges: readonly MediaRange[]): number {
  let end = currentTime;
  // TimeRanges are ordered by start time.
  for (const range of ranges) {
    if (range.end <= end) continue;
    if (range.start - end > TINY_GAP_SECONDS) break;
    end = range.end;
  }
  return end - currentTime;
}

/**
 * The time to move the playhead to, or null where it is (or should stay). A tiny hole is stepped
 * over even from inside the range before it: a playhead a few frames short of a range's end stalls
 * there, in front of the next one.
 */
export function gapJump(currentTime: number, ranges: readonly MediaRange[], liveStarting: boolean): number | null {
  const ahead = ranges.filter((r) => r.start > currentTime).sort((a, b) => a.start - b.start)[0];
  if (!ahead) return null;
  const gap = ahead.start - currentTime;
  if (gap > NEAR_SECONDS && gap <= TINY_GAP_SECONDS) return ahead.start + LAND_SECONDS;
  const buffered = ranges.some((r) => currentTime >= r.start - NEAR_SECONDS && currentTime < r.end);
  return liveStarting && !buffered && gap > TINY_GAP_SECONDS ? ahead.start + LAND_SECONDS : null;
}

/** Land an intentional live seek only when the destination has a frame beyond it. */
export function liveSeekLanding(target: number, ranges: readonly MediaRange[]): { position: number; bufferedEnd: number } | null {
  for (const range of ranges) {
    if (range.start - target > TINY_GAP_SECONDS) continue;
    const position = target < range.start ? range.start + LAND_SECONDS : target;
    // A muxed fragment can end a few frames before its advertised end. Wait for
    // the next fragment rather than seeking into that gap and snapping to the old live buffer.
    if (position + 0.05 < range.end) return { position, bufferedEnd: range.end };
  }
  return null;
}
