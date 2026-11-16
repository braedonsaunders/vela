import { playbackMark } from '../timing';
import type { EngineEvent } from '../model';
import type { HostContext } from './state';
import { snapshotHost } from './telemetry';
export function emitHostEvent(context: HostContext, event: EngineEvent) {
  context.events.deliver(
    event.type === 'error'
      ? {
          ...event,
          sessionId: context.session.current?.id ?? null,
          sourceGeneration: context.session.controller.source,
          seekGeneration: context.session.controller.seek,
        }
      : event,
  );
}
export function publishHostState(context: HostContext, force = false) {
  if (context.lifecycle.disposed) return;
  if (context.media.pipeline?.audioTrackId) context.tracks.audio = context.media.pipeline.audioTrackId;
  if (
    context.media.runtime &&
    !context.watchdog.frameSeen &&
    context.media.runtime.readout.presentedFrames > 0
  ) {
    context.watchdog.frameSeen = true;
    playbackMark('first-frame', 'webgpu');
  }
  const now = performance.now();
  if (!force && now - context.telemetry.lastObservation < 250) return;
  context.telemetry.lastObservation = now;
  emitHostEvent(context, { type: 'snapshot', snapshot: snapshotHost(context) });
}
