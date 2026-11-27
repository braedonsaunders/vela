import { activatePacketRuntime } from './packet-runtime';
import { playbackMark } from '../timing';
import { type DecoderRetry } from '../universal/retry';
import { codecKnown } from '../model';
import type { Source } from '../model';
import { cancelled, type Generation } from '../session';
import { PlaybackFault, SegmentPipeline } from '../pipeline';
import { nativeMediaPlaylist } from '../native-hls';
import type { HostContext } from './state';
import { releaseOverlay, applySubtitle } from './subtitles';
import { resetProgress, recordPlaybackProgress } from './watchdog';
import { bindMedia } from './native-events';
import { readPosition } from './position';
import { publishHostState, emitHostEvent } from './events';
import { usesPacketRuntime, backendFor } from './quality';
import { recoverPlayback } from './recovery';
import { applyNativeAudio } from './platform';
import { releaseSeekPicture } from './seek-picture';
import { playMedia, retirePlayIntent } from './transport';
export function releaseOriginal(context: HostContext) {
  releaseOverlay(context);
  if (context.watchdog.startTimer) clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  const original = context.media.runtime;
  context.media.runtime = undefined;
  context.media.runtimeJob?.abort();
  context.media.runtimeJob = undefined;
  context.media.runtimeGeneration = undefined;
  if (original) context.media.closingRuntime = original.dispose().catch(() => {});
}
export function resetMedia(context: HostContext, keepPicture = false) {
  if (!keepPicture) releaseSeekPicture(context);
  retirePlayIntent(context);
  if (context.watchdog.videoCallback !== undefined)
    context.surface.video.cancelVideoFrameCallback?.(context.watchdog.videoCallback);
  context.watchdog.videoCallback = undefined;
  if (context.watchdog.startTimer) clearTimeout(context.watchdog.startTimer);
  context.watchdog.startTimer = undefined;
  releaseOriginal(context);
  context.media.nativeOrigin = 0;
  context.playback.terminalMedia = undefined;
  context.surface.video.pause();
  context.media.pipeline?.dispose();
  context.media.pipeline = undefined;
  context.tracks.nativeTrack?.remove();
  context.tracks.nativeTrack = undefined;
  context.surface.video.removeAttribute('src');
  context.surface.video.load();
  context.surface.video.playbackRate = 1;
}
export async function activateSource(
  context: HostContext,
  source: Source,
  position: number,
  recovery = false,
  initial = false,
  retry?: DecoderRetry,
) {
  context.watchdog.startupDeadlineMs = source.renditions?.some((r) => !codecKnown(r)) ? 60000 : 45000;
  // A source is admitted only after its plan arrives. Server preparation and
  // the earlier Play intent are outside this client startup deadline.
  context.playback.resumePosition = position;
  resetProgress(context, position);
  const token = context.session.controller.changeSource(!initial);
  resetMedia(context, !!context.session.pendingSeek && !!context.session.current?.live);
  context.media.source = source;
  context.watchdog.frameSeen = false;
  playbackMark('source:open', source.delivery);
  context.watchdog.videoCallback = context.surface.video.requestVideoFrameCallback?.(() => {
    if (context.session.controller.current(token)) {
      context.watchdog.videoCallback = undefined;
      releaseSeekPicture(context);
      if (context.media.backend !== 'webgpu' && !context.media.runtime && !context.watchdog.frameSeen) {
        context.watchdog.frameSeen = true;
        playbackMark('first-frame', context.media.backend === 'mse' ? 'mse' : 'native');
      }
    }
  });
  bindMedia(context, token);
  context.recovery.attempted.add(source.id);
  context.playback.status = recovery ? 'recovering' : 'loading';
  context.playback.failure = null;
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
  if (usesPacketRuntime(context, source)) {
    context.media.backend = 'webgpu';
    context.watchdog.startupDeadlineMs = 8000;
    context.watchdog.startTimer = setTimeout(() => {
      context.watchdog.startTimer = undefined;
      if (!context.session.controller.current(token)) return;
      if (context.media.runtime?.implementation === 'vela-core' && context.media.runtime.startupPending)
        return;
      recordPlaybackProgress(context);
      if (!context.watchdog.everPlayed)
        void recoverPlayback(
          context,
          new PlaybackFault('Original first-frame deadline exceeded (8 seconds)', 'decoder'),
          token,
        );
    }, 8000);
  }
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3500);
      context.media.closingRuntime.then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        () => {
          clearTimeout(timer);
          resolve();
        },
      );
    });
    cancelled(token.signal);
    if (usesPacketRuntime(context, source)) {
      await activatePacketRuntime(context, source, position, token, retry);
      return;
    }
    if (source.delivery === 'hls' && backendFor(context, source) === 'mse') {
      context.media.backend = 'mse';
      const pipeline = (context.media.pipeline = new SegmentPipeline(
        context.surface.video,
        () => publishHostState(context),
        () => {
          if (context.media.pipeline === pipeline && !token.signal.aborted && context.session.current)
            emitHostEvent(context, { type: 'session-refresh', sessionId: context.session.current.id });
        },
        context.surface.mediaAccess?.fetch,
      ));
      pipeline.timelineOriginSeconds = source.timelineOriginSeconds ?? 0;
      pipeline.audioRenditions = source.audioRenditions ?? [];
      pipeline.initialAudioTrackId = context.tracks.audio;
      pipeline.expensiveSwitches = source.strategy === 'transcode';
      pipeline.initialRenditionId = context.quality.manual ?? source.initialRenditionId;
      pipeline.liveTargetSeconds = context.live.targetSeconds;
      pipeline.startLiveAtEdge = !context.session.pendingSeek && !context.session.current?.startOver;
      pipeline.liveWindowStart = context.session.current?.liveWindowStart ?? null;
      pipeline.maxLiveDrift = context.session.current?.liveMaxDrift ?? 45;
      pipeline.abr.manual = context.quality.manual;
      void pipeline
        .run(source.renditions ?? [], position, !!context.session.current?.live, token.signal, source.url)
        .catch((e) => {
          if (context.media.pipeline === pipeline && !token.signal.aborted) void recoverPlayback(context, e, context.session.controller.token());
        });
    } else {
      context.media.backend = source.delivery === 'file' ? 'file' : 'native-hls';
      context.surface.video.disableRemotePlayback = false;
      const pinned = source.renditions?.find((r) => r.id === context.quality.manual);
      const media =
        source.delivery === 'hls'
          ? await nativeMediaPlaylist(
              pinned?.url ?? source.url,
              token.signal,
              0,
              context.surface.mediaAccess?.fetch,
            )
          : { url: source.url, duration: null };
      cancelled(token.signal);
      const legacyOffset =
        !context.session.current?.live &&
        position > 0 &&
        media.duration !== null &&
        context.session.current?.duration !== undefined &&
        Math.abs(media.duration + position - context.session.current.duration) <= 0.25;
      if (
        source.timelineOriginSeconds !== undefined &&
        (!Number.isFinite(source.timelineOriginSeconds) || source.timelineOriginSeconds < 0)
      )
        throw new Error('Invalid media timeline origin');
      context.media.nativeOrigin =
        source.delivery === 'hls' ? (source.timelineOriginSeconds ?? (legacyOffset ? position : 0)) : 0;
      const attached = context.surface.mediaAccess
        ? await context.surface.mediaAccess.nativeURL(media.url, token.signal)
        : media.url;
      cancelled(token.signal);
      context.surface.video.src = attached;
    }
    await metadata(context, token);
    cancelled(token.signal);
    context.surface.video.playbackRate = context.playback.speed;
    if (context.media.backend !== 'mse' && (position > 0 || context.session.current?.startOver))
      context.surface.video.currentTime = Math.max(0, position - context.media.nativeOrigin);
    applySubtitle(context);
    applyNativeAudio(context);
    context.playback.status = context.playback.wantsPlay ? 'loading' : 'paused';
    // Media already at an authorized seek's target is not sought again (above, and the segment pipeline's
    // first position), so no `seeked` ends that seek: a paused open ends it here and reports it at once.
    const pending = context.session.pendingSeek;
    const landed = !!pending?.authorized && context.playback.status === 'paused' && !context.surface.video.seeking &&
      Math.abs(readPosition(context) - pending.position) < 0.001;
    if (landed) context.session.pendingSeek = undefined;
    if (context.playback.wantsPlay) await playMedia(context);
    publishHostState(context, landed);
  } catch (e) {
    if (context.session.controller.current(token) && !(e instanceof DOMException && e.name === 'AbortError')) await recoverPlayback(context, e, token);
  }
}
export function metadata(context: HostContext, token: Generation): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clean();
      resolve();
    };
    const abort = () => {
      clean();
      reject(new DOMException('Superseded', 'AbortError'));
    };
    const error = () => {
      clean();
      // bindMedia owns classification (including HTTP range status probing).
      reject(new DOMException('Media error handled by native listener', 'AbortError'));
    };
    const timer = setTimeout(() => {
      clean();
      reject(new PlaybackFault('Metadata deadline exceeded', 'network', true));
    }, context.watchdog.startupDeadlineMs);
    const clean = () => {
      clearTimeout(timer);
      context.surface.video.removeEventListener('loadedmetadata', done);
      context.surface.video.removeEventListener('error', error);
      token.signal.removeEventListener('abort', abort);
    };
    context.surface.video.addEventListener('loadedmetadata', done, { once: true });
    context.surface.video.addEventListener('error', error, { once: true });
    token.signal.addEventListener('abort', abort, { once: true });
    if (context.surface.video.readyState >= 1) done();
    else if (token.signal.aborted) abort();
  });
}
