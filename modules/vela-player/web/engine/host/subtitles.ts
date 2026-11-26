import type { SubtitleSession } from '../universal/subtitles/session';
import type { SubtitleFailure } from '../universal/subtitles/types';
import type { HostContext } from './state';
import type { PlaybackSession } from '../model';
import { readPosition } from './position';
import { publishHostState, emitHostEvent } from './events';
import { requestTracks } from './authorizations';
export function releaseOverlay(context: HostContext) {
  context.tracks.overlayJob?.abort();
  context.tracks.overlayJob = undefined;
  context.tracks.overlay?.dispose();
  context.tracks.overlay = undefined;
  context.tracks.overlayLoading = undefined;
  context.tracks.overlayEpoch++;
}
function describedSubtitles(session: PlaybackSession) {
  return session.subtitleTracks.map((track) => ({
    id: track.id,
    streamIndex: track.streamIndex,
    codec: track.codec,
    label: track.label,
    language: track.language,
    delivery:
      track.delivery ?? (track.url ? ({ kind: 'external', format: 'webvtt', url: track.url } as const) : undefined),
  }));
}
/** A newer plan of the running source can carry a subtitle the server just added (one searched
 * for and downloaded); a live or loading overlay takes it without reopening the source. */
export function describeAddedSubtitles(context: HostContext, session: PlaybackSession) {
  if (context.tracks.overlay) context.tracks.overlay.describe(describedSubtitles(session));
  else
    void context.tracks.overlayLoading
      ?.then((overlay) => overlay.describe(describedSubtitles(session)))
      .catch(() => {});
}
export async function ensureOverlay(context: HostContext): Promise<SubtitleSession> {
  if (context.tracks.overlay) return context.tracks.overlay;
  if (context.tracks.overlayLoading) return context.tracks.overlayLoading;
  const source = context.media.source;
  const session = context.session.current;
  const surface = context.surface.video.parentElement;
  if (!source || !session || !(surface instanceof HTMLDivElement))
    throw new Error('Subtitle source is unavailable');
  const job = (context.tracks.overlayJob = new AbortController());
  const original = context.media.runtime;
  const current = () =>
    context.tracks.overlayJob === job && !job.signal.aborted && !context.lifecycle.disposed;
  const loading = (async () => {
    const overlay = await context.runtimes.createSubtitles({
      surface,
      reader: original?.supportsSubtitles ? original.byteReader : undefined,
      clusterStream: original?.subtitleClusters,
      mediaRequests: context.surface.mediaAccess,
      source: {
        url: source.url,
        container: original?.sourceContainer ?? source.delivery,
        sessionId: session.id,
        sourceGeneration: context.session.controller.source,
        seekGeneration: context.session.controller.seek,
      },
      epoch: ++context.tracks.overlayEpoch,
      clock: () => readPosition(context),
      signal: job.signal,
      describedTracks: describedSubtitles(session),
      getViewport: () => {
        const rect = surface.getBoundingClientRect();
        const video = original?.supportsSubtitles ? original.videoSize : undefined;
        const width = context.surface.video.videoWidth || video?.width || rect.width;
        const height = context.surface.video.videoHeight || video?.height || rect.height;
        const scale = context.surface.video.style.objectFit === 'cover'
          ? Math.max(rect.width / width, rect.height / height)
          : Math.min(rect.width / width, rect.height / height);
        const x = Math.max(0, (rect.width - width * scale) / 2);
        const y = Math.max(0, (rect.height - height * scale) / 2);
        const insets = context.surface.captionInsets;
        const left = Math.max(x, insets?.left ?? 0);
        const top = Math.max(y, insets?.top ?? 0);
        return {
          x: left,
          y: top,
          width: Math.max(1, rect.width - Math.max(x, insets?.right ?? 0) - left),
          height: Math.max(1, rect.height - Math.max(y, insets?.bottom ?? 0) - top),
          pictureHeight: rect.height - 2 * y,
        };
      },
      onTracks: () => {
        if (current()) publishHostState(context, true);
      },
      onState: () => {
        if (current()) publishHostState(context, true);
      },
      onFailure: (failure) => {
        if (current()) subtitleFailed(context, failure);
      },
    });
    if (!current()) {
      overlay.dispose();
      throw new DOMException('Subtitle source retired', 'AbortError');
    }
    context.tracks.overlay = overlay;
    overlay.setPreferences(context.tracks.subtitleStyle);
    await overlay.discover();
    job.signal.throwIfAborted();
    return overlay;
  })();
  context.tracks.overlayLoading = loading;
  try {
    return await loading;
  } catch (error) {
    if (current()) releaseOverlay(context);
    throw error;
  }
}
export function subtitleFailed(context: HostContext, failure: SubtitleFailure) {
  // A burn-in replacement retires the overlay (and its error). Keep a small,
  // source-free history so successful or failed recovery remains diagnosable.
  const note = failure.message.replace(/https?:\/\/\S+/g, '[source]').slice(0, 256);
  if (!context.tracks.subtitleFailureNotes.includes(note)) {
    context.tracks.subtitleFailureNotes.push(note);
    if (context.tracks.subtitleFailureNotes.length > 8) context.tracks.subtitleFailureNotes.shift();
  }
  publishHostState(context, true);
  const serverId = failure.serverId;
  const key = [
    String(context.session.current?.id),
    String(context.media.source?.sourceRevision ?? context.media.source?.timeline),
    failure.trackId,
  ].join(':');
  if (
    serverId &&
    context.session.current?.serverControlled &&
    context.tracks.overlay?.tracks.some(
      (track) => track.id === failure.trackId && track.delivery.kind === 'embedded',
    ) &&
    context.session.current.subtitleTracks.some((track) => track.id === serverId) &&
    !context.tracks.subtitleFailures.has(key) &&
    !context.tracks.pendingTracks &&
    !context.session.pendingSwitch &&
    !context.recovery.active &&
    !['failed', 'ended'].includes(context.playback.status)
  ) {
    context.tracks.subtitleFailures.add(key);
    requestTracks(context, { subtitle: serverId });
  } else
    emitHostEvent(context, {
      type: 'error',
      failure: { kind: 'action', message: failure.message, recoverable: true },
    });
}
export function applySubtitle(context: HostContext) {
  context.tracks.nativeTrack?.remove();
  context.tracks.nativeTrack = undefined;
  if (context.tracks.overlay) {
    const selected = context.tracks.overlay.tracks.find((track) => track.id === context.tracks.subtitle);
    if (selected?.delivery.kind === 'burn-in') {
      void context.tracks.overlay.select(null);
      return;
    }
    void context.tracks.overlay.select(context.tracks.subtitle).catch(() => {});
    return;
  }
  if (!context.tracks.subtitle) return;
  const selected = context.session.current?.subtitleTracks.find((t) => t.id === context.tracks.subtitle);
  if (selected?.delivery?.kind === 'burn-in') return;
  const source = context.media.source;
  const id = context.tracks.subtitle;
  void ensureOverlay(context)
    .then(() => {
      if (source === context.media.source && id === context.tracks.subtitle) applySubtitle(context);
    })
    .catch((error) => {
      if (
        (error instanceof DOMException && error.name === 'AbortError') ||
        source !== context.media.source ||
        id !== context.tracks.subtitle
      )
        return;
      try {
        applyLegacySubtitle(context);
      } catch (error) {
        emitHostEvent(context, {
          type: 'error',
          failure: {
            kind: 'action',
            message: error instanceof Error ? error.message : 'Subtitle unavailable',
            recoverable: true,
          },
        });
      }
    });
}
export function applyLegacySubtitle(context: HostContext) {
  if (context.lifecycle.disposed || !context.tracks.subtitle || context.tracks.nativeTrack) return;
  const selected = context.session.current?.subtitleTracks.find(
    (track) => track.id === context.tracks.subtitle,
  );
  if (!selected?.url) throw new Error('Selected subtitle has no WebVTT URL');
  if (context.surface.mediaAccess?.authorization())
    throw new Error('Authorized subtitles require the installed overlay');
  const track = (context.tracks.nativeTrack = document.createElement('track'));
  track.kind = 'subtitles';
  track.label = selected.label;
  track.srclang = selected.language ?? 'und';
  track.src = selected.url;
  track.default = true;
  track.addEventListener(
    'load',
    () => {
      if (context.tracks.nativeTrack === track) track.track.mode = 'showing';
    },
    { once: true },
  );
  track.addEventListener(
    'error',
    () => {
      if (context.tracks.nativeTrack === track)
        emitHostEvent(context, {
          type: 'error',
          failure: { kind: 'source', message: 'Subtitle could not be loaded', recoverable: true },
        });
    },
    { once: true },
  );
  context.surface.video.append(track);
  track.track.mode = 'showing';
}
