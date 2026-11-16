import { type DecoderRetry } from '../universal/retry';
import { loadOriginalRuntime } from '../universal/loader';
import type { Source } from '../model';
import { cancelled, type Generation } from '../session';
import { PlaybackFault } from '../pipeline';
import type { HostContext } from './state';
import { ensureOverlay, applySubtitle, subtitleFailed } from './subtitles';
import { publishHostState, emitHostEvent } from './events';
import { recoverPlayback } from './recovery';
import { awaitingReplacement } from './authorizations';
import { endPlayback } from './session';
export async function activatePacketRuntime(
  context: HostContext,
  source: Source,
  position: number,
  token: Generation,
  retry?: DecoderRetry,
) {
  context.media.backend = 'webgpu';
  context.watchdog.startupDeadlineMs = 8000;
  const parent = context.surface.video.parentElement;
  if (!(parent instanceof HTMLDivElement)) throw new Error('Original renderer surface is missing');
  const job = (context.media.runtimeJob = new AbortController());
  context.media.runtimeGeneration = token;
  const current = () =>
    context.media.runtimeJob === job &&
    !job.signal.aborted &&
    !!context.media.runtimeGeneration &&
    context.session.controller.current(context.media.runtimeGeneration);
  const original = await loadOriginalRuntime({
    surface: { container: parent, video: context.surface.video },
    signal: job.signal,
    retry,
    mediaRequests: context.surface.mediaAccess,
    onFailure: (reason, _position, transport) => {
      if (current()) {
        const generation = context.media.runtimeGeneration!;
        if (transport?.httpStatus === 410 && awaitingReplacement(context, generation)) {
          context.playback.status = 'loading';
          publishHostState(context);
          return;
        }
        void recoverPlayback(context, new PlaybackFault(reason, 'decoder'), generation);
      }
    },
    onEvent: (event) => {
      if (!current() || !context.media.runtime) return;
      if (event.type === 'waiting') context.playback.status = 'buffering';
      else if (event.type === 'playing' || event.type === 'statechange') {
        const state = context.media.runtime.readout.state;
        // A server command can retire its old producer before the reply
        // reaches Contract. Its typed failure callback decides whether
        // this is expected retirement or a real recovery.
        context.playback.status =
          state === 'failed' && awaitingReplacement(context, context.media.runtimeGeneration!)
            ? 'loading'
            : state;
        if (context.playback.status === 'playing') {
          context.playback.failure = null;
          if (context.session.pendingSeek?.authorized) context.session.pendingSeek = undefined;
        }
      } else if (event.type === 'ended') {
        endPlayback(context);
        return;
      }
      publishHostState(context);
    },
  });
  cancelled(token.signal);
  context.media.runtime = original;
  if (!context.playback.wantsPlay) original.pause();
  if (context.tracks.subtitle && !original.supportsSubtitles)
    throw new Error('Selected subtitles require a compatible fallback; original overlay is not ready');
  const info = source.originalVideo;
  const level =
    source.delivery === 'hls'
      ? context.quality.automatic.choose(source.renditions ?? [], source.initialRenditionId)
      : undefined;
  await original.open({
    url: level?.url ?? source.url,
    authority: {
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
    },
    ...(source.delivery === 'hls'
      ? {
          hls: {
            originSeconds: source.timelineOriginSeconds ?? 0,
            ...(context.session.current?.live
              ? {
                  live: {
                    windowStartSeconds: context.session.current.liveWindowStart,
                    targetSeconds: context.live.targetSeconds,
                    startAtEdge: !context.session.pendingSeek,
                  },
                }
              : {}),
          },
        }
      : {}),
    container: '',
    duration: context.session.current?.duration ?? null,
    position,
    video: { ...info, codec: info?.codec ?? '', width: info?.width ?? 0, height: info?.height ?? 0 },
    audio: (context.session.current?.audioTracks ?? []).map((t) => ({
      id: t.id,
      label: t.label,
      codec: t.codec ?? '',
      channels: t.channels,
      language: t.language,
      streamIndex: t.streamIndex ?? -1,
    })),
    selectedAudioId: context.tracks.audio,
  });
  if (original.setSpeed) await original.setSpeed(context.playback.speed);
  if (original.supportsSubtitles)
    void ensureOverlay(context)
      .then(() => applySubtitle(context))
      .catch((error) => {
        if (current()) {
          const message = error instanceof Error ? error.message : 'Subtitle discovery failed';
          if (context.tracks.subtitle)
            subtitleFailed(context, {
              trackId: context.tracks.subtitle,
              serverId: context.session.current?.subtitleTracks.find(
                (track) => track.id === context.tracks.subtitle,
              )?.id,
              code: 'subtitle-unavailable',
              message,
            });
          else
            emitHostEvent(context, {
              type: 'error',
              failure: { kind: 'action', message, recoverable: true },
            });
        }
      });
  cancelled(token.signal);
  context.playback.status = original.readout.state;
  if (context.session.pendingSeek?.authorized && context.playback.status === 'paused')
    context.session.pendingSeek = undefined;
  publishHostState(context);
  return;
}
