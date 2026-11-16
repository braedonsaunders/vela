import type { Command } from '../model';
import type { HostContext } from './state';
import { readDuration } from './position';
import { requestSeek } from './authorizations';
import { activateSource } from './media';
import { publishHostState } from './events';
import { resetProgress } from './watchdog';
export async function seekFromCommand(
  context: HostContext,
  command: Extract<
    Command,
    {
      type: 'seek';
    }
  >,
) {
  if (
    !Number.isFinite(command.seconds) ||
    command.seconds < 0 ||
    (readDuration(context) !== null && command.seconds > readDuration(context)!)
  )
    throw new Error('Seek outside media timeline');
  if (context.session.current?.live && context.media.runtime?.live) {
    const original = context.media.runtime;
    const bounds = original.live;
    if (!bounds) throw new Error('Live source was retired');
    if (command.seconds < bounds.startSeconds || command.seconds >= bounds.edgeSeconds)
      throw new Error('Seek is outside the retained live window');
    const token = context.session.controller.token();
    context.session.pendingSeek = {
      position: command.seconds,
      startedAt: performance.now(),
      authorized: true,
    };
    context.playback.status = 'buffering';
    publishHostState(context, true);
    resetProgress(context, command.seconds);
    if (context.tracks.overlay)
      void context.tracks.overlay.seek(command.seconds, ++context.tracks.overlayEpoch).catch(() => {});
    await original.seek(command.seconds);
    if (context.session.controller.current(token) && context.media.runtime === original) {
      resetProgress(context, original.position);
      context.session.pendingSeek = undefined;
      context.playback.status = original.readout.state;
    }
    return true;
  }
  if (context.session.current?.serverControlled) {
    requestSeek(context, command.seconds);
    return true;
  }
  const token = context.session.controller.changeSeek();
  resetProgress(context, command.seconds);
  if (context.media.runtime) {
    const original = context.media.runtime;
    context.media.runtimeGeneration = token;
    context.session.pendingSeek = {
      position: command.seconds,
      startedAt: performance.now(),
      authorized: true,
    };
    publishHostState(context, true);
    if (context.tracks.overlay)
      void context.tracks.overlay.seek(command.seconds, ++context.tracks.overlayEpoch).catch(() => {});
    await original.seek(command.seconds);
    if (context.session.controller.current(token) && context.media.runtime === original) {
      resetProgress(context, original.position);
      context.session.pendingSeek = undefined;
      context.playback.status = original.readout.state;
    }
  } else if (context.media.backend === 'mse' && context.media.source)
    await activateSource(context, context.media.source, command.seconds, false, true);
  else context.surface.video.currentTime = Math.max(0, command.seconds - context.media.nativeOrigin);
  return true;
}
