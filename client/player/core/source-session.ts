import { StartupProgress } from './startup-progress';
import { SegmentReader } from './source/segments';
import { RangeReader } from './source/ranges';
import { MatroskaSubtitleStream } from './demux/subtitle-stream';
import type { CoreLiveOptions, CoreSource, CoreContext } from './runtime-state';
import { closeSourceSession, failCore } from './lifecycle';
import { checkCoreEnded } from './live-session';
import { publishCoreState } from './telemetry';
import { startDecodeEpoch } from './decode-epoch';

export function openFileSource(
  context: CoreContext,
  url: string,
  positionUs = 0,
  audioOrdinal = 0,
): Promise<void> {
  return openSourceSession(context, { kind: 'file', url }, positionUs, audioOrdinal);
}

export function openHlsSource(
  context: CoreContext,
  url: string,
  positionUs: number,
  originUs: number,
  audioOrdinal = 0,
  authority?: {
    sourceGeneration: number;
    seekGeneration: number;
  },
  live?: CoreLiveOptions,
): Promise<void> {
  // Both values enter from seconds. Compare on the same microsecond grid:
  // rounding only the origin can put it half a microsecond after the target.
  positionUs = Math.round(positionUs);
  originUs = Math.round(originUs);
  if (
    !Number.isSafeInteger(positionUs) ||
    positionUs < 0 ||
    !Number.isSafeInteger(originUs) ||
    originUs < 0 ||
    (!live && positionUs < originUs)
  )
    throw new Error('Invalid HLS source timeline');
  return openSourceSession(
    context,
    {
      kind: 'hls',
      url,
      originUs,
      cacheIdentity: authority
        ? `${authority.sourceGeneration}:${authority.seekGeneration}`
        : `local:${context.session.nextEpoch + 1}`,
      live,
    },
    positionUs,
    audioOrdinal,
  );
}

export async function openSourceSession(
  context: CoreContext,
  input:
    | {
        kind: 'file';
        url: string;
      }
    | {
        kind: 'hls';
        url: string;
        originUs: number;
        cacheIdentity: string;
        live?: CoreLiveOptions;
      },
  positionUs: number,
  audioOrdinal: number,
): Promise<void> {
  if (context.lifecycle.closed) throw new Error('Playback core is disposed');
  await closeSourceSession(context);
  context.decode.decodedBeforeEpoch = 0;
  context.scheduler.dropEvents.length = 0;
  Object.assign(context.scheduler.metrics, {
    presented: 0,
    dropped: 0,
    preroll: 0,
    lastLagUs: 0,
    maxLagUs: 0,
  });
  const abort = new AbortController();
  const audio = context.dependencies.createAudio({
    signal: abort.signal,
    onClock: (anchor) => {
      if (context.clock.update(anchor)) {
        const run = context.decode.epoch;
        if (run && run.id === anchor.epoch) {
          run.audioBufferedUntilUs = anchor.bufferedUntilUs;
          if (run.audioEnded) run.audioTailReported = true;
        }
        if (
          context.intent.playing &&
          (context.lifecycle.state === 'playing' || context.lifecycle.state === 'buffering')
        )
          context.lifecycle.state = anchor.playing ? 'playing' : 'buffering';
        checkCoreEnded(context);
      } else if (context.decode.epoch?.id === anchor.epoch) context.decode.epoch.audioAnchorsRejected++;
    },
    onFailure: (failure) => {
      if (context.decode.epoch?.id === failure.epoch)
        failCore(context, new Error(`Audio ${failure.stage}: ${failure.message}`));
    },
  });
  const allowed = context.dependencies.mediaRequests?.allows.bind(context.dependencies.mediaRequests);
  let source: CoreSource;
  if (input.kind === 'file') {
    const reader = new RangeReader(input.url, context.dependencies.mediaRequests?.fetch, allowed);
    source = {
      kind: 'file',
      abort,
      audio,
      reader,
      subtitleClusters: new MatroskaSubtitleStream(reader, abort.signal),
    };
  } else
    source = {
      kind: 'hls',
      abort,
      audio,
      segments: new SegmentReader(
        input.url,
        context.dependencies.mediaRequests?.fetch,
        allowed,
        input.cacheIdentity,
        !!input.live,
      ),
      originUs: input.originUs,
      live: input.live,
    };
  context.session.source = source;
  context.lifecycle.failure = null;
  context.session.tracks = [];
  context.session.video = undefined;
  context.session.audio = undefined;
  context.session.requestedAudioId = undefined;
  context.session.durationUs = null;
  context.session.initialAudioOrdinal =
    Number.isSafeInteger(audioOrdinal) && audioOrdinal >= 0 ? audioOrdinal : 0;
  const startup = trackStartupProgress(context, source, abort.signal);
  try {
    if (source.kind === 'hls') {
      context.lifecycle.state = 'loading';
      context.clock.reset(positionUs, ++context.session.nextEpoch, false);
      publishCoreState(context);
      await source.segments.prepare(startup.signal);
      if (context.session.source !== source || context.lifecycle.closed) return;
      if (source.live && source.segments.liveWindow) {
        const window = source.segments.liveWindow;
        positionUs = source.live.startAtEdge
          ? Math.max(window.start, window.edge - source.live.targetSeconds) * 1e6
          : Math.max(window.start, Math.min(window.edge - 0.05, positionUs / 1e6)) * 1e6;
      }
    }
    await startDecodeEpoch(context, positionUs, startup);
  } catch (error) {
    if (context.session.source === source && !abort.signal.aborted) failCore(context, error);
    throw error;
  } finally {
    startup.dispose();
  }
}

export function trackStartupProgress(context: CoreContext, source: CoreSource, signal: AbortSignal) {
  return new StartupProgress(signal, () => {
    const run = context.decode.epoch,
      pcm = source.audio.bufferState?.();
    return [
      (source.kind === 'file' ? source.reader : source.segments).metrics.receivedBytes,
      run?.packetBytes.video ?? 0,
      run?.packetBytes.audio ?? 0,
      run?.decoder.metrics.decoded ?? 0,
      pcm?.queuedFrames ?? 0,
      pcm?.submittedChunks ?? 0,
    ];
  });
}
