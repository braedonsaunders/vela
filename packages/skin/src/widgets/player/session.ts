// One watch session on the client, over core's playback slice: start it when the route opens and
// stop it when the route leaves, number the chrome's commands for the view, take the view's
// snapshots and failures, and hand the engine's session commands and observations to core, which
// talks to the server and follows the session. Core owns the server; this owns the order of things.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { msg, type PlaybackState, type PlaybackTarget } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { Command, Failure, Snapshot, VelaPlayerProps } from '@vela/player-api';
import type { CommandInput, PlayerChromeState, StartFailure } from './context';
import { belongs } from './present';

export interface PlaybackSession {
  chrome: Omit<PlayerChromeState, 'title' | 'close'>;
  /** The props the route hands VelaPlayerView. */
  view: VelaPlayerProps;
  /** Stop the session on the server (the route then leaves). */
  stop(): void;
}

/** A start the server refused, unless core is already asking again on the server's terms. */
function startFailure(playback: PlaybackState): StartFailure | null {
  if (playback.phase !== 'failed' || playback.retryAfterSeconds > 0) return null;
  return {
    capacity: playback.errorClass === 'capacity',
    message: playback.error || msg('ui.playbackCouldnTBeStarted'),
  };
}

export function usePlaybackSession(target: PlaybackTarget): PlaybackSession {
  const vela = useVela();
  const playback = useVelaState(state => state.playback);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refused, setRefused] = useState('');
  const [command, setCommand] = useState<Command | undefined>();
  const nextId = useRef(0);
  const position = useRef(0);
  const { kind, id } = target;

  const begin = useCallback(
    (positionSeconds?: number) => {
      setSnapshot(null);
      setFailure(null);
      setRefused('');
      const from = kind === 'title' && positionSeconds !== undefined ? { positionSeconds } : {};
      void vela.playback.start({ kind, id, ...from } as PlaybackTarget);
    },
    [vela, kind, id],
  );

  useEffect(() => {
    if (!id) return;
    begin();
    return () => void vela.playback.stop();
  }, [vela, id, begin]);

  // A backgrounded app may be suspended and ended there without running JavaScript (the Apple TV's TV
  // button): the session is stopped as the app leaves the foreground, and started again where it was when
  // it returns. The transient 'inactive' state (Control Center, a system alert) keeps it. A browser tab
  // in the background keeps playing, so the web keeps its session.
  const away = useRef(false);
  useEffect(() => {
    if (!id || Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' && !away.current) {
        away.current = true;
        void vela.playback.stop();
      } else if (state === 'active' && away.current) {
        away.current = false;
        begin(position.current > 0 ? position.current : undefined);
      }
    });
    return () => subscription.remove();
  }, [vela, id, begin]);

  const stop = useCallback(() => void vela.playback.stop(), [vela]);

  const send = useCallback((input: CommandInput) => {
    nextId.current += 1;
    setRefused('');
    setCommand({ ...input, id: nextId.current } as Command);
  }, []);

  // An engine failure it can recover from is retried in place; anything else starts over where it stopped.
  const retry = useCallback(() => {
    if (failure?.recoverable && playback.plan) {
      setFailure(null);
      send({ type: 'retry' });
      return;
    }
    begin(position.current > 0 ? position.current : undefined);
  }, [failure, playback.plan, send, begin]);

  const plan = playback.plan;
  const sessionId = plan?.sessionId ?? '';
  const view: VelaPlayerProps = {
    plan: plan ?? undefined,
    command,
    onSnapshot: next => {
      setSnapshot(next);
      if (belongs(next, plan)) position.current = next.position;
      if (next.failure === null) setFailure(null);
      vela.playback.snapshot(next);
    },
    onError: setFailure,
    onCommand: event => {
      if (!event.ok && event.failure) setRefused(event.failure.message);
    },
    onObservation: event => {
      if (event.sessionId === sessionId)
        vela.playback.observe(event.sessionId, event.observation).catch(() => undefined);
    },
    onSessionCommand: event => {
      if (event.sessionId === sessionId) void vela.playback.command(event.sessionId, event.command);
    },
    // An expired grant or a stale reply: core re-reads the session's authoritative plan.
    onSessionRefresh: event => {
      if (event.sessionId === sessionId) void vela.playback.refresh(event.sessionId);
    },
  };

  return {
    chrome: {
      plan,
      snapshot,
      startFailure: startFailure(playback),
      failure,
      actionError: refused || (playback.phase === 'playing' ? playback.error : ''),
      send,
      retry,
    },
    view,
    stop,
  };
}
