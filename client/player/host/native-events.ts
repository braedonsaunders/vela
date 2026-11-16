import { type Generation } from '../session';
import { PlaybackFault } from '../pipeline';
import type { HostContext } from './state';
import { saveVolume } from './platform';
import { endPlayback } from './session';
import { recoverPlayback } from './recovery';
import { publishHostState } from './events';
export function detachMedia(context: HostContext) {
  for (const remove of context.lifecycle.listeners) remove();
  context.lifecycle.listeners = [];
}
export function bindMedia(context: HostContext, token: Generation) {
  const { video } = context.surface;
  detachMedia(context);
  for (const [name, handler] of Object.entries({
    volumechange: () => {
      saveVolume(context);
    },
    playing: () => {
      if (
        !context.surface.video.paused &&
        !context.surface.video.error &&
        context.surface.video.readyState >= 3
      ) {
        context.playback.status = 'playing';
        context.playback.failure = null;
        if (context.session.pendingSeek?.authorized) context.session.pendingSeek = undefined;
      }
    },
    seeked: () => {
      if (
        context.session.pendingSeek?.authorized &&
        !context.playback.wantsPlay &&
        context.surface.video.readyState >= 2
      )
        context.session.pendingSeek = undefined;
    },
    pause: () => {
      if (
        !context.playback.wantsPlay &&
        !['loading', 'recovering', 'failed', 'ended'].includes(context.playback.status)
      )
        context.playback.status = 'paused';
    },
    waiting: () => {
      if (!['recovering', 'ended', 'failed'].includes(context.playback.status))
        context.playback.status = 'buffering';
    },
    ended: () => {
      endPlayback(context);
    },
    error: () => {
      const e = video.error;
      if (
        !e ||
        !context.session.current ||
        context.lifecycle.disposed ||
        ['failed', 'ended'].includes(context.playback.status)
      )
        return;
      const kind = e.code === 2 ? 'network' : e.code === 3 ? 'decoder' : 'source';
      void recoverPlayback(
        context,
        new PlaybackFault(e.message || `Media error ${e.code}`, kind),
        context.session.controller.token(),
      );
    },
  })) {
    const listener = () => {
      if (
        !context.session.controller.current(token) ||
        ['failed', 'ended'].includes(context.playback.status) ||
        (context.media.backend === 'webgpu' && name !== 'volumechange')
      )
        return;
      const previous = context.playback.status;
      const failure = context.playback.failure;
      handler();
      if (previous !== context.playback.status || failure !== context.playback.failure)
        context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
    };
    video.addEventListener(name, listener);
    context.lifecycle.listeners.push(() => video.removeEventListener(name, listener));
  }
}
