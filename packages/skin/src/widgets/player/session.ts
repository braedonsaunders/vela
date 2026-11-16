// One watch session on the client: start it through the route's playback controller, number
// the chrome's commands for the view, take the view's snapshots and failures, answer the session
// commands and refreshes the engine asks for with newer plans, and stop the session on the way
// out. The controller owns the server and the credentials; this owns the order of things.
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Command,
  Failure,
  PlaybackPlan,
  PlayerObservation,
  SessionCommand,
  Snapshot,
  VelaPlayerProps,
} from '@vela/player-api';
import { msg } from '@vela/core';
import type { CommandInput, PlayerChromeState, StartFailure } from './context';

export type StartOutcome =
  | { kind: 'plan'; plan: PlaybackPlan }
  /** The server is preparing the media; ask again after this long. */
  | { kind: 'preparing'; retryAfterSeconds: number }
  | { kind: 'refused'; capacity: boolean; message: string };

/** The trusted side of playback: the server adapter and the media credentials behind it. */
export interface PlaybackController {
  start(titleId: string): Promise<StartOutcome>;
  /** Apply a session command; answers the plan that results. */
  command(plan: PlaybackPlan, command: SessionCommand): Promise<PlaybackPlan>;
  /** Read the session's current authoritative plan. */
  refresh(sessionId: string): Promise<PlaybackPlan>;
  /** Report what the player observed (position, state, ranges); at most one a second. */
  observe(sessionId: string, observation: PlayerObservation): Promise<void>;
}

export interface PlaybackSession {
  chrome: Omit<PlayerChromeState, 'title' | 'close'>;
  /** The props the route hands VelaPlayerView. */
  view: VelaPlayerProps;
  /** Stop the session on the server (the route then leaves). */
  stop(): void;
}

const key = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A newer plan of the same session replaces the one held; anything else is ignored. */
function newer(held: PlaybackPlan | null, next: PlaybackPlan): boolean {
  return !held || held.sessionId !== next.sessionId || next.revision > held.revision;
}

function stopCommand(plan: PlaybackPlan): SessionCommand {
  return {
    kind: 'stop',
    sourceGeneration: plan.sourceGeneration,
    seekGeneration: plan.seekGeneration,
    idempotencyKey: `stop-${plan.sessionId}-${plan.sourceGeneration}-${plan.seekGeneration}`,
  };
}

function words(error: unknown): string {
  return error instanceof Error && error.message ? error.message : msg('ui.playbackCouldnTBeStarted');
}

export function usePlaybackSession(controller: PlaybackController, titleId: string): PlaybackSession {
  const [attempt, setAttempt] = useState(0);
  const [plan, setPlan] = useState<PlaybackPlan | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [startFailure, setStartFailure] = useState<StartFailure | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [actionError, setActionError] = useState('');
  const [command, setCommand] = useState<Command | undefined>();
  const nextId = useRef(0);
  const held = useRef<PlaybackPlan | null>(null);
  held.current = plan;
  /** The session last stopped, so leaving after a retry stops it once. */
  const stopped = useRef('');

  const adopt = useCallback((next: PlaybackPlan) => {
    setPlan(current => (newer(current, next) ? next : current));
  }, []);

  // Start (and, while the server prepares the media, ask again when it says to).
  useEffect(() => {
    if (!titleId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      controller.start(titleId).then(
        outcome => {
          if (!live) return;
          if (outcome.kind === 'plan') adopt(outcome.plan);
          else if (outcome.kind === 'preparing') timer = setTimeout(ask, Math.max(1, outcome.retryAfterSeconds) * 1000);
          else setStartFailure({ capacity: outcome.capacity, message: outcome.message });
        },
        error => {
          if (live) setStartFailure({ capacity: false, message: words(error) });
        },
      );
    };
    setPlan(null);
    setSnapshot(null);
    setStartFailure(null);
    setFailure(null);
    setActionError('');
    ask();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [controller, titleId, attempt, adopt]);

  const stop = useCallback(() => {
    const current = held.current;
    if (!current || current.state === 'ended' || stopped.current === current.sessionId) return;
    stopped.current = current.sessionId;
    controller.command(current, stopCommand(current)).catch(() => undefined);
  }, [controller]);

  // Leaving the route (or starting over) ends the session it held.
  useEffect(() => () => stop(), [stop, attempt]);

  const send = useCallback((input: CommandInput) => {
    nextId.current += 1;
    setActionError('');
    setCommand({ ...input, id: nextId.current } as Command);
  }, []);

  const retry = useCallback(() => {
    if (failure?.recoverable && held.current) {
      setFailure(null);
      send({ type: 'retry' });
      return;
    }
    stop();
    setAttempt(n => n + 1);
  }, [failure, send, stop]);

  const view: VelaPlayerProps = {
    plan: plan ?? undefined,
    command,
    onSnapshot: next => {
      setSnapshot(next);
      if (next.failure === null) setFailure(null);
    },
    onError: setFailure,
    onCommand: event => {
      if (!event.ok && event.failure) setActionError(event.failure.message);
    },
    onObservation: event => {
      if (held.current?.sessionId === event.sessionId)
        controller.observe(event.sessionId, event.observation).catch(() => undefined);
    },
    onSessionCommand: event => {
      const current = held.current;
      if (!current || current.sessionId !== event.sessionId) return;
      controller
        .command(current, { ...event.command, idempotencyKey: event.command.idempotencyKey || key() })
        .then(adopt, error => setActionError(words(error)));
    },
    onSessionRefresh: event => {
      controller.refresh(event.sessionId).then(adopt, error => setActionError(words(error)));
    },
  };

  return {
    chrome: { plan, snapshot, startFailure, failure, actionError, send, retry },
    view,
    stop,
  };
}
