import type { HostContext } from './state';
import { publishHostState } from './events';
import { failPlayback } from './recovery';
export async function playMedia(context: HostContext) {
  if (context.media.runtime) {
    context.media.runtime.resume();
    return;
  }
  const token = context.session.controller.token();
  try {
    await context.surface.video.play();
    if (context.session.controller.current(token)) {
      if (['failed', 'ended'].includes(context.playback.status) || context.surface.video.error) return;
      context.playback.status = 'playing';
      context.playback.failure = null;
      if (context.session.pendingSeek?.authorized) context.session.pendingSeek = undefined;
      context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
    }
  } catch (e) {
    if (!context.session.controller.current(token)) return;
    if (e instanceof DOMException && e.name === 'NotAllowedError' && !context.surface.video.muted) {
      context.surface.video.muted = true;
      try {
        await context.surface.video.play();
        if (!context.session.controller.current(token)) return;
        context.playback.status = 'playing';
        context.playback.failure = null;
        if (context.session.pendingSeek?.authorized) context.session.pendingSeek = undefined;
        context.telemetry.lastObservation = -Infinity;
        publishHostState(context);
        return;
      } catch (retryError) {
        e = retryError;
      }
    }
    if (context.session.controller.current(token))
      failPlayback(context, {
        kind: 'action',
        message: e instanceof Error ? e.message : String(e),
        recoverable: true,
      });
  }
}
