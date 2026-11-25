import { playsOnAfterEnd } from './continuation';
import type { PlaybackSession } from '../model';
import type { HostContext } from './state';
import { detachMedia } from './native-events';
import { resetMedia, activateSource, releaseOriginal } from './media';
import { checkWaiting } from './watchdog';
import { adaptLive } from './live';
import { adaptCoreQuality, candidateSources } from './quality';
import { publishHostState, emitHostEvent } from './events';
import { canRetainOriginal, seekRetainedOriginal } from './file-retention';
import { readPosition, readDuration, readFrameMetrics } from './position';
import { failPlayback } from './recovery';
import { requestSwitch, sendQueuedSeek } from './authorizations';
import { applySubtitle, describeAddedSubtitles } from './subtitles';
import { applyNativeAudio } from './platform';
import { playMedia, pauseMedia, retirePlayIntent } from './transport';
export function retireMediaAuthorization(context: HostContext) {
  context.recovery.history.clear();
  context.session.controller.stop();
  detachMedia(context);
  resetMedia(context);
  context.session.current = undefined;
  context.media.source = undefined;
  context.session.pendingSeek = undefined;
  context.session.pendingSwitch = undefined;
  context.session.droppedSwitch = undefined;
  context.tracks.pendingTracks = undefined;
  context.playback.failure = null;
  context.playback.status = 'idle';
}
export async function loadSession(context: HostContext, session: PlaybackSession) {
  if (!context.lifecycle.timer)
    context.lifecycle.timer = setInterval(() => {
      checkWaiting(context);
      adaptLive(context);
      adaptCoreQuality(context);
      publishHostState(context);
    }, 1000);
  const waiting = context.session.pendingSeek;
  if (
    waiting?.queued &&
    !waiting.authorized &&
    session.id === context.session.current?.id &&
    session.serverState !== 'ended' &&
    session.seekGeneration !== context.session.controller.seek
  ) {
    // The answer to a seek the viewer has already moved past: ask for the latest target at its
    // generations rather than open media at a position left behind. Its own answer loads.
    sendQueuedSeek(
      context,
      session.sourceGeneration ?? context.session.controller.source,
      session.seekGeneration ?? context.session.controller.seek,
    );
    return;
  }
  if (
    session.id !== context.session.current?.id ||
    session.sourceGeneration !== context.session.controller.source ||
    session.seekGeneration !== context.session.controller.seek
  )
    context.recovery.localDecoderRetries.clear();
  const retained = session.sources.find((source) => source.id === session.selectedSourceId);
  if (retained && canRetainOriginal(context, session, retained)) {
    await seekRetainedOriginal(context, session, retained);
    return;
  }
  const pending = context.session.pendingSwitch ?? context.session.droppedSwitch;
  const handoff =
    pending &&
    pending.sessionId === session.id &&
    pending.sourceId === session.selectedSourceId &&
    session.sourceGeneration !== undefined &&
    session.seekGeneration !== undefined &&
    session.sourceGeneration >= pending.source &&
    session.sourceGeneration <= pending.source + 1 &&
    session.seekGeneration >= pending.seek &&
    session.seekGeneration <= pending.seek + 1 &&
    (session.sourceGeneration > pending.source || session.seekGeneration > pending.seek);
  const position = handoff ? Math.max(pending.position, readPosition(context)) : (session.position ?? 0);
  const recovery = !!handoff && pending.recovery;
  context.session.pendingSwitch = undefined;
  context.session.droppedSwitch = undefined;
  if (session.id !== context.session.current?.id) context.session.pendingSeek = undefined;
  else if (context.session.pendingSeek && session.seekGeneration !== context.session.controller.seek)
    context.session.pendingSeek = {
      ...context.session.pendingSeek,
      position: session.position ?? context.session.pendingSeek.position,
      authorized: true,
    };
  const previousServerState =
    session.id === context.session.current?.id ? context.session.current.serverState : undefined;
  if (session.id !== context.session.current?.id || session.selectedSourceId !== context.media.source?.id) {
    context.quality.manual = null;
    context.quality.automatic.reset();
  }
  if (session.id !== context.session.current?.id) {
    context.recovery.history.clear();
    context.recovery.browserFallbacks.clear();
    context.recovery.segmentFallbacks.clear();
    context.tracks.subtitleFailures.clear();
    context.tracks.subtitleFailureNotes = [];
    context.tracks.subtitlePreference = undefined;
    context.tracks.deferredPath = null;
    context.tracks.audioPreference = undefined;
    context.playback.localIntent = undefined;
    context.live.latency.reset(session.livePolicy);
    context.live.networkRetries = 0;
    // Opening the watch view is a play request. Later ready revisions merely
    // update metadata and must not override an explicit pause.
    context.playback.wantsPlay = session.serverState !== 'paused' && session.serverState !== 'ended';
  }
  if (playsOnAfterEnd({ ended: context.playback.status === 'ended', sameSession: session.id === context.session.current?.id, serverState: session.serverState,
    sourceGeneration: session.sourceGeneration, previousSourceGeneration: context.session.current?.sourceGeneration }))
    context.playback.wantsPlay = true;
  context.session.controller.start(session.id, session.sourceGeneration, session.seekGeneration);
  resetMedia(context);
  context.session.current = session;
  context.tracks.pendingTracks = undefined;
  if (session.serverState === 'ended') {
    context.media.source = session.sources.find((s) => s.id === session.selectedSourceId);
    endPlayback(context, session.position ?? 0);
    return;
  }
  applyServerState(context, session.serverState, previousServerState, false);
  context.media.source = undefined;
  context.playback.failure = null;
  context.recovery.attempted.clear();
  context.recovery.active = false;
  adaptLive(context);
  const preferred = context.tracks.audioPreference;
  const selected = session.sources.find((s) => s.id === session.selectedSourceId);
  context.tracks.audio =
    preferred &&
    (selected?.audioRenditions?.some((a) => a.trackId === preferred) ||
      (selected?.original && session.audioTracks.some((track) => track.id === preferred)))
      ? preferred
      : (session.audioTrackId ?? null);
  context.tracks.subtitle =
    context.tracks.subtitlePreference !== undefined
      ? context.tracks.subtitlePreference
      : (session.subtitleTrackId ?? null);
  const source =
    candidateSources(context).find((s) => s.id === session.selectedSourceId) ??
    candidateSources(context).find((s) => !context.tracks.audio || s.audioTrackId === context.tracks.audio) ??
    candidateSources(context)[0];
  if (!source) {
    failPlayback(context, {
      kind: 'unsupported',
      message: 'No browser-compatible source for this edition',
      recoverable: false,
    });
    return;
  }
  if (context.tracks.deferredPath) {
    const id = context.tracks.deferredPath;
    context.tracks.deferredPath = null;
    if (
      id !== source.id &&
      (session.sources.some((s) => s.id === id) || session.onDemandSources?.some((s) => s.id === id))
    ) {
      context.media.source = source;
      context.playback.status = 'buffering';
      requestSwitch(context, { id, onDemand: true }, Math.max(position, context.tracks.deferredPosition));
      publishHostState(context);
      return;
    }
  }
  await activateSource(context, source, position, recovery, true);
}
export function updateSession(context: HostContext, session: PlaybackSession) {
  if (session.id !== context.session.current?.id) throw new Error('Cannot update a different session');
  const next = session.sources.find((source) => source.id === context.media.source?.id);
  const current = context.media.source;
  if (
    next &&
    current &&
    (next.url !== current.url ||
      next.delivery !== current.delivery ||
      next.sourceRevision !== current.sourceRevision ||
      next.timeline !== current.timeline ||
      next.timelineOriginSeconds !== current.timelineOriginSeconds)
  ) {
    // A measured copy origin can arrive after lazy preparation, in a newer
    // same-generation plan. Existing demux/native clocks cannot be relabelled
    // in place. Reopen at the viewer's intended title position, not at zero.
    const replacement = {
      ...session,
      position: context.session.pendingSeek?.position ?? readPosition(context),
    };
    void loadSession(context, replacement).catch((error) => {
      if (!context.lifecycle.disposed && context.session.current === replacement)
        failPlayback(context, {
          kind: 'source',
          message: error instanceof Error ? error.message : 'Updated media source could not be opened',
          recoverable: true,
        });
    });
    return;
  }
  const previousState = context.session.current?.serverState;
  context.session.current = session;
  describeAddedSubtitles(context, session);
  if (
    context.tracks.pendingTracks &&
    (context.tracks.pendingTracks.audio === undefined ||
      context.tracks.pendingTracks.audio === session.audioTrackId) &&
    (context.tracks.pendingTracks.subtitle === undefined ||
      context.tracks.pendingTracks.subtitle === (session.subtitleTrackId ?? null))
  )
    context.tracks.pendingTracks = undefined;
  const source = session.sources.find((s) => s.id === context.media.source?.id);
  if (source) {
    context.media.source = source;
    context.media.pipeline?.updateRenditions(source.renditions ?? []);
  }
  applyServerState(context, session.serverState, previousState);
  if (context.playback.status === 'ended') return;
  adaptLive(context);
  if (context.media.pipeline) context.media.pipeline.maxLiveDrift = session.liveMaxDrift ?? 45;
  if (
    context.tracks.subtitlePreference !== undefined &&
    (session.subtitleTrackId ?? null) === context.tracks.subtitlePreference
  )
    context.tracks.subtitlePreference = undefined;
  if (
    context.tracks.subtitlePreference === undefined &&
    (session.subtitleTrackId ?? null) !== context.tracks.subtitle
  ) {
    context.tracks.subtitle = session.subtitleTrackId ?? null;
    applySubtitle(context);
  }
  if ((session.audioTrackId ?? null) !== context.tracks.audio) {
    if (
      context.media.runtime?.supportsLocalAudioSwitch !== false &&
      context.media.runtime &&
      (context.media.runtime.readout.audioTrackId === (session.audioTrackId ?? null) ||
        context.media.runtime.pendingAudioTrackId === (session.audioTrackId ?? null))
    ) {
      context.tracks.audio = session.audioTrackId ?? null;
      return;
    }
    // Observation/readiness revisions may still echo the old server track.
    // The local original-file preference remains valid while this pinned
    // source continues to advertise it; a new generation is handled by load.
    if (
      context.media.runtime &&
      context.tracks.audioPreference === context.tracks.audio &&
      session.audioTracks.some((track) => track.id === context.tracks.audio)
    )
      return;
    const previous = context.tracks.audio;
    const preferred = context.tracks.audioPreference;
    const selected = session.sources.find((s) => s.id === session.selectedSourceId);
    context.tracks.audio =
      preferred && selected?.audioRenditions?.some((a) => a.trackId === preferred)
        ? preferred
        : (session.audioTrackId ?? null);
    if (!applyNativeAudio(context)) {
      context.tracks.audio = previous;
      emitHostEvent(context, {
        type: 'error',
        failure: {
          kind: 'action',
          message: 'Audio change requires a new server source generation',
          recoverable: true,
        },
      });
    }
  }
}
export function applyServerState(
  context: HostContext,
  state: PlaybackSession['serverState'],
  previous: PlaybackSession['serverState'],
  touchVideo = true,
) {
  if (state === 'ended') {
    endPlayback(context);
    return;
  }
  if (state !== 'paused' && state !== 'playing') return;
  if (context.playback.localIntent) {
    if (state === context.playback.localIntent) context.playback.localIntent = undefined;
    return;
  }
  if (state === previous) return;
  context.playback.wantsPlay = state === 'playing';
  if (!touchVideo) return;
  if (state === 'paused') {
    pauseMedia(context);
    context.playback.status = 'paused';
    publishHostState(context);
  } else if (context.surface.video.paused) void playMedia(context);
}
export function endPlayback(context: HostContext, position?: number) {
  if (context.playback.status === 'ended' && context.playback.terminalMedia) return;
  context.playback.terminalMedia = {
    position: position ?? readPosition(context),
    duration: readDuration(context),
    ...readFrameMetrics(context),
  };
  context.session.pendingSeek = undefined;
  releaseOriginal(context);
  detachMedia(context);
  context.playback.status = 'ended';
  context.playback.failure = null;
  context.playback.wantsPlay = false;
  context.playback.localIntent = undefined;
  context.session.controller.cancel();
  context.media.pipeline?.dispose();
  context.media.pipeline = undefined;
  context.tracks.nativeTrack?.remove();
  context.tracks.nativeTrack = undefined;
  if (context.lifecycle.timer) clearInterval(context.lifecycle.timer);
  context.lifecycle.timer = undefined;
  retirePlayIntent(context);
  context.surface.video.pause();
  context.surface.video.removeAttribute('src');
  context.surface.video.load();
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
}
