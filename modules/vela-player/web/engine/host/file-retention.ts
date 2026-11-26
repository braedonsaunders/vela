import type { PlaybackSession, Source } from '../model';
import type { HostContext } from './state';
import { resetProgress } from './watchdog';
import { applyServerState } from './session';
import { publishHostState } from './events';
import { recoverPlayback } from './recovery';
export function retainedSeekPosition(context: HostContext, session: PlaybackSession, source: Source): number | null {
  const previous = context.session.current;
  const current = context.media.source;
  const original = context.media.runtime;
  if (
    !previous ||
    !current ||
    !original ||
    !context.media.runtimeJob ||
    context.media.runtimeJob.signal.aborted ||
    session.serverState === 'ended' ||
    session.id !== previous.id ||
    session.mediaId !== previous.mediaId ||
    session.sourceGeneration !== context.session.controller.source ||
    session.seekGeneration === context.session.controller.seek ||
    source.delivery !== current.delivery ||
    source.id !== current.id ||
    source.url !== current.url ||
    source.edition !== current.edition ||
    source.timeline !== current.timeline ||
    source.sourceRevision !== current.sourceRevision ||
    source.timelineOriginSeconds !== current.timelineOriginSeconds ||
    (session.subtitleTrackId ?? null) !== context.tracks.subtitle
  )
    return null;
  const identities = (tracks: PlaybackSession['audioTracks']) =>
    JSON.stringify(tracks.map((track) => [track.id, track.streamIndex]));
  if (identities(session.audioTracks) !== identities(previous.audioTracks)) return null;
  const selected =
    context.tracks.audioPreference &&
    session.audioTracks.some((track) => track.id === context.tracks.audioPreference)
      ? context.tracks.audioPreference
      : (session.audioTrackId ?? null);
  if (selected !== original.readout.audioTrackId) return null;
  const position = session.position ?? 0;
  if (source.original && source.delivery === 'file' && original.retainsSource) return position;
  // A rolling playlist keeps its segments on a seek. A changed archive or a position beyond the
  // loaded playlist must open the latest source instead.
  // Converted VOD can reuse filenames with new bytes after a seek. Only a DVR playlist
  // advertised by the same live session can retain its reader here.
  const live = session.live && previous.live && (session.timeshift || session.startOver)
    && (previous.timeshift || previous.startOver) && source.delivery === 'hls' && original.live;
  if (!live) return null;
  if (session.liveEdge !== undefined && position >= session.liveEdge && live.edgeSeconds > live.startSeconds) {
    return Math.max(live.startSeconds, live.edgeSeconds - context.live.targetSeconds);
  }
  return position >= live.startSeconds && position < live.edgeSeconds ? position : null;
}
export async function seekRetainedSource(context: HostContext, session: PlaybackSession, source: Source, position: number) {
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
    position,
    startedAt: performance.now(),
    authorized: true,
  };
  resetProgress(context, position);
  context.playback.status = 'buffering';
  context.playback.failure = null;
  context.telemetry.lastObservation = -Infinity;
  applyServerState(context, session.serverState, previous);
  publishHostState(context);
  try {
    if (context.playback.wantsPlay) original.resume();
    else original.pause();
    const seeking = original.seek(position);
    if (context.tracks.overlay)
      void context.tracks.overlay.seek(position, ++context.tracks.overlayEpoch).catch(() => {});
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
