import { canAttemptOriginal } from '../original-support';
import { codecKnown } from '../model';
import type { Source } from '../model';
import { mediaSourceClass } from '../pipeline';
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
export function usesPacketRuntime(context: HostContext, source: Source) {
  return (
    !context.recovery.browserFallbacks.has(routeKey(context, source)) &&
    ((source.original && canAttemptOriginal()) ||
      (source.delivery === 'hls' &&
        (context.session.current?.live ? context.runtimes.live : context.runtimes.hls)))
  );
}
export function supportsSource(context: HostContext, source: Source) {
  if (source.edition !== context.session.current?.edition) return false;
  if (source.delivery === 'file')
    return (source.original && canAttemptOriginal()) || !!context.surface.video.canPlayType(source.mime);
  return (
    (context.session.current?.live ? context.runtimes.live : context.runtimes.hls) ||
    !!context.surface.video.canPlayType('application/vnd.apple.mpegurl') ||
    !!source.renditions?.some(
      (r) => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass()!.isTypeSupported(r.mime)),
    )
  );
}
export function useNativeHls(context: HostContext, source: Source) {
  const native = !!context.surface.video.canPlayType('application/vnd.apple.mpegurl');
  const segmented = !!source.renditions?.some(
    (r) => mediaSourceClass() && (!codecKnown(r) || mediaSourceClass()!.isTypeSupported(r.mime)),
  );
  const pending = !!source.renditions?.some((r) => !codecKnown(r));
  const managed = 'ManagedMediaSource' in globalThis;
  return native && (!segmented || (navigator.vendor === 'Apple Computer, Inc.' && !managed && !pending));
}
export function candidateSources(context: HostContext) {
  const priority = { direct: 0, remux: 1, transcode: 2 };
  return (context.session.current?.sources ?? [])
    .filter((s) => supportsSource(context, s))
    .sort((a, b) => priority[a.strategy] - priority[b.strategy]);
}
