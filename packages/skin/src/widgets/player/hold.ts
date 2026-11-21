// When the player chrome may rest (idle.ts hides it after a few quiet seconds otherwise).
import type { Snapshot } from '@vela/player-api';

export interface HoldState {
  /** The engine's state for the playing plan (present.ts). */
  state: Snapshot['state'];
  /** This session has played at least once: a later wait is a stall, not a start. */
  started: boolean;
  menuOpen: boolean;
  /** A scrub or a volume drag. */
  active: boolean;
  failed: boolean;
}

/**
 * What keeps the chrome standing: the viewer working it, playback stopped (paused, ended or
 * failed), or a session that has yet to play. A stall once playing (buffering, recovering, a new
 * generation loading) does not: the spinner says so on its own, and holding would bring the whole
 * overlay back at every hiccup and restart its idle clock, so it could never rest on a channel
 * that stalls every few seconds. A live channel's delivery notices are not a hold either; they
 * show by themselves (LiveNotice) while the chrome rests, so a channel hides like a film.
 */
export function holdsChrome(s: HoldState): boolean {
  if (s.failed || s.menuOpen || s.active) return true;
  if (s.state === 'paused' || s.state === 'ended' || s.state === 'failed') return true;
  return !s.started && s.state !== 'playing';
}
