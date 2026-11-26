// A refused start in the viewer's words. A channel or live library that cannot start says so
// with the server's reason. An unreleased title and a capacity refusal use dedicated copy.
import { catchUpErrorMessage, msg, unreleasedMessage, type PlaybackState, type StartRefusal } from '@vela/core';
import type { ChromeTarget, StartFailure, StartRetrying } from './context';
import { isLiveTarget } from './target';

export function startFailureOf(refusal: Pick<StartRefusal, 'message' | 'errorClass'> & { code?: string }, target: ChromeTarget | undefined): StartFailure {
  const capacity = refusal.errorClass === 'capacity';
  const reason = refusal.message.trim();
  if (refusal.code === 'title_unreleased') return { capacity: false, message: reason, unreleased: true };
  if (refusal.code === 'plex_streaming_cap') return { capacity, message: reason, streamingCap: true };
  // A programme from the archive: the catch-up refusals have the viewer's own words (spec C6).
  if (target?.kind === 'programme') return { capacity, message: catchUpErrorMessage(refusal.code) || reason || msg('catchUp.unavailable') };
  if (!isLiveTarget(target)) return { capacity, message: reason || msg('ui.playbackCouldnTBeStarted') };
  const kind = target?.kind === 'channel' ? 'channel' : 'live';
  return {
    capacity,
    message: reason ? msg(`player.${kind}UnavailableBecause`, { reason }) : msg(`player.${kind}Unavailable`),
  };
}

/** A start core's playback slice could not make, unless it is already asking again on the server's terms. */
export function startFailure(playback: PlaybackState, target: ChromeTarget, airDate?: string): StartFailure | null {
  if (playback.phase !== 'failed' || playback.retryAfterSeconds > 0) return null;
  const message = playback.errorCode === 'title_unreleased' && airDate ? unreleasedMessage(airDate) : playback.error;
  return startFailureOf({ message, errorClass: playback.errorClass, code: playback.errorCode }, target);
}

/**
 * A live channel whose session another owner holds (the guide's tile): the owner's refusal once it
 * gave up, or core giving up on the owner's session after its restarts. The owner still holds that
 * session's plan then, so without the second the viewer would wait on "Starting" for ever.
 */
export function ownedStartFailure(ownerFailure: StartRefusal | null, playback: PlaybackState, target: ChromeTarget): StartFailure | null {
  if (ownerFailure) return startFailureOf(ownerFailure, target);
  if (playback.target?.kind !== target.kind || playback.target.id !== target.id) return null;
  return startFailure(playback, target);
}

/** A refused start core asks again for, on the server's terms. */
export function startRetrying(playback: PlaybackState): StartRetrying | null {
  if (playback.phase !== 'failed' || playback.retryAfterSeconds <= 0) return null;
  return { seconds: playback.retryAfterSeconds, message: playback.error };
}
