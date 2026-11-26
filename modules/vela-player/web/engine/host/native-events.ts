import { type Generation } from '../session';
import { PlaybackFault } from '../pipeline';
import type { HostContext } from './state';
import { saveVolume } from './platform';
import { endPlayback } from './session';
import { recoverPlayback } from './recovery';
import { emitHostEvent, publishHostState } from './events';
import { readPosition } from './position';
import { originalEndedEarly, originalLostResponse } from '../original-lost';
export function detachMedia(context: HostContext) {
  for (const remove of context.lifecycle.listeners) remove();
  context.lifecycle.listeners = [];
}
export function bindMedia(context: HostContext, token: Generation) {
  const { video } = context.surface;
  detachMedia(context);
  let waitingPosition: number | undefined;
  const playing = () => {
    waitingPosition = undefined;
    context.playback.status = 'playing';
    context.playback.failure = null;
    if (context.session.pendingSeek?.authorized) context.session.pendingSeek = undefined;
  };
  for (const [name, handler] of Object.entries({
    volumechange: () => {
      saveVolume(context);
    },
    playing: () => {
      if (!video.paused && !video.error && video.readyState >= 3) playing();
    },
    seeking: () => {
      waitingPosition = undefined;
    },
    seeked: () => {
      if (context.playback.status === 'buffering') waitingPosition = video.currentTime;
      if (
        context.session.pendingSeek?.authorized &&
        !context.playback.wantsPlay &&
        context.surface.video.readyState >= 2
      )
        context.session.pendingSeek = undefined;
      if (!context.playback.wantsPlay && video.readyState >= 2 && context.playback.status === 'buffering')
        context.playback.status = 'paused';
    },
    timeupdate: () => {
      // WebKit can advance after a seek without dispatching another playing event.
      if (
        context.playback.status === 'buffering' && context.playback.wantsPlay &&
        !video.paused && !video.seeking && !video.error &&
        waitingPosition !== undefined && video.currentTime > waitingPosition
      ) playing();
    },
    pause: () => {
      if (
        !context.playback.wantsPlay &&
        !['loading', 'recovering', 'failed', 'ended'].includes(context.playback.status)
      )
        context.playback.status = 'paused';
    },
    progress: () => {
      context.watchdog.loadEvents++;
    },
    waiting: () => {
      if (!['recovering', 'ended', 'failed'].includes(context.playback.status)) {
        context.playback.status = 'buffering';
        waitingPosition = video.seeking ? undefined : video.currentTime;
      }
    },
    ended: () => {
      const session = context.session.current;
      if (context.media.source?.original && session && originalEndedEarly(readPosition(context), session.duration)) {
        context.playback.status = 'loading';
        emitHostEvent(context, { type: 'session-refresh', sessionId: session.id,
          reason: 'original_lost', positionSeconds: readPosition(context), sourceGeneration: token.source });
        return;
      }
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
      const generation = context.session.controller.token();
      void (async () => {
        let message = e.message || `Media error ${e.code}`;
        let failureKind: 'network' | 'source' | 'decoder' = kind;
        // Chromium reports an HTTP range refusal as code 4 ("Format error").
        // Verify transport before treating it as an unsupported container.
        if ((e.code === 2 || e.code === 4) && context.media.source) {
          try {
            const response = await (context.surface.mediaAccess?.fetch ?? fetch)(context.media.source.url, {
              headers: { Range: 'bytes=0-0' }, signal: AbortSignal.any([generation.signal, AbortSignal.timeout(5000)]),
            });
            void response.body?.cancel();
            if (originalLostResponse(response) && context.session.current) {
              context.playback.status = 'loading';
              emitHostEvent(context, { type: 'session-refresh', sessionId: context.session.current.id,
                reason: 'original_lost', positionSeconds: readPosition(context), sourceGeneration: generation.source });
              publishHostState(context, true);
              return;
            }
            if (!response.ok) { message = `HTTP ${response.status}: ${message}`; failureKind = 'network'; }
          } catch (error) {
            if (generation.signal.aborted) return;
            message = 'Network read failed'; failureKind = 'network';
          }
        }
        await recoverPlayback(context, new PlaybackFault(message, failureKind), generation);
      })();
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
      if (name === 'timeupdate' && previous === context.playback.status) return;
      if (previous !== context.playback.status || failure !== context.playback.failure)
        context.telemetry.lastObservation = -Infinity;
      publishHostState(context);
    };
    video.addEventListener(name, listener);
    context.lifecycle.listeners.push(() => video.removeEventListener(name, listener));
  }
}
