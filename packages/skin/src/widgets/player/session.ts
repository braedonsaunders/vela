// One watch session on the client, over core's playback slice: start it when the route opens and
// stop it when the route leaves, number the chrome's commands for the view, take the view's
// snapshots and failures, and hand the engine's session commands and observations to core, which
// talks to the server and follows the session. Core owns the server; this owns the order of things.
import { quietPlayback } from '../../quiet-playback';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { commandOrigin, msg, VelaError, withSessionVersions, type PlaybackTarget, type StartRefusal } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { PlaybackPlan } from '../../../../protocol/types';
import type { Command, Failure, Snapshot, VelaPlayerProps } from '@vela/player-api';
import type { ChromeTarget, CommandInput, PlayerChromeState, StartRetrying } from './context';
import { belongs, qualityReached } from './present';
import { startFailure, startFailureOf, startRetrying } from './start-failure';
import { preparingRetry } from '../versions';

export interface PlaybackSession {
  chrome: Omit<PlayerChromeState, 'title' | 'close'>;
  /** The props the route hands VelaPlayerView. */
  view: VelaPlayerProps;
  /** Stop the session on the server (the route then leaves). */
  stop(): void;
}

/** A live channel whose session another owner (the live controller's tile) starts and holds. */
export interface LiveSessionOwner {
  plan: PlaybackPlan | null;
  /** Why the owner could not start the channel, once it gave up. */
  failure: StartRefusal | null;
  /** The owner is asking again on the server's terms. */
  retrying: StartRetrying | null;
  snapshot(snapshot: Snapshot): void;
  /** The viewer's Try again: the owner starts the channel afresh. */
  retry(): void;
  updatePlan(plan: PlaybackPlan): void;
}

