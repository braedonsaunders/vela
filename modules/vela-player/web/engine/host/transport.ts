import type { HostContext } from './state';
import { publishHostState } from './events';
import { failPlayback } from './recovery';
import { PlayIntent, playErrorKind } from '../play-intent';

const intents = new WeakMap<HostContext, PlayIntent>();
function transport(context: HostContext) {
  let intent = intents.get(context);
  if (!intent) {
    intent = new PlayIntent(() => context.surface.video.play(), () => context.surface.video.pause());
    intents.set(context, intent);
  }
  return intent;
}
// Source retirement must invalidate queued work before pause/load replaces media.
export function retirePlayIntent(context: HostContext) {
  intents.get(context)?.retire();
  intents.delete(context);
}
export function pauseMedia(context: HostContext) {
  context.media.runtime?.pause();
  void transport(context).set(false);
}
export async function playMedia(context: HostContext) {
  if (context.media.runtime) {
    context.media.runtime.resume();
    return;
  }
  const token = context.session.controller.token();
  try {
    const played = await transport(context).set(true);
    if (!played || !context.playback.wantsPlay || !context.session.controller.current(token)) return;
    if (['failed', 'ended'].includes(context.playback.status) || context.surface.video.error) return;
    context.playback.status = 'playing';
    context.playback.failure = null;
    if (context.session.pendingSeek?.authorized) context.session.pendingSeek = undefined;
    context.telemetry.lastObservation = -Infinity;
    publishHostState(context);
  } catch (error) {
    if (!context.session.controller.current(token)) return;
    const kind = playErrorKind(error);
    if (kind === 'cancelled') return;
    if (kind === 'blocked') {
      context.playback.wantsPlay = false;
      context.playback.localIntent = 'paused';
      pauseMedia(context);
      context.playback.status = 'paused';
      context.playback.failure = null;
      publishHostState(context);
      return;
    }
    failPlayback(context, {
      kind: 'action', message: error instanceof Error ? error.message : String(error), recoverable: true,
    });
  }
}
