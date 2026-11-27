// How often the player chrome redraws for the engine's snapshots. The engine reports four times a
// second while it plays, and each report redrew the whole chrome (its buttons, icons and menus):
// on a TV box that kept the JS thread busy enough that the remote's presses waited. What the
// viewer reads off the clock (the timeline, the elapsed and remaining time) moves in whole seconds,
// so a report that only moves the clock is drawn at most once a second; any other change (playing
// or paused, waiting, a seek, tracks, a failure) is drawn as it arrives. The session still hands
// every report to core and keeps the latest position for its own logic.
import type { Snapshot } from '@vela/player-api';

/** Snapshot fields that change as the media plays, without anything the viewer did or should see at once. */
export const CLOCK_FIELDS: readonly (keyof Snapshot)[] = [
  'position', 'duration', 'playable', 'bufferAheadSeconds', 'loadProgress', 'throughputHistory',
  'throughputBps', 'currentBitrateBps', 'requiredBandwidthBps', 'droppedFrames', 'totalFrames',
  'diagnostics', 'live',
];

/** What React Native's event adds to a native view's report: never a fact. */
const EVENT_FIELDS = ['timeStamp', 'target'];

/** The clock's redraw interval while nothing else changes. */
export const CLOCK_REDRAW_MS = 1000;

/** Everything in a snapshot except its clock, as one comparable string. */
export function snapshotFacts(snapshot: Snapshot): string {
  const facts: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(snapshot)) {
    if (!(CLOCK_FIELDS as readonly string[]).includes(key) && !EVENT_FIELDS.includes(key)) facts[key] = value;
  }
  return JSON.stringify(facts);
}

export interface Paced { facts: string; at: number }

/** What to remember if `next` should be drawn now, given what was last drawn (null: nothing
 * yet), else null: the report waits for the clock's next redraw. */
export function paceSnapshot(last: Paced | null, next: Snapshot, now: number, redrawMs = CLOCK_REDRAW_MS): Paced | null {
  const facts = snapshotFacts(next);
  if (!last || facts !== last.facts || now - last.at >= redrawMs) return { facts, at: now };
  return null;
}

/** The clock's redraw interval while the chrome rests out of sight on a title (nothing of it shows the clock). */
export const QUIET_CLOCK_REDRAW_MS = 10_000;

/**
 * How often the clock is drawn. While the chrome stands (or a menu or the info card shows), every second.
 * While it rests over a title, only what appears at a position is drawn from the clock: a skip button inside
 * an intro or credits range, the end of the title. So: every second within reach of a skip range (or inside
 * one) or of the end, otherwise every QUIET_CLOCK_REDRAW_MS. A live or archive picture keeps every second
 * (its delivery notices and timeline read the clock). Any other change is drawn at once regardless.
 */
export function clockRedrawMs(watch: { quiet: boolean; live: boolean; position: number; duration: number | null;
  markers?: readonly { startSeconds: number; endSeconds: number }[] }): number {
  if (!watch.quiet || watch.live) return CLOCK_REDRAW_MS;
  const reach = QUIET_CLOCK_REDRAW_MS / 1000 + 1;
  const near = (seconds: number) => seconds - watch.position <= reach && watch.position - seconds <= 1;
  const inside = (m: { startSeconds: number; endSeconds: number }) => watch.position >= m.startSeconds - 1 && watch.position <= m.endSeconds + 1;
  if (watch.markers?.some(m => inside(m) || near(m.startSeconds) || near(m.endSeconds))) return CLOCK_REDRAW_MS;
  if (watch.duration && watch.duration - watch.position <= reach) return CLOCK_REDRAW_MS;
  return QUIET_CLOCK_REDRAW_MS;
}

/** The report to draw: `next`'s clock over the drawn report's facts, when its facts are the same (`same`),
 * so that what is derived from them (track lists, the quality menu, the info card's format lines) keeps
 * its identity and is not worked out again every second. */
export function withClock(drawn: Snapshot | null, next: Snapshot, same: boolean): Snapshot {
  if (!drawn || !same) return next;
  const shown = { ...drawn } as Record<string, unknown>;
  const source = next as unknown as Record<string, unknown>;
  for (const key of CLOCK_FIELDS) {
    if (key in source) shown[key] = source[key];
    else delete shown[key];
  }
  return shown as unknown as Snapshot;
}
