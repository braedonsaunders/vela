import type { Source } from '../model';
import { type Generation } from '../session';
import { randomId } from '../../src/protocol/id';
import type { HostContext } from './state';
import { emitHostEvent, publishHostState } from './events';
import { failPlayback } from './recovery';
export function rejectCommand(context: HostContext, message: string) {
  if (context.tracks.pendingTracks) {
    if (context.tracks.pendingTracks.subtitle !== undefined)
      context.tracks.subtitlePreference = context.tracks.pendingTracks.previousSubtitlePreference;
    context.tracks.pendingTracks = undefined;
    context.tracks.deferredPath = null;
    if (message)
      emitHostEvent(context, { type: 'error', failure: { kind: 'action', message, recoverable: true } });
    publishHostState(context);
    return;
  }
  context.session.pendingSwitch = undefined;
  if (message) failPlayback(context, { kind: 'source', message, recoverable: false });
}
export function requestTracks(
  context: HostContext,
  tracks: {
    audio?: string;
    subtitle?: string | null;
  },
) {
  if (!context.session.current?.serverControlled) throw new Error('Server track selection is unavailable');
  if (context.tracks.pendingTracks) throw new Error('A track selection is already pending');
  context.tracks.pendingTracks = {
    ...tracks,
    previousSubtitlePreference: context.tracks.subtitlePreference,
    startedAt: performance.now(),
  };
  if (tracks.subtitle !== undefined) context.tracks.subtitlePreference = tracks.subtitle;
  emitHostEvent(context, {
    type: 'session-command',
    sessionId: context.session.current.id,
    command: {
      kind: 'tracks',
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
      idempotencyKey: randomId(),
      ...(tracks.audio === undefined ? {} : { audioTrackId: tracks.audio }),
      ...(tracks.subtitle === undefined ? {} : { subtitleTrackId: tracks.subtitle }),
    },
  });
}
export function requestSeek(context: HostContext, seconds: number) {
  context.session.pendingSeek = { position: seconds, startedAt: performance.now(), authorized: false };
  context.playback.status = 'buffering';
  context.media.runtime?.pause();
  context.surface.video.pause();
  context.telemetry.lastObservation = -Infinity;
  publishHostState(context);
  emitHostEvent(context, {
    type: 'session-command',
    sessionId: context.session.current!.id,
    command: {
      kind: 'seek',
      positionSeconds: seconds,
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
      idempotencyKey: randomId(),
    },
  });
}
export function requestSwitch(
  context: HostContext,
  source:
    | Source
    | {
        id: string;
        onDemand: true;
      },
  position: number,
  recovery = false,
) {
  const boundary =
    'onDemand' in source
      ? position
      : source.boundaries?.filter((at) => at <= position).sort((a, b) => b - a)[0];
  if (boundary === undefined) throw new Error('No independent switch boundary offered by server');
  context.session.pendingSwitch = {
    startedAt: performance.now(),
    sessionId: context.session.current!.id,
    sourceId: source.id,
    source: context.session.controller.source,
    seek: context.session.controller.seek,
    position,
    recovery,
  };
  emitHostEvent(context, {
    type: 'session-command',
    sessionId: context.session.current!.id,
    command: {
      kind: 'switch',
      pathId: source.id,
      atSeconds: boundary,
      sourceGeneration: context.session.controller.source,
      seekGeneration: context.session.controller.seek,
      idempotencyKey: randomId(),
    },
  });
}
export function awaitingReplacement(context: HostContext, token: Generation): boolean {
  if (!context.session.current?.serverControlled || !context.session.controller.current(token)) return false;
  const pending = context.session.pendingSwitch;
  return !!(
    (pending &&
      pending.sessionId === token.sessionId &&
      pending.source === token.source &&
      pending.seek === token.seek) ||
    (context.session.pendingSeek && !context.session.pendingSeek.authorized) ||
    context.tracks.pendingTracks
  );
}
