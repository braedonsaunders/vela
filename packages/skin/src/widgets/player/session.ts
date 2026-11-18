// One watch session on the client, over core's playback slice: start it when the route opens and
// stop it when the route leaves, number the chrome's commands for the view, take the view's
// snapshots and failures, and hand the engine's session commands and observations to core, which
// talks to the server and follows the session. Core owns the server; this owns the order of things.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { msg, VelaError, type PlaybackState, type PlaybackTarget } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { PlaybackPlan } from '../../../../protocol/types';
import type { Command, Failure, Snapshot, VelaPlayerProps } from '@vela/player-api';
import type { CommandInput, PlayerChromeState, StartFailure } from './context';
import { belongs, qualityReached } from './present';

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

export interface LiveSessionOwner {
  plan: PlaybackPlan | null;
  snapshot(snapshot: Snapshot): void;
  failed(): void;
  updatePlan(plan: PlaybackPlan): void;
}

export function usePlaybackSession(target: PlaybackTarget, owner?: LiveSessionOwner): PlaybackSession {
  const vela = useVela();
  const playback = useVelaState(state => state.playback);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refused, setRefused] = useState('');
  const [command, setCommand] = useState<Command | undefined>();
  const nextId = useRef(0);
  const pendingQuality = useRef(0);
  const [pendingQualityId, setPendingQualityId] = useState<string>();
  const position = useRef(0);
  const paused = useRef(false);
  const { kind, id } = target;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const external = owner !== undefined;
  const ownedPlan = owner?.plan;
  const ownedId = ownedPlan?.sessionId ?? '';

  useEffect(() => {
    if (!external || !ownedPlan) return;
    void vela.playback.attach({ kind, id }, ownedPlan).catch(error => console.warn('Live session attach failed', error));
    return () => vela.playback.detach(ownedPlan.sessionId);
  }, [vela, external, ownedId, kind, id]);

  useEffect(() => {
    if (external && playback.plan && playback.sessionId === ownedId) ownerRef.current?.updatePlan(playback.plan);
  }, [external, playback.plan, playback.sessionId, ownedId]);

  const begin = useCallback(
    (positionSeconds?: number) => {
      setSnapshot(null);
      setFailure(null);
      setRefused('');
      pendingQuality.current = 0;
      setPendingQualityId(undefined);
      const from = kind === 'title' && positionSeconds !== undefined ? { positionSeconds } : {};
      void vela.playback.start({ ...target, ...from } as PlaybackTarget);
    },
    [vela, kind, id, target.kind === 'title' ? target.mediaSourceId : undefined, target.kind === 'title' ? target.audioTrackId : undefined],
  );

  useEffect(() => {
    if (!id || external) return;
    begin();
    return () => void vela.playback.stop();
  }, [vela, id, begin, external]);

  // A backgrounded app may be suspended and ended there without running JavaScript (the Apple TV's TV
  // button): the session is stopped as the app leaves the foreground, and started again where it was when
  // it returns. The transient 'inactive' state (Control Center, a system alert) keeps it. A browser tab
  // in the background keeps playing, so the web keeps its session.
  const away = useRef(false);
  useEffect(() => {
    if (!id || external || Platform.OS === 'web') return;
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
  }, [vela, id, begin, external]);

  // The server ended the session under the player (it heard nothing from it for two minutes, or it restarted):
  // a new session starts where this one was, once per session, and stays paused if it was paused.
  const restarted = useRef('');
  const resumePaused = useRef(false);
  const startOver = useCallback(
    (gone: string) => {
      if (restarted.current === gone) return;
      restarted.current = gone;
      resumePaused.current = paused.current;
      if (external) ownerRef.current?.failed();
      else begin(position.current > 0 ? position.current : undefined);
    },
    [begin, external],
  );

  const stop = useCallback(() => { if (!external) void vela.playback.stop(); }, [vela, external]);

  const send = useCallback((input: CommandInput) => {
    nextId.current += 1;
    setRefused('');
    if (input.type === 'quality') { pendingQuality.current = nextId.current; setPendingQualityId(input.renditionId ?? 'auto'); }
    setCommand({ ...input, id: nextId.current } as Command);
  }, []);

  // An engine failure it can recover from is retried in place; anything else starts over where it stopped.
  const retry = useCallback(() => {
    if (failure?.recoverable && playback.plan) {
      setFailure(null);
      send({ type: 'retry' });
      return;
    }
    if (external) ownerRef.current?.failed();
    else begin(position.current > 0 ? position.current : undefined);
  }, [failure, playback.plan, send, begin, external]);

  const plan = external && playback.sessionId !== ownedId ? null : playback.plan;
  const sessionId = plan?.sessionId ?? '';
  useEffect(() => {
    if (pendingQualityId && qualityReached(pendingQualityId, snapshot, plan)) setPendingQualityId(undefined);
  }, [pendingQualityId, snapshot, plan]);
  useEffect(() => { if (playback.error) setPendingQualityId(undefined); }, [playback.error]);

  useEffect(() => {
    if (!sessionId || !resumePaused.current) return;
    resumePaused.current = false;
    send({ type: 'pause' });
  }, [sessionId, send]);

  const view: VelaPlayerProps = {
    plan: plan ?? undefined,
    command,
    onSnapshot: next => {
      setSnapshot(next);
      if (belongs(next, plan)) {
        position.current = next.position;
        paused.current = next.state === 'paused';
      }
      if (next.failure === null) setFailure(null);
      ownerRef.current?.snapshot(next);
      vela.playback.snapshot(next);
    },
    onError: error => { setFailure(error); setPendingQualityId(undefined); if (external) ownerRef.current?.failed(); },
    onCommand: event => {
      if (!event.ok && event.id === pendingQuality.current) setPendingQualityId(undefined);
      if (!event.ok && event.failure) setRefused(event.failure.message);
    },
    onObservation: event => {
      if (event.sessionId !== sessionId) return;
      vela.playback.observe(event.sessionId, event.observation).catch(error => {
        const gone = error instanceof VelaError && (error.status === 404 || error.status === 410);
        if (gone) startOver(event.sessionId);
        else console.warn(`Playback observation not delivered: ${String(error)}`);
      });
    },
    onSessionCommand: event => {
      if (event.sessionId === sessionId) void vela.playback.command(event.sessionId, event.command);
    },
    // An expired grant or a stale reply: core re-reads the session's authoritative plan; a gone session starts over.
    onSessionRefresh: event => {
      if (event.sessionId !== sessionId) return;
      void vela.playback.refresh(event.sessionId).then(live => {
        if (!live) startOver(event.sessionId);
      });
    },
  };

  return {
    chrome: {
      plan,
      snapshot,
      startFailure: startFailure(playback),
      failure,
      actionError: refused || (playback.phase === 'playing' ? playback.error : ''),
      pendingQualityId,
      send,
      retry,
    },
    view,
    stop,
  };
}