export function usePlaybackSession(target: PlaybackTarget, owner?: LiveSessionOwner): PlaybackSession {
  const vela = useVela();
  const playback = useVelaState(state => state.playback);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [refused, setRefused] = useState('');
  // A quiet (lab or development) build starts muted: the view takes this as its first command.
  const [command, setCommand] = useState<Command | undefined>(() => (quietPlayback() ? { id: 1, type: 'mute', muted: true } as Command : undefined));
  const nextId = useRef(quietPlayback() ? 1 : 0);
  const pendingQuality = useRef(0);
  const [pendingQualityId, setPendingQualityId] = useState<string>();
  /** The viewer's quality pick awaiting the engine, read synchronously when the engine asks the server. */
  const qualityPick = useRef<string | undefined>(undefined);
  qualityPick.current = pendingQualityId;
  const [pendingVersionId, setPendingVersionId] = useState<string>();
  const [versionMessage, setVersionMessage] = useState('');
  const versionAttempt = useRef(0);
  const versionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    void vela.playback.attach(target, ownedPlan).catch(error => console.warn('Live session attach failed', error));
    return () => vela.playback.detach(ownedPlan.sessionId);
  }, [vela, external, ownedId, kind, id]);

  useEffect(() => {
    if (external && playback.plan && playback.target?.id === id) ownerRef.current?.updatePlan(playback.plan);
  }, [external, playback.plan, playback.sessionId, ownedId, id]);

  const begin = useCallback(
    (positionSeconds?: number) => {
      setSnapshot(null);
      setFailure(null);
      setRefused('');
      pendingQuality.current = 0;
      setPendingQualityId(undefined);
      const from = (kind === 'title' || kind === 'programme') && positionSeconds !== undefined ? { positionSeconds } : {};
      void vela.playback.start({ ...target, ...from } as PlaybackTarget);
    },
    [vela, kind, id, target.kind === 'title' ? target.positionSeconds : undefined, target.kind === 'title' ? target.mediaSourceId : undefined, target.kind === 'title' ? target.audioTrackId : undefined],
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
      vela.playback.recover(gone);
    },
    [vela],
  );

  const stop = useCallback(() => { if (!external) void vela.playback.stop(); }, [vela, external]);

  const send = useCallback((input: CommandInput) => {
    nextId.current += 1;
    setRefused('');
    if (input.type === 'quality') { pendingQuality.current = nextId.current; qualityPick.current = input.renditionId ?? 'auto'; setPendingQualityId(qualityPick.current); }
    setCommand({ ...input, id: nextId.current } as Command);
  }, []);

  // An engine failure it can recover from is retried in place; anything else starts over where it stopped.
  const retry = useCallback(() => {
    if (failure?.recoverable && playback.plan) {
      setFailure(null);
      send({ type: 'retry' });
      return;
    }
    if (external) ownerRef.current?.retry();
    else begin(position.current > 0 ? position.current : undefined);
  }, [failure, playback.plan, send, begin, external]);

  const plan = playback.target?.id === id && playback.target.kind === kind ? playback.plan : null;
  const sessionId = plan?.sessionId ?? '';
  useEffect(() => {
    versionAttempt.current++;
    if (versionTimer.current) clearTimeout(versionTimer.current);
    setPendingVersionId(undefined); setVersionMessage('');
    return () => { versionAttempt.current++; if (versionTimer.current) clearTimeout(versionTimer.current); };
  }, [sessionId]);
  const switchVersion = useCallback((versionId: string) => {
    if (!sessionId || pendingVersionId) return;
    const token = ++versionAttempt.current;
    setPendingVersionId(versionId); setVersionMessage(msg('player.version.preparing'));
    const attempt = async (number: number) => {
      try {
        await vela.playback.switchVersion(sessionId, versionId, position.current);
        if (versionAttempt.current !== token) return;
        setPendingVersionId(undefined); setVersionMessage('');
      } catch (error) {
        if (versionAttempt.current !== token) return;
        const detail = error instanceof VelaError ? error.detail : undefined;
        const seconds = preparingRetry(detail?.code, detail?.retry, number);
        if (seconds !== null) {
          setVersionMessage(msg('player.version.retrying', { seconds }));
          versionTimer.current = setTimeout(() => void attempt(number + 1), seconds * 1000);
          return;
        }
        setPendingVersionId(undefined);
        setVersionMessage(detail?.code === 'version_unavailable' ? msg('player.version.unavailable')
          : detail?.code === 'feature_unavailable' ? msg('player.version.cannotSwitch') : msg('player.version.failed'));
        // The notice stays long enough to read, then clears itself.
        versionTimer.current = setTimeout(() => { if (versionAttempt.current === token) setVersionMessage(''); }, 6000);
      }
    };
    void attempt(1);
  }, [vela, sessionId, pendingVersionId]);
  // The quality menu opening re-reads the session's version list (a plan answered before the
  // title's release search finished offers placeholders). The chrome shows the refreshed list;
  // the engine keeps the plan it has, so playback never reloads for it.
  const refreshVersions = useCallback(() => {
    if (sessionId) void vela.playback.refreshVersions(sessionId);
  }, [vela, sessionId]);
  const versions = playback.versions;
  const chromePlan = useMemo(() => (plan ? withSessionVersions(plan, versions) : null), [plan, versions]);
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
      if (next.state !== 'failed') ownerRef.current?.snapshot(next);
      vela.playback.snapshot(next);
      if (next.failure?.kind === 'network' || next.failure?.kind === 'source') vela.playback.recover(next.sessionId ?? '');
    },
    onError: error => {
      setPendingQualityId(undefined);
      if (error.kind === 'network' || error.kind === 'source') vela.playback.recover(sessionId);
      else setFailure(error);
    },
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
      // A switch the engine chose on its own (automatic quality, recovery) is dropped if it goes
      // stale; the viewer's pending quality pick is sent again at the newer generations.
      if (event.sessionId === sessionId) void vela.playback.command(event.sessionId, event.command, commandOrigin(event.command, qualityPick.current));
    },
    // An expired grant or a stale reply: core re-reads the session's authoritative plan; a gone session starts over.
    onSessionRefresh: event => {
      if (event.sessionId !== sessionId) return;
      void vela.playback.refresh(event.sessionId).then(live => {
        if (!live) startOver(event.sessionId);
      });
    },
  };

  const chromeTarget: ChromeTarget = target.kind === 'programme' ? { kind, id, channelId: target.channelId, ...(target.from ? { from: target.from } : {}) } : { kind, id };
  const owned = owner && !ownedPlan ? owner : undefined;
  return {
    chrome: {
      target: chromeTarget,
      plan: chromePlan,
      snapshot: playback.phase === 'preparing' ? null : snapshot,
      startFailure: owner
        ? (owned?.failure ? startFailureOf(owned.failure, chromeTarget) : null)
        : startFailure(playback, chromeTarget),
      retrying: owner
        ? (owned && !owned.failure ? owned.retrying : null)
        : startRetrying(playback),
      failure: playback.phase === 'preparing' ? null : failure,
      actionError: refused || (playback.phase === 'playing' ? playback.error : ''),
      pendingQualityId,
      pendingVersionId,
      versionMessage,
      send,
      switchVersion,
      refreshVersions,
      retry,
    },
    view,
    stop,
  };
}
