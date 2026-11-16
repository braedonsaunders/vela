// The playback controller over a server: what a watch route needs from core's ServerAdapter
// (startPlayback, sessionSnapshot, reportObservation, and sendCommand for every session command),
// with the server's answers turned into the chrome's outcomes. A refusal keeps the server's own
// words; all streams in use is told apart so the chrome can say so.
import { createContext, useContext } from 'react';
import { msg } from '@vela/core';
import type { PlaybackPlan, PlayerObservation, SessionCommand } from '@vela/player-api';
import type { ClientCapabilities, PlaybackPreparing, PlaybackRequest, SessionSnapshot } from '../../../../../protocol/v0/types';
import type { PlaybackController, StartOutcome } from './session';

/** The server side, as core's adapters offer it (`command` is core's sendCommand bound to the adapter). */
export interface PlaybackServer {
  startPlayback(request: PlaybackRequest): Promise<PlaybackPlan | PlaybackPreparing>;
  command(sessionId: string, command: SessionCommand): Promise<PlaybackPlan>;
  sessionSnapshot(sessionId: string): Promise<SessionSnapshot>;
  reportObservation(sessionId: string, observation: PlayerObservation): Promise<unknown>;
}

const key = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/** A server refusal carries the v0 error (core's VelaError.detail); anything else is said plainly. */
function refusal(error: unknown): StartOutcome {
  const detail = (error as { detail?: { class?: string; message?: string } } | null)?.detail;
  return { kind: 'refused', capacity: detail?.class === 'capacity', message: detail?.message ?? msg('ui.playbackCouldnTBeStarted') };
}

/** `client` is what this device's player plays, as negotiated with the server. */
export function playbackController(server: PlaybackServer, client: ClientCapabilities): PlaybackController {
  return {
    async start(titleId) {
      try {
        const answer = await server.startPlayback({ titleId, client, idempotencyKey: key() });
        if ('state' in answer && answer.state === 'preparing' && !('sessionId' in answer)) {
          return { kind: 'preparing', retryAfterSeconds: answer.retryAfterSeconds };
        }
        return { kind: 'plan', plan: answer as PlaybackPlan };
      } catch (error) {
        return refusal(error);
      }
    },
    command: (plan, command) => server.command(plan.sessionId, command),
    refresh: async sessionId => (await server.sessionSnapshot(sessionId)).plan,
    observe: async (sessionId, observation) => {
      await server.reportObservation(sessionId, observation);
    },
  };
}

/** The app provides its controller here; a watch route without one says playback is unavailable. */
export const PlaybackControllerContext = createContext<PlaybackController | null>(null);

export function usePlaybackController(): PlaybackController | null {
  return useContext(PlaybackControllerContext);
}
