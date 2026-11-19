import { PlaybackFault } from '../pipeline';
import type { HostContext } from './state';
import { emitHostEvent } from './events';
import { failPlayback, recoverPlayback, readRetries } from './recovery';
import { readPosition, readFrameMetrics } from './position';
export function checkWaiting(context: HostContext) {
  if (context.tracks.pendingTracks && performance.now() - context.tracks.pendingTracks.startedAt > 15000) {
    if (context.tracks.pendingTracks.subtitle !== undefined)
      context.tracks.subtitlePreference = context.tracks.pendingTracks.previousSubtitlePreference;
    context.tracks.pendingTracks = undefined;
    context.tracks.deferredPath = null;
    emitHostEvent(context, {
      type: 'error',
      failure: { kind: 'action', message: 'Track selection authorization timed out', recoverable: true },
    });
  }
  if (
    context.session.pendingSeek &&
    !context.session.pendingSeek.authorized &&
    performance.now() - context.session.pendingSeek.startedAt > 15000
  ) {
    failPlayback(context, { kind: 'network', message: 'Seek authorization timed out', recoverable: true });
    return;
  }
  if (context.session.pendingSwitch && performance.now() - context.session.pendingSwitch.startedAt > 15000) {
    context.session.pendingSwitch = undefined;
    failPlayback(context, {
      kind: 'network',
      message: 'Source switch authorization timed out',
      recoverable: true,
    });
    return;
  }
  if (
    !context.session.current ||
    !context.media.source ||
    !context.playback.wantsPlay ||
    ['failed', 'ended', 'recovering'].includes(context.playback.status)
  )
    return;
  const now = performance.now();
  if (recordPlaybackProgress(context, now)) return;
  if (context.media.runtime?.implementation === 'vela-core' && context.media.runtime.startupPending) return;
  const expired = !context.watchdog.everPlayed
    ? now - context.watchdog.waitSince > context.watchdog.startupDeadlineMs
    : now - context.watchdog.lastAdvance > 30000;
  if (expired)
    void recoverPlayback(
      context,
      new PlaybackFault(
        context.watchdog.everPlayed
          ? 'Playback stalled for 30 seconds'
          : `Playback did not start within ${context.watchdog.startupDeadlineMs / 1000} seconds`,
        'network',
      ),
      context.session.controller.token(),
    );
}
export function recordPlaybackProgress(context: HostContext, now = performance.now()) {
  if (context.session.pendingSeek) return false;
  const position = readPosition(context);
  const decoded =
    (readFrameMetrics(context).frames ?? 0) > 0 ||
    (!context.media.runtime && context.surface.video.readyState >= 2);
  const started =
    !context.watchdog.everPlayed &&
    (context.watchdog.frameSeen ||
      (context.media.runtime?.readout.presentedFrames ?? 0) > 0 ||
      (position > context.watchdog.lastPosition && decoded));
  const advanced =
    (context.watchdog.everPlayed || decoded) &&
    position > context.watchdog.lastPosition + 0.02 &&
    (context.media.runtime ? context.playback.status === 'playing' : !context.surface.video.paused);
  if (!started && !advanced) return false;
  readRetries.get(context)?.progress(now);
  context.watchdog.everPlayed = true;
  context.watchdog.lastAdvance = now;
  context.watchdog.lastPosition = position;
  if (context.watchdog.startTimer) clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  return true;
}
export function resetProgress(context: HostContext, position: number) {
  context.watchdog.waitSince = performance.now();
  context.watchdog.lastAdvance = context.watchdog.waitSince;
  context.watchdog.lastPosition = position;
  context.watchdog.everPlayed = false;
}
