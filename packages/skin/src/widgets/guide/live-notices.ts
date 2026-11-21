// What a playing channel tells the viewer about its delivery: reconnecting, a delayed or missing
// segment, or a real lag behind the live edge. Latency is automatic; being a few seconds short of
// the newest segment is how live plays, never a notice. Pure, for the player chrome and tests.
import { msg, number } from '@vela/core';
import type { Snapshot } from '@vela/player-api';

type LiveSnapshot = NonNullable<Snapshot['live']>;

/** Whole seconds behind the live edge, when the engine says playback can catch up. Engines report
 * only a real lag here (beyond their latency target); the normal distance from the edge is 0. */
export function liveBehind(live: LiveSnapshot | null): number {
  if (!live || !live.canCatchUp || live.driftSeconds === null || !Number.isFinite(live.driftSeconds)) return 0;
  return Math.max(0, Math.round(live.driftSeconds));
}

const DELIVERY: Partial<Record<LiveSnapshot['delivery'], string>> = {
  'upstream-gap': 'live.gap',
  'segment-delayed': 'live.delayed',
  'waiting-for-publication': 'live.publication',
};

/** What the viewer should be told about the channel's delivery, most pressing first; empty while
 * it plays normally at its usual distance from the edge. */
export function liveNotices(live: LiveSnapshot | null): string[] {
  if (!live) return [];
  const notices: string[] = [];
  if (live.reconnecting) notices.push(msg('live.reconnecting'));
  const delivery = DELIVERY[live.delivery];
  if (delivery) notices.push(msg(delivery));
  const behind = liveBehind(live);
  if (behind > 0) notices.push(msg('live.behind', { seconds: number(behind) }));
  return notices;
}

/** Whether the channel is in a state the viewer should see (a small notice stays while the rest
 * of the chrome rests; it never holds the chrome up). */
export function liveNeedsAttention(live: LiveSnapshot | null): boolean {
  return liveNotices(live).length > 0;
}
