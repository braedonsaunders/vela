import type { PlaybackSession, Source } from '../model';
import type { HostContext } from './state';
import { resetProgress } from './watchdog';
import { applyServerState } from './session';
import { publishHostState } from './events';
import { recoverPlayback } from './recovery';
export function canRetainOriginal(context: HostContext, session: PlaybackSession, source: Source): boolean {
  const previous = context.session.current;
  const current = context.media.source;
  const original = context.media.runtime;
  if (
    !previous ||
    !current ||
    !original?.retainsSource ||
    !context.media.runtimeJob ||
    context.media.runtimeJob.signal.aborted ||
    session.serverState === 'ended' ||
    session.id !== previous.id ||
    session.mediaId !== previous.mediaId ||
    session.sourceGeneration !== context.session.controller.source ||
    session.seekGeneration === context.session.controller.seek ||
    // Converted HLS may reuse filenames with different bytes after a seek.
    // Only an immutable original-file reader can survive a wire seek epoch.
    !source.original ||
    source.delivery !== 'file' ||
    source.delivery !== current.delivery ||
    source.id !== current.id ||
    source.url !== current.url ||
    source.edition !== current.edition ||
    source.timeline !== current.timeline ||
    source.sourceRevision !== current.sourceRevision ||
    source.timelineOriginSeconds !== current.timelineOriginSeconds ||
    (session.subtitleTrackId ?? null) !== context.tracks.subtitle
  )
    return false;
  const identities = (tracks: PlaybackSession['audioTracks']) =>
    JSON.stringify(tracks.map((track) => [track.id, track.streamIndex]));
  if (identities(session.audioTracks) !== identities(previous.audioTracks)) return false;
  const selected =
    context.tracks.audioPreference &&
    session.audioTracks.some((track) => track.id === context.tracks.audioPreference)
      ? context.tracks.audioPreference
      : (session.audioTrackId ?? null);
  return selected === original.readout.audioTrackId;
}
export async function seekRetainedOriginal(context: HostContext, session: PlaybackSession, source: Source) {
  const original = context.media.runtime!;
  const previous = context.session.current?.serverState;
  const token = context.session.controller.start(
    session.id,
    session.sourceGeneration,
    session.seekGeneration,
  );
  context.media.runtimeGeneration = token;
  context.session.current = session;
  context.media.source = source;
  context.tracks.pendingTracks = undefined;
  context.session.pendingSwitch = undefined;
  context.session.pendingSeek = {
    position: session.position ?? 0,
    startedAt: performance.now(),
    authorized: true,
  };
  resetProgress(context, session.position ?? 0);
  context.playback.status = 'buffering';
  context.playback.failure = null;
  context.telemetry.lastObservation = -Infinity;
  applyServerState(context, session.serverState, previous);
  publishHostState(context);
  try {
    if (context.playback.wantsPlay) original.resume();
    else original.pause();
    const seeking = original.seek(session.position ?? 0);
    if (context.tracks.overlay)
      void context.tracks.overlay.seek(session.position ?? 0, ++context.tracks.overlayEpoch).catch(() => {});
    await seeking;
    if (!context.session.controller.current(token) || context.media.runtime !== original) return;
    // A retained reader has a new clock epoch after a seek. Comparing its
    // position with the pre-seek high-water mark falsely stalls backward seeks.
    resetProgress(context, original.position);
    context.session.pendingSeek = undefined;
    context.playback.status = original.readout.state;
    context.telemetry.lastObservation = -Infinity;
    publishHostState(context);
  } catch (error) {
    if (context.session.controller.current(token) && context.media.runtime === original)
      await recoverPlayback(context, error, token);
  }
}
