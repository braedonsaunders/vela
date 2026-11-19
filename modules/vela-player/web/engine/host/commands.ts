import { seekFromCommand } from './command-seek';
import { selectAudioFromCommand, selectSubtitleFromCommand } from './command-tracks';
import { selectQualityFromCommand, switchPathFromCommand } from './command-selection';
import { updateSubtitlePreference } from '../universal/subtitles/preferences';
import type { Command, Failure } from '../model';
import type { HostContext } from './state';
import { playMedia, pauseMedia } from './transport';
import { loadSession } from './session';
import { readPosition, readDuration } from './position';
import { publishHostState, emitHostEvent } from './events';
import { catchUpTarget } from './live';
import { saveVolume, pipAvailable, fullscreenAvailable } from './platform';
export async function executeCommand(context: HostContext, command: Command) {
  if (context.lifecycle.disposed) {
    return { kind: 'action', message: 'Player is disposed', recoverable: false } satisfies Failure;
  }
  let failure: Failure | undefined;
  try {
    switch (command.type) {
      case 'play':
        context.playback.localIntent = 'playing';
        context.playback.wantsPlay = true;
        // Startup applies the latest intent after metadata and the resume seek.
        if (context.media.runtime || context.surface.video.readyState > 0) await playMedia(context);
        break;
      case 'pause':
        context.playback.localIntent = 'paused';
        context.playback.wantsPlay = false;
        pauseMedia(context);
        break;
      case 'retry':
        if (context.session.current)
          await loadSession(context, {
            ...context.session.current,
            position: context.playback.terminalMedia?.position ?? readPosition(context),
          });
        break;
      case 'switchPath':
        if (!(await switchPathFromCommand(context, command))) {
          return { kind: 'action', message: 'Command superseded', recoverable: true } satisfies Failure;
        }
        break;
      case 'seekBy': {
        if (!Number.isFinite(command.seconds)) throw new Error('Invalid relative seek');
        const upper = readDuration(context) ?? Infinity;
        failure = await executeCommand(context, {
          id: command.id,
          type: 'seek',
          seconds: Math.max(
            0,
            Math.min(
              upper,
              (context.session.pendingSeek?.position ?? readPosition(context)) + command.seconds,
            ),
          ),
        });
        break;
      }
      case 'seek':
        if (!(await seekFromCommand(context, command))) {
          return { kind: 'action', message: 'Command superseded', recoverable: true } satisfies Failure;
        }
        break;
      case 'catchUp': {
        const target = catchUpTarget(context);
        if (target === null) throw new Error('No newer usable live buffer or seekable range');
        failure = await executeCommand(context, { id: command.id, type: 'seek', seconds: target });
        break;
      }
      case 'mute':
        context.surface.video.muted = command.muted ?? !context.surface.video.muted;
        context.media.runtime?.setMuted(context.surface.video.muted);
        saveVolume(context);
        context.telemetry.lastObservation = -Infinity;
        break;
      case 'volume':
        if (!Number.isFinite(command.value) || command.value < 0 || command.value > 1)
          throw new Error('Volume outside 0–1');
        context.surface.video.volume = command.value;
        context.media.runtime?.setVolume(command.value);
        if (command.value > 0) context.surface.video.muted = false;
        context.media.runtime?.setMuted(context.surface.video.muted);
        saveVolume(context);
        context.telemetry.lastObservation = -Infinity;
        break;
      case 'speed':
        if (context.session.current?.live) throw new Error('Live playback speed is managed automatically');
        if (!Number.isFinite(command.value) || command.value < 0.5 || command.value > 2)
          throw new Error('Playback speed must be between 0.5 and 2');
        if (context.media.runtime) {
          if (!context.media.runtime.setSpeed) throw new Error('Playback speed requires an updated runtime');
          await context.media.runtime.setSpeed(command.value);
        } else context.surface.video.playbackRate = command.value;
        context.playback.speed = command.value;
        break;
      case 'subtitleStyle':
        context.tracks.subtitleStyle = updateSubtitlePreference(context.tracks.subtitleStyle, command.value);
        context.tracks.overlay?.setPreferences(context.tracks.subtitleStyle);
        break;
      case 'quality':
        if (!(await selectQualityFromCommand(context, command))) {
          return { kind: 'action', message: 'Command superseded', recoverable: true } satisfies Failure;
        }
        break;
      case 'audio':
        if (!(await selectAudioFromCommand(context, command))) {
          return { kind: 'action', message: 'Command superseded', recoverable: true } satisfies Failure;
        }
        break;
      case 'subtitle':
        if (!(await selectSubtitleFromCommand(context, command))) {
          return { kind: 'action', message: 'Command superseded', recoverable: true } satisfies Failure;
        }
        break;
      // Older shells may still send this. Latency now follows source policy
      // and sustained buffer evidence, never a viewer mode override.
      case 'lowDelay':
        break;
      case 'pip':
        if (!pipAvailable(context)) throw new Error('Picture-in-picture is unavailable');
        if (document.pictureInPictureElement === context.surface.video) await document.exitPictureInPicture();
        else if (document.pictureInPictureEnabled && context.surface.video.requestPictureInPicture)
          await context.surface.video.requestPictureInPicture();
        else context.surface.video.webkitSetPresentationMode?.('picture-in-picture');
        break;
      case 'fullscreen':
        if (!fullscreenAvailable(context)) throw new Error('Fullscreen is unavailable');
        if (document.fullscreenElement === context.surface.fullscreenContainer)
          await document.exitFullscreen();
        else if (document.fullscreenEnabled && context.surface.fullscreenContainer.requestFullscreen)
          await context.surface.fullscreenContainer.requestFullscreen();
        else if (context.surface.video.webkitDisplayingFullscreen)
          context.surface.video.webkitExitFullscreen?.();
        else if (context.surface.video.webkitEnterFullscreen) context.surface.video.webkitEnterFullscreen();
        else throw new Error('Fullscreen is unavailable');
        break;
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { kind: 'action', message: 'Command superseded', recoverable: true } satisfies Failure;
    }
    failure = { kind: 'action', message: e instanceof Error ? e.message : String(e), recoverable: true };
    emitHostEvent(context, {
      type: 'error',
      failure,
    });
  }
  publishHostState(context);
  return failure;
}
