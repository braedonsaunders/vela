import type { VelaPlayerProps } from '../../../packages/player-api/src/types';
import type { PlaybackEngine } from '../engine';
import type { EngineEvent, Failure } from '../model';
import { redactMediaError } from '../media-auth';
import { observation } from '../protocol';

export const publicFailure = (failure: Failure): Failure => ({
  ...failure,
  message: redactMediaError(failure.message),
});

/** Observations are scheduled independently of media IO and sent by the controller. */
export function createViewEvents(props: () => VelaPlayerProps, engine: () => PlaybackEngine) {
  let lastReport = 0;
  let sequence = 0;
  let reportedFailure = '';
  let reportedTracks = '';
  let endedReport = '';
  return (event: EngineEvent) => {
    const current = props();
    if (event.type === 'error') {
      current.onError?.(publicFailure(event.failure));
      return;
    }
    if (event.type === 'session-command') {
      current.onSessionCommand?.({ sessionId: event.sessionId, command: event.command });
      return;
    }
    if (event.type === 'session-refresh') {
      current.onSessionRefresh?.({ sessionId: event.sessionId });
      return;
    }
    const snapshot = event.snapshot.failure
      ? { ...event.snapshot, failure: publicFailure(event.snapshot.failure) }
      : event.snapshot;
    current.onSnapshot?.(snapshot);
    if (current.ambient || !engine().observationAllowed) return;
    const failureKey = snapshot.failure
      ? JSON.stringify([
          snapshot.sessionId,
          snapshot.sourceGeneration,
          snapshot.seekGeneration,
          snapshot.sourceId,
          snapshot.failure.kind,
          snapshot.failure.message,
        ])
      : '';
    const trackKey = JSON.stringify([
      snapshot.sessionId,
      snapshot.sourceGeneration,
      snapshot.seekGeneration,
      snapshot.audioTrackId,
      snapshot.subtitleTrackId,
    ]);
    const now = performance.now();
    if (
      now - lastReport < 1000 &&
      (!failureKey || failureKey === reportedFailure) &&
      trackKey === reportedTracks
    )
      return;
    if (failureKey) reportedFailure = failureKey;
    const endedKey = JSON.stringify([snapshot.sessionId, snapshot.sourceGeneration, snapshot.seekGeneration]);
    if (snapshot.state === 'ended' && endedReport === endedKey) return;
    if (snapshot.state === 'ended') endedReport = endedKey;
    const report = observation(snapshot, ++sequence);
    if (report && snapshot.sessionId) {
      lastReport = now;
      reportedTracks = trackKey;
      current.onObservation?.({ sessionId: snapshot.sessionId, observation: report });
    }
  };
}
