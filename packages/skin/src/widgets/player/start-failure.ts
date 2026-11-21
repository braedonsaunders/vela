// A refused start in the viewer's words. A channel or live library that cannot start says so
// ("This channel isn't available right now: …") with the server's reason; a title keeps the
// server's message as it is. All streams in use stays a capacity failure (its own copy).
import { msg, type PlaybackState, type StartRefusal } from '@vela/core';
import type { ChromeTarget, StartFailure, StartRetrying } from './context';
import { isLiveTarget } from './target';

export function startFailureOf(refusal: Pick<StartRefusal, 'message' | 'errorClass'>, target: ChromeTarget | undefined): StartFailure {
  const capacity = refusal.errorClass === 'capacity';
  const reason = refusal.message.trim();
  if (!isLiveTarget(target)) return { capacity, message: reason || msg('ui.playbackCouldnTBeStarted') };
  const kind = target?.kind === 'channel' ? 'channel' : 'live';
  return {
    capacity,
    message: reason ? msg(`player.${kind}UnavailableBecause`, { reason }) : msg(`player.${kind}Unavailable`),
  };
}

/** A start core's playback slice could not make, unless it is already asking again on the server's terms. */
export function startFailure(playback: PlaybackState, target: ChromeTarget): StartFailure | null {
  if (playback.phase !== 'failed' || playback.retryAfterSeconds > 0) return null;
  return startFailureOf({ message: playback.error, errorClass: playback.errorClass }, target);
}

/** A refused start core asks again for, on the server's terms. */
export function startRetrying(playback: PlaybackState): StartRetrying | null {
  if (playback.phase !== 'failed' || playback.retryAfterSeconds <= 0) return null;
  return { seconds: playback.retryAfterSeconds, message: playback.error };
}
