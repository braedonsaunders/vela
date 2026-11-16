import { playbackMark } from '../timing';
import { delay } from './async';
import { StartBuffer } from './start-buffer';
import type { DecodeEpoch, CoreContext } from './runtime-state';
import { isCurrentDecodeEpoch } from './decode-epoch';

export async function primeAudioReserve(
  context: CoreContext,
  run: DecodeEpoch,
  positionUs: number,
  signal: AbortSignal,
) {
  const source = context.session.source;
  if (!source || !isCurrentDecodeEpoch(context, run)) return;
  const delivery = (source.kind === 'file' ? source.reader : source.segments).delivery;
  const reserve = new StartBuffer(),
    began = performance.now();
  const minimum = context.session.audio ? 0.08 : 0;
  let buffered = 0,
    ended = false,
    queueRisk = 0;
  for (;;) {
    signal.throwIfAborted();
    if (!isCurrentDecodeEpoch(context, run)) return;
    let bitrate = 0;
    for (const kind of ['video', 'audio'] as const)
      if (run.packetDurationUs[kind] > 0)
        bitrate += (run.packetBytes[kind] * 8000000) / run.packetDurationUs[kind];
    const admission = delivery.since(run.deliveryMark);
    if (admission.capWaitMs !== null) queueRisk = Math.max(queueRisk, admission.capWaitMs);
    const mediaBitrate =
      source.kind === 'file' ? Math.max(source.reader.mediaBitrateBps ?? 0, bitrate) : bitrate;
    reserve.observe(
      admission,
      mediaBitrate || null,
      source.kind === 'file' ? source.reader.forwardReserveBytes : 0,
      queueRisk > 0 ? queueRisk : admission.capWaitMs,
    );
    buffered = Math.max(
      0,
      ((context.session.audio ? run.audioBufferedUntilUs : run.readAheadEndUs) - positionUs) / 1e6,
    );
    ended = context.session.audio ? run.audioEnded && run.audioTailReported : run.videoEnded;
    if (!context.intent.playing || buffered >= Math.max(minimum, reserve.targetSeconds) || ended) break;
    await delay(25, signal);
  }
  if (!isCurrentDecodeEpoch(context, run)) return;
  run.startBuffer = reserve.result(performance.now() - began, buffered, false);
  playbackMark('buffer:ready');
}
