import { canAttemptOriginal } from '../original-support';
import { codecKnown } from '../model';
import type { Source } from '../model';
import { mediaSourceClass } from '../pipeline';
import { hlsBackend, type HlsBackend, type HlsRouteFacts } from '../hls-route';
import type { HostContext } from './state';
import { activateSource } from './media';
import { readPosition } from './position';
export function adaptCoreQuality(context: HostContext) {
  if (
    !context.media.runtime ||
    context.media.source?.delivery !== 'hls' ||
    context.session.pendingSwitch ||
    context.session.pendingSeek ||
    context.tracks.pendingTracks ||
    context.recovery.active ||
    !context.playback.wantsPlay
  )
    return;
  const next = context.quality.automatic.sample(
    context.media.source.renditions ?? [],
    context.playback.status === 'buffering',
    context.media.runtime.readout.throughputBps ?? null,
  );
  if (next) {
    context.quality.manual = null;
    void activateSource(context, context.media.source, readPosition(context), false, true);
  }
}
export function routeKey(context: HostContext, source: Source) {
  return [
    String(context.session.current?.id),
    context.session.controller.source,
    context.session.controller.seek,
    source.id,
  ].join(':');
}
/** The facts hlsBackend decides an HLS source's player from, on this page, for this route. */
export function hlsRouteFacts(context: HostContext, source: Source): HlsRouteFacts {
  const MS = mediaSourceClass();
  const key = routeKey(context, source);
  return {
    packetOffered: context.session.current?.live ? context.runtimes.live : context.runtimes.hls,
    packetCapable: canAttemptOriginal(),
    packetFailed: context.recovery.browserFallbacks.has(key),
    segmentsFailed: context.recovery.segmentFallbacks.has(key),
    mediaSource: !!MS,
    nativeHls: !!context.surface.video.canPlayType('application/vnd.apple.mpegurl'),
    apple: navigator.vendor === 'Apple Computer, Inc.',
    managedMediaSource: 'ManagedMediaSource' in globalThis,
    renditions: (source.renditions ?? []).map((r) => ({
      known: codecKnown(r),
      supported: !!MS && codecKnown(r) && MS.isTypeSupported(r.mime),
    })),
  };
}
export function backendFor(context: HostContext, source: Source): HlsBackend | null {
  if (source.delivery !== 'hls')
    return source.original && canAttemptOriginal() && !context.recovery.browserFallbacks.has(routeKey(context, source))
      ? 'packet'
      : null;
  return hlsBackend(hlsRouteFacts(context, source));
}
export function usesPacketRuntime(context: HostContext, source: Source) {
  return backendFor(context, source) === 'packet';
}
export function supportsSource(context: HostContext, source: Source) {
  if (source.edition !== context.session.current?.edition) return false;
  if (source.delivery === 'file')
    return (source.original && canAttemptOriginal()) || !!context.surface.video.canPlayType(source.mime);
  // Whether any player takes it, before a failure moved the route along.
  return hlsBackend({ ...hlsRouteFacts(context, source), packetFailed: false, segmentsFailed: false }) !== null;
}
export function candidateSources(context: HostContext) {
  const priority = { direct: 0, remux: 1, transcode: 2 };
  return (context.session.current?.sources ?? [])
    .filter((s) => supportsSource(context, s))
    .sort((a, b) => priority[a.strategy] - priority[b.strategy]);
}
