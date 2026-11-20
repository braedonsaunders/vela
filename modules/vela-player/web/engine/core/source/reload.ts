const MINIMUM_RELOAD_MS = 500,
  MAXIMUM_RELOAD_MS = 60000;

/** Live reload cadence. A changed window follows its newest segment duration;
 * an unchanged window retries at half target duration. Both are bounded to
 * avoid tight invalid-manifest loops and excessively stale publication. */
export function livePlaylistReloadDelayMs(
  targetDuration: number,
  lastSegmentDuration: number | null,
  changed: boolean,
): number {
  const seconds = changed && lastSegmentDuration && lastSegmentDuration > 0
    ? lastSegmentDuration
    : targetDuration * (changed ? 1 : 0.5);
  if (!Number.isFinite(seconds) || seconds <= 0) return MINIMUM_RELOAD_MS;
  return Math.max(MINIMUM_RELOAD_MS, Math.min(MAXIMUM_RELOAD_MS, seconds * 1000));
}
