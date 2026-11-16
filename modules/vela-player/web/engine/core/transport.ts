import type { AudioTrack } from './types';
import type { CoreSource, CoreContext } from './runtime-state';
import { startDecodeEpoch } from './decode-epoch';
import { publishCoreState } from './telemetry';

export async function seekCore(context: CoreContext, positionUs: number) {
  await startDecodeEpoch(context, positionUs);
}

export async function selectCoreAudio(context: CoreContext, trackId: string) {
  const track = context.session.tracks.find(
    (track): track is AudioTrack => track.kind === 'audio' && track.id === trackId,
  );
  if (!track) throw new Error('Unknown actual audio track');
  const position = context.clock.time();
  context.session.requestedAudioId = track.id;
  await startDecodeEpoch(context, position);
}

export function pauseCore(context: CoreContext) {
  context.intent.playing = false;
  context.scheduler.setPreview(true);
  context.clock.setPlaying(false);
  context.session.source?.audio.pause();
  if (context.lifecycle.state === 'playing') context.lifecycle.state = 'paused';
  publishCoreState(context);
}

export async function playCore(context: CoreContext) {
  context.intent.playing = true;
  const source = context.session.source,
    window = source?.kind === 'hls' && source.live ? source.segments.liveWindow : undefined;
  if (window && context.clock.time() < window.start * 1e6) {
    await seekCore(
      context,
      Math.max(
        window.start,
        window.edge -
          (
            source as Extract<
              CoreSource,
              {
                kind: 'hls';
              }
            >
          ).live!.targetSeconds,
      ) * 1e6,
    );
    return;
  }
  const run = context.decode.epoch;
  context.scheduler.setPreview(false);
  if (context.lifecycle.state === 'loading') {
    publishCoreState(context);
    return;
  }
  if (context.session.audio) await context.session.source?.audio.play();
  if (context.decode.epoch !== run || context.lifecycle.closed || !context.intent.playing) return;
  context.clock.setPlaying(true);
  context.scheduler.start();
  if (context.lifecycle.state === 'paused') context.lifecycle.state = 'playing';
  publishCoreState(context);
}

export function setCoreLiveTarget(context: CoreContext, seconds: number) {
  if (
    context.session.source?.kind === 'hls' &&
    context.session.source.live &&
    Number.isFinite(seconds) &&
    seconds > 0 &&
    seconds <= 120
  )
    context.session.source.live.targetSeconds = seconds;
}

export function setCoreVolume(context: CoreContext, volume: number, muted: boolean) {
  if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new Error('Invalid volume');
  context.intent.volume = volume;
  context.intent.muted = muted;
  context.session.source?.audio.setVolume(volume, muted);
}

export function setCoreRate(context: CoreContext, rate: number) {
  if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) throw new Error('Unsupported playback speed');
  context.intent.rate = rate;
  context.session.source?.audio.setRate(rate);
  context.clock.setRate(rate);
}
