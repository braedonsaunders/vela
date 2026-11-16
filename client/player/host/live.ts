import { bufferAhead } from '../pipeline';
import type { LiveSnapshot } from '../model';
import type { HostContext } from './state';
import { snapshotBitrate, readPosition } from './position';
export function adaptLive(context: HostContext) {
  if (!context.session.current?.live) return;
  context.live.latency.setPreference(context.session.current.livePolicy);
  const bounds = liveBounds(context);
  const retries = context.media.runtime?.live?.retries ?? context.media.pipeline?.networkRetries ?? 0;
  const decision = context.live.latency.sample({
    now: performance.now(),
    playing: context.playback.status === 'playing' && context.playback.wantsPlay,
    waiting: context.playback.status === 'buffering' || retries > context.live.networkRetries,
    bufferGoalSeconds: context.media.runtime ? 2 : undefined,
    bufferAhead: context.media.runtime
      ? Math.max(
          context.media.runtime.readout.bufferAheadSeconds ?? 0,
          context.media.runtime.readout.readAheadSeconds ?? 0,
        )
      : bufferAhead(context.surface.video),
    throughputBps:
      context.media.runtime?.readout.throughputBps ?? context.media.pipeline?.bandwidth.bps ?? null,
    bitrateBps: snapshotBitrate(context),
    segmentSeconds:
      context.media.runtime?.live?.segmentSeconds ?? context.media.pipeline?.nominalSegmentSeconds ?? 2,
    windowSeconds: bounds.edge !== null && bounds.start !== null ? bounds.edge - bounds.start : null,
    behindSeconds: bounds.edge === null ? null : Math.max(0, bounds.edge - readPosition(context)),
  });
  context.live.networkRetries = retries;
  context.live.targetSeconds = decision.targetSeconds;
  if (context.media.pipeline) {
    context.media.pipeline.liveTargetSeconds = decision.targetSeconds;
    context.media.pipeline.livePlaybackRate = decision.playbackRate;
  }
  if (context.media.runtime?.setLiveTarget)
    context.media.runtime.setLiveTarget(decision.targetSeconds, decision.playbackRate);
  else if (!context.media.runtime) context.surface.video.playbackRate = decision.playbackRate;
}
export function catchUpTarget(context: HostContext): number | null {
  if (!context.session.current?.live) return null;
  const bounds = liveBounds(context);
  if (bounds.edge === null || bounds.start === null) return null;
  const start = bounds.start;
  const end = bounds.edge;
  if (end - start < 0.25) return null;
  const target = Math.max(start + 0.05, end - context.live.targetSeconds);
  return target > readPosition(context) + 0.25 ? Math.min(target, end - 0.1) : null;
}
export function liveBounds(context: HostContext): {
  edge: number | null;
  start: number | null;
  source: LiveSnapshot['edgeSource'];
} {
  const seekable = context.surface.video.seekable;
  let edge = context.media.runtime?.live?.edgeSeconds ?? context.media.pipeline?.publishedEdge ?? null;
  let start = context.media.runtime?.live?.startSeconds ?? context.media.pipeline?.publishedStart ?? null;
  let source: LiveSnapshot['edgeSource'] = edge === null ? null : 'playlist';
  if (edge === null && seekable.length) {
    edge = seekable.end(seekable.length - 1);
    start = seekable.start(0);
    source = 'seekable';
  }
  if (edge === null && Number.isFinite(context.session.current?.liveEdge)) {
    edge = context.session.current!.liveEdge!;
    start = context.session.current!.liveWindowStart ?? null;
    source = 'server';
  }
  return { edge, start, source };
}
export function liveSnapshot(context: HostContext): LiveSnapshot | null {
  if (!context.session.current?.live) return null;
  const { edge, start, source } = liveBounds(context);
  return {
    edgeSeconds: edge,
    windowStartSeconds: start,
    driftSeconds: edge === null ? null : Math.max(0, edge - readPosition(context)),
    edgeSource: source,
    reconnecting:
      context.playback.status === 'recovering' ||
      !!context.media.runtime?.live?.retrying ||
      !!context.media.pipeline?.retrying,
    delivery: context.media.runtime?.live?.delivery ?? context.media.pipeline?.delivery ?? 'unknown',
    canCatchUp: catchUpTarget(context) !== null,
  };
}
