import { bufferedPackets } from './packet-buffer';
import type { AudioTrack, MediaTrack, VideoTrack } from './types';
import type { DecodeEpoch, CoreContext } from './runtime-state';
import { isCurrentDecodeEpoch } from './decode-epoch';
import { checkCoreEnded } from './live-session';
import { failCore } from './lifecycle';

export async function* observeEncodedPackets(
  context: CoreContext,
  run: DecodeEpoch,
  track: MediaTrack,
  positionUs: number,
  signal: AbortSignal,
) {
  for await (const packet of run.demux.packets(track.id, positionUs, run.id, signal)) {
    if (!isCurrentDecodeEpoch(context, run)) return;
    run.packetBytes[track.kind] += packet.data.length;
    run.packetDurationUs[track.kind] += packet.durationUs;
    if (context.session.source?.kind === 'file' && packet.sourceOffset !== undefined) {
      context.session.source.reader.notePacket(track.kind, packet.timestampUs, packet.sourceOffset);
      context.session.source.reader.advance(context.clock.time());
    }
    yield packet;
  }
}

export async function decodeVideoPackets(
  context: CoreContext,
  run: DecodeEpoch,
  track: VideoTrack,
  positionUs: number,
  signal: AbortSignal,
) {
  try {
    for await (const packet of bufferedPackets(
      observeEncodedPackets(context, run, track, positionUs, signal),
      signal,
      (end) => {
        if (isCurrentDecodeEpoch(context, run)) run.readAheadEndUs = end;
      },
      (sample) => {
        if (isCurrentDecodeEpoch(context, run)) run.encodedVideo = sample;
      },
    )) {
      if (!isCurrentDecodeEpoch(context, run)) return;
      run.videoEndUs = Math.max(run.videoEndUs, packet.timestampUs + packet.durationUs);
      try {
        await run.decoder.decode(packet, signal);
      } catch (error) {
        throw new Error(`Video decode: ${error instanceof Error ? error.message : 'decoder failed'}`);
      }
    }
    await run.decoder.drain(signal);
    if (!isCurrentDecodeEpoch(context, run)) return;
    run.videoEnded = true;
    checkCoreEnded(context);
  } catch (error) {
    if (isCurrentDecodeEpoch(context, run)) failCore(context, error);
  }
}

export async function decodeAudioPackets(
  context: CoreContext,
  run: DecodeEpoch,
  track: AudioTrack,
  positionUs: number,
  signal: AbortSignal,
) {
  const audio = context.session.source!.audio;
  try {
    for await (const packet of observeEncodedPackets(context, run, track, positionUs, signal)) {
      if (!isCurrentDecodeEpoch(context, run)) return;
      run.audioEndUs = Math.max(run.audioEndUs, packet.timestampUs + packet.durationUs);
      await audio.decode(packet, signal);
    }
    await audio.drain?.(signal);
    if (!isCurrentDecodeEpoch(context, run)) return;
    run.audioEnded = true;
    checkCoreEnded(context);
  } catch (error) {
    if (isCurrentDecodeEpoch(context, run)) failCore(context, error);
  }
}
