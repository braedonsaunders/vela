import { playbackMark } from '../timing';
import { abortable } from './async';
import { StartupProgress } from './startup-progress';
import { FileDemux, type PacketDemux } from './demux/file';
import { HlsDemux } from './demux/hls';
import type { AudioTrack, VideoTrack } from './types';
import type { DecodeEpoch, CoreContext } from './runtime-state';
import { trackStartupProgress } from './source-session';
import { failCore } from './lifecycle';
import { publishCoreState } from './telemetry';
import { decodeVideoPackets, decodeAudioPackets } from './decode-packets';
import { primeAudioReserve } from './playback-admission';
import { checkLivePublication, checkCoreEnded } from './live-session';
import { sameAudioConfiguration } from './decode/audio-configuration';

export async function startDecodeEpoch(
  context: CoreContext,
  positionUs: number,
  admission?: StartupProgress,
): Promise<void> {
  const source = context.session.source;
  if (!source) throw new Error('Playback source is absent');
  // Physical-clock interpolation may contain sub-microsecond fractions.
  // Decoder/output epoch boundaries use integer media microseconds.
  positionUs = Math.round(positionUs);
  if (!Number.isSafeInteger(positionUs) || positionUs < 0) throw new Error('Invalid seek target');
  context.decode.decodedBeforeEpoch += context.decode.epoch?.decoder.metrics.decoded ?? 0;
  context.decode.epoch?.abort.abort();
  context.decode.epoch?.decoder.dispose();
  context.decode.epoch?.demux.dispose();
  source.audio.pause();
  const abort = new AbortController(),
    id = ++context.session.nextEpoch;
  if (source.kind === 'file') source.reader.beginEpoch(id);
  const lifetime = AbortSignal.any([source.abort.signal, abort.signal]);
  const progress = admission ?? trackStartupProgress(context, source, lifetime);
  const signal = AbortSignal.any([lifetime, progress.signal]);
  const live = source.kind === 'hls' && !!source.live;
  if (source.kind === 'file') source.subtitleClusters.reset(id);
  const demux: PacketDemux =
    source.kind === 'file'
      ? new FileDemux(
          source.reader,
          signal,
          source.subtitleClusters,
          () => source.reader.bufferCache,
          positionUs / 1e6,
        )
      : new HlsDemux(source.segments, signal, source.originUs);
  let resolveFirst!: () => void, resolvePrimed!: () => void;
  const firstFrame = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  const primed = new Promise<void>((resolve) => {
    resolvePrimed = resolve;
  });
  const run: DecodeEpoch = {
    id,
    abort,
    demux,
    firstFrame,
    resolveFirst,
    primed,
    resolvePrimed,
    started: false,
    encodedVideo: { bytes: 0, packets: 0, durationSeconds: 0 },
    deliveryMark: (source.kind === 'file' ? source.reader : source.segments).delivery.mark(),
    packetBytes: { video: 0, audio: 0 },
    packetDurationUs: { video: 0, audio: 0 },
    startBuffer: null,
    readAheadEndUs: positionUs,
    videoEndUs: positionUs,
    audioEndUs: positionUs,
    videoEnded: false,
    audioEnded: false,
    audioTailReported: false,
    audioBufferedUntilUs: positionUs,
    audioAnchorsRejected: 0,
    decoder: context.dependencies.createVideo({
      output: (frame) => {
        if (isCurrentDecodeEpoch(context, run)) {
          const eligible = frame.timestampUs + frame.durationUs > positionUs;
          context.scheduler.push(frame);
          if (eligible) run.resolvePrimed();
        } else frame.release();
      },
      canOutput: () => !context.scheduler.buffer.full,
      active: () => context.intent.playing,
      onFailure: (error) => {
        if (isCurrentDecodeEpoch(context, run))
          failCore(context, new Error(`Video decode: ${error.message}`));
      },
    }),
  };
  context.decode.epoch = run;
  context.decode.epochStartedAt = performance.now();
  context.decode.lastPresentationAt = performance.now();
  context.scheduler.reset(id, positionUs, !context.intent.playing);
  context.lifecycle.state = 'loading';
  context.lifecycle.failure = null;
  context.clock.reset(positionUs, id, !!context.session.audio);
  context.clock.setPlaying(false);
  publishCoreState(context);
  const startup = signal;
  try {
    playbackMark('metadata:start');
    let preparedVideo: string | undefined, videoConfiguring: Promise<void> | undefined;
    const expectedVideo = context.session.video?.id;
    const metadata = await abortable(
      demux.open(startup, (track) => {
        if (
          !isCurrentDecodeEpoch(context, run) ||
          videoConfiguring ||
          (expectedVideo && track.id !== expectedVideo)
        )
          return;
        preparedVideo = track.id;
        videoConfiguring = run.decoder.configure(track, id, startup, live);
        // Audio metadata can still be in flight; retain its sibling failure.
        void videoConfiguring.catch(() => {});
      }),
      startup,
    );
    playbackMark('metadata:ready');
    if (!isCurrentDecodeEpoch(context, run)) return;
    const video =
      metadata.tracks.find(
        (track): track is VideoTrack => track.kind === 'video' && track.id === context.session.video?.id,
      ) ?? metadata.tracks.find((track): track is VideoTrack => track.kind === 'video');
    if (!video) throw new Error('Source contains no video track');
    const audio =
      metadata.tracks.find(
        (track): track is AudioTrack =>
          track.kind === 'audio' &&
          track.id === (context.session.requestedAudioId ?? context.session.audio?.id),
      ) ??
      metadata.tracks.filter((track): track is AudioTrack => track.kind === 'audio')[
        context.session.initialAudioOrdinal
      ] ??
      metadata.tracks.find((track): track is AudioTrack => track.kind === 'audio');
    const sameAudio =
      !!context.session.audio && !!audio && sameAudioConfiguration(context.session.audio, audio);
    context.session.tracks = metadata.tracks;
    context.session.video = video;
    context.session.audio = audio;
    context.session.durationUs = source.kind === 'hls' && source.live ? null : metadata.durationUs;
    context.session.containerName = metadata.container;
    context.clock.reset(positionUs, id, !!audio);
    playbackMark('decode:start');
    await abortable(
      Promise.all([
        preparedVideo === video.id && videoConfiguring
          ? videoConfiguring
          : run.decoder.configure(video, id, startup, live),
        audio
          ? (async () => {
              if (!sameAudio) await source.audio.configure(audio, id, startup);
              if (sameAudio || positionUs !== 0) await source.audio.flush(positionUs, id, startup);
            })()
          : Promise.resolve(),
      ]),
      startup,
    );
    if (!isCurrentDecodeEpoch(context, run)) return;
    playbackMark('decode:ready');
    run.deliveryMark = (source.kind === 'file' ? source.reader : source.segments).delivery.mark();
    source.audio.setVolume(context.intent.volume, context.intent.muted);
    source.audio.setRate(context.intent.rate);
    void decodeVideoPackets(context, run, video, positionUs, signal);
    if (audio) void decodeAudioPackets(context, run, audio, positionUs, signal);
    else run.audioEnded = true;
    // Decode the target frame before starting the physical audio clock. Otherwise
    // decoder/pipeline setup latency is mistaken for late video and drops it.
    await abortable(primed, startup);
    if (!isCurrentDecodeEpoch(context, run)) return;
    context.scheduler.start();
    if ((context.scheduler.buffer.nextTimestampUs ?? Infinity) <= positionUs)
      await abortable(firstFrame, startup);
    if (context.intent.playing) await primeAudioReserve(context, run, positionUs, startup);
    if (context.intent.playing && audio) await abortable(source.audio.play(), startup);
    if (!isCurrentDecodeEpoch(context, run)) return;
    if (context.intent.playing) context.clock.setPlaying(true);
    else source.audio.pause();
    run.started = true;
    await abortable(firstFrame, startup);
    if (isCurrentDecodeEpoch(context, run)) {
      context.lifecycle.state = context.intent.playing ? 'playing' : 'paused';
      publishCoreState(context);
      if (!context.lifecycle.timer)
        context.lifecycle.timer = setInterval(() => {
          checkLivePublication(context);
          checkCoreEnded(context);
          publishCoreState(context);
        }, 250);
    }
  } catch (error) {
    if (isCurrentDecodeEpoch(context, run)) failCore(context, error);
    throw error;
  } finally {
    progress.dispose();
  }
}

export function isCurrentDecodeEpoch(context: CoreContext, run: DecodeEpoch) {
  return context.decode.epoch === run && !run.abort.signal.aborted && !context.lifecycle.closed;
}
