import type { CoreContext } from './runtime-state';
import { failCore } from './lifecycle';
import { seekCore } from './transport';
import { isCurrentDecodeEpoch } from './decode-epoch';
import { publishCoreState } from './telemetry';

export function checkLivePublication(context: CoreContext) {
  const source = context.session.source,
    run = context.decode.epoch;
  if (
    source?.kind !== 'hls' ||
    !source.live ||
    !run ||
    !run.started ||
    !context.intent.playing ||
    context.lifecycle.state === 'failed' ||
    context.lifecycle.state === 'ended'
  )
    return;
  const now = performance.now();
  if (now - context.decode.lastPresentationAt > 10000) {
    failCore(context, new Error('Live publication produced no frame for 10 seconds'));
    return;
  }
  // The demux library retains its segment census. Recreate that library-only
  // epoch periodically over our SAME bounded reader/clock to cap metadata.
  if (
    !context.decode.rotating &&
    context.lifecycle.state === 'playing' &&
    now - context.decode.epochStartedAt > 180000
  ) {
    context.decode.rotating = true;
    void seekCore(context, context.clock.time())
      .catch(() => {})
      .finally(() => {
        context.decode.rotating = false;
      });
  }
}

export function checkCoreEnded(context: CoreContext) {
  const run = context.decode.epoch;
  if (
    !run ||
    !isCurrentDecodeEpoch(context, run) ||
    !run.videoEnded ||
    !run.audioEnded ||
    context.scheduler.buffer.length
  )
    return;
  if (context.session.audio && !run.audioTailReported) return;
  const end = context.session.audio ? run.audioBufferedUntilUs : run.videoEndUs;
  if (context.clock.time() + 1000 < end) return;
  context.clock.setPlaying(false);
  context.session.source?.audio.pause();
  context.scheduler.stop();
  context.lifecycle.state = 'ended';
  publishCoreState(context);
}
