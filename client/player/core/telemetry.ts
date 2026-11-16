import type { CoreState, CoreContext } from './runtime-state';

export function snapshotCore(context: CoreContext): CoreState {
  const position = context.clock.time(),
    run = context.decode.epoch;
  if (context.session.source?.kind === 'file') context.session.source.reader.advance(position);
  const videoEnd = context.scheduler.bufferedEnd(position);
  const bufferedEnd = context.session.audio
    ? Math.min(videoEnd, run?.audioBufferedUntilUs ?? position)
    : videoEnd;
  const network =
    context.session.source?.kind === 'file'
      ? context.session.source.reader.bandwidth
      : context.session.source?.segments.bandwidth;
  const sourceAudit = run?.demux.bufferAudit;
  return {
    bufferAudit: sourceAudit && run ? { source: sourceAudit, encodedVideo: { ...run.encodedVideo } } : null,
    startBuffer: run?.startBuffer ? { ...run.startBuffer } : null,
    readAheadSeconds: run ? Math.max(0, (run.readAheadEndUs - position) / 1e6) : null,
    diagnostics: [
      ...(run?.demux.diagnostics ?? []),
      ...(context.session.source?.kind === 'hls' ? context.session.source.segments.diagnostics : []),
    ],
    bufferAheadSeconds: run ? Math.max(0, (bufferedEnd - position) / 1e6) : null,
    throughputBps: network?.bps ?? null,
    throughputHistory: network?.history ?? [],
    state: context.lifecycle.state,
    epoch: context.decode.epoch?.id ?? context.session.nextEpoch,
    positionUs: context.clock.time(),
    durationUs: context.session.durationUs,
    tracks: context.session.tracks,
    videoTrackId: context.session.video?.id ?? null,
    audioTrackId: context.session.audio?.id ?? null,
    decoded: context.decode.decodedBeforeEpoch + (context.decode.epoch?.decoder.metrics.decoded ?? 0),
    presented: context.scheduler.metrics.presented,
    dropped: context.scheduler.metrics.dropped,
    failure: context.lifecycle.failure,
  };
}

export function publishCoreState(context: CoreContext) {
  context.dependencies.onState(snapshotCore(context));
}

export function readPresentationTelemetry(context: CoreContext) {
  return {
    clusterCache: context.decode.epoch?.demux.clusterCacheAudit ?? null,
    lastPresentationLagUs: context.scheduler.metrics.lastLagUs,
    maxPresentationLagUs: context.scheduler.metrics.maxLagUs,
    dropEvents: context.scheduler.dropEvents.map((value) => ({ ...value })),
  };
}

export function readByteReader(context: CoreContext) {
  return context.session.source?.kind === 'file' ? context.session.source.reader : undefined;
}

export function isCoreStartupPending(context: CoreContext) {
  return (
    !!context.session.source &&
    context.lifecycle.state !== 'failed' &&
    context.lifecycle.state !== 'ended' &&
    !context.decode.epoch?.started
  );
}

export function readSubtitleClusters(context: CoreContext) {
  return context.session.source?.kind === 'file' ? context.session.source.subtitleClusters : undefined;
}

export function readContainer(context: CoreContext) {
  return context.session.containerName;
}

export function readLiveWindow(context: CoreContext) {
  const source = context.session.source;
  if (source?.kind !== 'hls' || !source.live || !source.segments.liveWindow) return undefined;
  const window = source.segments.liveWindow;
  return {
    startSeconds: window.start,
    edgeSeconds: window.edge,
    segmentSeconds: window.targetDuration,
    ended: window.ended,
    retries: source.segments.networkRetries,
    retrying: source.segments.retrying,
    delivery: window.gap
      ? ('upstream-gap' as const)
      : source.segments.retrying
        ? ('segment-delayed' as const)
        : context.lifecycle.state === 'buffering'
          ? ('waiting-for-publication' as const)
          : ('available' as const),
  };
}
