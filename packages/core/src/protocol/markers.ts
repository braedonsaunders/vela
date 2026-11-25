// Skip markers (protocol README, "Skip markers"): the intro and credits ranges a plan carries, and
// the one the position is inside. Adapters that read ranges from a server of another kind (Plex
// markers, Jellyfin media segments) shape them here, so every plan carries them the same way.
import type { SkipMarker } from '../wire';

/** Credits ending this close to the end of the title run to its end (the tail credits). */
const TAIL_SECONDS = 2;

/**
 * Ranges as a plan carries them: intro and credits only, well formed, sorted by start, `final` on
 * the last credits alone (when flagged, or when they end at the end of the title). Undefined when
 * none are left: the field is omitted rather than empty.
 */
export function skipMarkers(ranges: readonly SkipMarker[], durationSeconds?: number): SkipMarker[] | undefined {
  const end = durationSeconds && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  const kept = ranges
    .filter(r => (r.kind === 'intro' || r.kind === 'credits') && Number.isFinite(r.startSeconds) && Number.isFinite(r.endSeconds) && r.startSeconds >= 0 && r.startSeconds < end)
    .map(r => ({ kind: r.kind, startSeconds: r.startSeconds, endSeconds: Math.min(r.endSeconds, end), final: r.final === true }))
    .filter(r => r.endSeconds > r.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  if (!kept.length) return undefined;
  let last = -1;
  kept.forEach((r, i) => { if (r.kind === 'credits') last = i; });
  return kept.map(({ final, ...r }, i) => {
    const tail = i === last && (final || (Number.isFinite(end) && r.endSeconds >= end - TAIL_SECONDS));
    return tail ? { ...r, final: true } : r;
  });
}

/** The range the position is inside, or null. */
export function markerAt(markers: readonly SkipMarker[] | undefined, seconds: number): SkipMarker | null {
  if (!markers || !Number.isFinite(seconds)) return null;
  return markers.find(m => seconds >= m.startSeconds && seconds < m.endSeconds) ?? null;
}

/** What the player's skip button does here: skip to a range's end, or start the next episode. */
export type SkipAction = { kind: 'intro' | 'credits'; toSeconds: number } | { kind: 'next' };

/**
 * The skip button's action at a position, or null outside every range: Skip intro or Skip credits
 * seek to the range's end; the final credits of an episode with a next one start that episode.
 */
export function skipAction(markers: readonly SkipMarker[] | undefined, seconds: number, hasNext: boolean): SkipAction | null {
  const marker = markerAt(markers, seconds);
  if (!marker) return null;
  if (marker.kind === 'credits' && marker.final && hasNext) return { kind: 'next' };
  return { kind: marker.kind, toSeconds: marker.endSeconds };
}
