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
export function paceSnapshot(last: Paced | null, next: Snapshot, now: number): Paced | null {
  const facts = snapshotFacts(next);
  if (!last || facts !== last.facts || now - last.at >= CLOCK_REDRAW_MS) return { facts, at: now };
  return null;
}
