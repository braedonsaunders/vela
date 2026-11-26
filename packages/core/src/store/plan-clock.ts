import type * as V from '../wire';

/** Plan fields that only report the server's clock: its reading of the position, and the revision
 * that came with that reading. */
const CLOCK = new Set(['positionSeconds', 'revision']);

/** Whether `next` (the same session) differs from the plan on show only in the server's clock. A
 * following server sends the plan again about once a second while a title plays; the engine keeps
 * its own clock, so such a plan changes nothing anyone draws or plays. */
export function onlyClockMoved(shown: V.PlaybackPlan, next: V.PlaybackPlan): boolean {
  if (shown === next) return true;
  if (shown.sessionId !== next.sessionId) return false;
  const a = shown as unknown as Record<string, unknown>;
  const b = next as unknown as Record<string, unknown>;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (CLOCK.has(key) || a[key] === b[key]) continue;
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false;
  }
  return true;
}
