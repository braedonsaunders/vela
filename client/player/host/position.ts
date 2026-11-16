import type { HostContext } from './state';
export function readPosition(context: HostContext) {
  return (
    context.playback.terminalMedia?.position ??
    context.media.runtime?.position ??
    (context.surface.video.readyState >= 1 && Number.isFinite(context.surface.video.currentTime)
      ? context.media.nativeOrigin + context.surface.video.currentTime
      : context.playback.resumePosition)
  );
}
export function readDuration(context: HostContext) {
  if (context.session.current?.live) return null;
  return (
    context.playback.terminalMedia?.duration ??
    context.media.runtime?.readout.duration ??
    (Number.isFinite(context.surface.video.duration)
      ? context.media.nativeOrigin + context.surface.video.duration
      : (context.session.current?.duration ?? null))
  );
}
export function readFrameMetrics(context: HostContext) {
  const quality = context.surface.video.getVideoPlaybackQuality?.();
  return {
    frames: context.media.runtime?.readout.frames ?? quality?.totalVideoFrames ?? null,
    dropped: context.media.runtime?.readout.dropped ?? quality?.droppedVideoFrames ?? null,
  };
}
export function snapshotBitrate(context: HostContext) {
  const rendition = context.media.source?.renditions?.find(
    (r) =>
      r.id ===
      (context.quality.manual ?? context.quality.automatic.id ?? context.media.source?.initialRenditionId),
  );
  return (
    context.media.pipeline?.current?.bandwidth ??
    rendition?.bandwidth ??
    context.media.source?.quality?.bitrate ??
    null
  );
}
