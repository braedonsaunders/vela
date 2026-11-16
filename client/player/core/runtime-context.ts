import { MediaClock } from './clock';
import { VideoScheduler } from './scheduler';
import type { CoreVideoFrame } from './decode/video';
import type { CoreContext, CoreDependencies } from './runtime-state';
import { failCore } from './lifecycle';
import { publishCoreState } from './telemetry';

export function createCoreContext(dependencies: CoreDependencies): CoreContext {
  const clock = new MediaClock();
  let context: CoreContext;
  const scheduler = new VideoScheduler<CoreVideoFrame>(
    clock,
    (frame, position) => dependencies.presenter.present(frame, position),
    (error) => failCore(context, error),
    () => {
      const epoch = context.decode.epoch;
      if (!epoch) return;
      context.decode.lastPresentationAt = performance.now();
      epoch.resolveFirst();
      if (epoch.started) {
        context.lifecycle.state = context.intent.playing ? 'playing' : 'paused';
        publishCoreState(context);
      }
    },
  );
  context = {
    clock,
    scheduler,
    dependencies,
    session: { nextEpoch: 0, tracks: [], initialAudioOrdinal: 0, durationUs: null, containerName: '' },
    decode: { decodedBeforeEpoch: 0, lastPresentationAt: 0, epochStartedAt: 0, rotating: false },
    intent: { playing: true, volume: 1, muted: false, rate: 1 },
    lifecycle: { state: 'idle', failure: null, closed: false },
  };
  return context;
}
