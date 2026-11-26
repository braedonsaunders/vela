// One watch session on the client, over core's playback slice: start it when the route opens and
// stop it when the route leaves, number the chrome's commands for the view, take the view's
// snapshots and failures, and hand the engine's session commands and observations to core, which
// talks to the server and follows the session. Core owns the server; this owns the order of things.
import { forcedMute, quietPlayback } from '../../quiet-playback';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { AWAKE, commandOrigin, msg, sleepDue, sleepFrom, VelaError, withSessionVersions, type PlaybackTarget, type Sleep, type SleepMode, type StartRefusal, type StreamingSettings } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import type { PlaybackPlan } from '../../../../protocol/types';
import type { Command, Failure, Snapshot, VelaPlayerProps } from '@vela/player-api';
import type { ChromeTarget, CommandInput, PlayerChromeState, StartRetrying } from './context';
import { belongs, qualityReached } from './present';
import { liveReturnsToEdge, stopsInBackground } from './background';
import { ownedStartFailure, startFailure, startRetrying } from './start-failure';
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

/** Native phones and tablets offer both picture modes. The watch route opts in on compact web. */
const PICTURE_CHOICE = (Platform.OS === 'ios' || Platform.OS === 'android') && !Platform.isTV;

/** `shownAway`: whether the player's picture stays on screen while the app is in the background (Android's
 * picture-in-picture window), read as the app leaves the foreground; the watch then goes on. */
export function usePlaybackSession(target: PlaybackTarget, owner?: LiveSessionOwner, shownAway?: () => boolean, webPicture = false): PlaybackSession {
  const pictureChoice = PICTURE_CHOICE || webPicture;
  const vela = useVela();
  const playback = useVelaState(state => state.playback);
  const settings = useVelaState(state => state.playerSettings);
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
  /** Deliberate audio/subtitle picks awaiting engine confirmation before remembering for the series. */
  const pendingAudio = useRef<{ commandId: number; sessionId: string; trackId: string } | null>(null);
  const pendingSubtitle = useRef<{ commandId: number; sessionId: string; trackId: string | null } | null>(null);
  const [pendingVersionId, setPendingVersionId] = useState<string>();
  const [versionMessage, setVersionMessage] = useState('');
  const [offerVersions, setOfferVersions] = useState(0);
  const offeredSourceFailure = useRef('');
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

  const plan = playback.target?.id === id && playback.target.kind === kind ? playback.plan : null;
  const sessionId = plan?.sessionId ?? '';
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

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
      pendingAudio.current = null;
      pendingSubtitle.current = null;
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
  // it returns (stopsInBackground: not a playing iPhone or iPad watch, nor the web). The transient
  // 'inactive' state (Control Center, a system alert) keeps it. A picture-in-picture window keeps the
  // watch while the app is away, until the viewer closes it.
  const away = useRef(false);
  const shownAwayRef = useRef(shownAway);
  shownAwayRef.current = shownAway;
  useEffect(() => {
    if (!id || external || Platform.OS === 'web') return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' && !away.current && !shownAwayRef.current?.() && stopsInBackground({ os: Platform.OS, tv: Platform.isTV }, paused.current)) {
        away.current = true;
        void vela.playback.stop();
      } else if (state === 'active' && away.current) {
        away.current = false;
        begin(position.current > 0 ? position.current : undefined);
      }
    });
    return () => subscription.remove();
  }, [vela, id, begin, external]);

  // A channel's session is the live controller's and goes on while the app is away; the engine pauses
  // as the app leaves (Android) and stayed paused on return, behind live with Play focused. Back in the
  // foreground it goes to the live edge and plays (the chrome's Back to live, which knows the window),
  // unless the viewer had paused it: then it waits where it was for their Play.
  const viewerPaused = useRef(false);
  const [returnedLive, setReturnedLive] = useState(0);
  useEffect(() => {
    if (!id || !external || Platform.OS === 'web') return;
    let left = false;
    let pausedThen = false;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'background' && !left && !shownAwayRef.current?.()) {
        left = true;
        pausedThen = viewerPaused.current;
      } else if (state === 'active' && left) {
        left = false;
        if (liveReturnsToEdge(pausedThen)) setReturnedLive(count => count + 1);
      }
    });
    return () => subscription.remove();
  }, [vela, id, external]);

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
    // A Studio preview keeps the sound off (quiet-playback.ts forcedMute).
    if (input.type === 'mute' && !input.muted && forcedMute()) return;
    nextId.current += 1;
    setRefused('');
    if (input.type === 'pause') viewerPaused.current = true;
    else if (input.type === 'play' || input.type === 'catchUp') viewerPaused.current = false;
    if (input.type === 'quality') { pendingQuality.current = nextId.current; qualityPick.current = input.renditionId ?? 'auto'; setPendingQualityId(qualityPick.current); }
    if (input.type === 'audio' && sessionIdRef.current) {
      pendingAudio.current = { commandId: nextId.current, sessionId: sessionIdRef.current, trackId: input.trackId };
    } else if (input.type === 'subtitle' && sessionIdRef.current) {
      pendingSubtitle.current = { commandId: nextId.current, sessionId: sessionIdRef.current, trackId: input.trackId };
    }
    setCommand({ ...input, id: nextId.current } as Command);
  }, []);

  // The sleep timer (core sleep.ts, as spoken audio has it): an ordinary pause after some minutes, or at
  // the end of what plays, which also holds back anything that would start after it. Each watch starts awake.
  const [sleep, setSleepState] = useState<Sleep>(AWAKE);
  const sleepRef = useRef(sleep);
  sleepRef.current = sleep;
  useEffect(() => setSleepState(AWAKE), [kind, id]);
  const setSleep = useCallback((mode: SleepMode, minutes = 0) => setSleepState(sleepFrom(mode, minutes, Date.now(), position.current)), []);
  const sleepNow = useCallback(() => {
    setSleepState(AWAKE);
    if (!paused.current) send({ type: 'pause' });
  }, [send]);
  // A timer runs out between position reports too.
  useEffect(() => {
    if (sleep.mode !== 'timer') return;
    const timer = setTimeout(sleepNow, Math.max(0, sleep.endsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [sleep, sleepNow]);

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

  useEffect(() => {
    if (plan?.sourceFailure !== 'version_unavailable') return;
    const failure = `${sessionId}:${plan.revision}`;
    if (offeredSourceFailure.current === failure) return;
    offeredSourceFailure.current = failure;
    setOfferVersions(value => value + 1);
  }, [sessionId, plan?.revision, plan?.sourceFailure]);
  useEffect(() => {
    versionAttempt.current++;
    if (versionTimer.current) clearTimeout(versionTimer.current);
    setPendingVersionId(undefined); setVersionMessage('');
    pendingAudio.current = null;
    pendingSubtitle.current = null;
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
  // Scrub thumbnails: core reads the session's sheets as the scrubber asks; each arrival asks again.
  const [sheets, setSheets] = useState(0);
  useEffect(() => vela.playback.onTrickplay(() => setSheets(n => n + 1)), [vela]);
  const thumbnail = useCallback(
    (seconds: number) => (sessionId ? vela.playback.trickplayFrame(sessionId, seconds) : null),
    [vela, sessionId, sheets],
  );
  const versions = playback.versions;
  const chromePlan = useMemo(() => (plan ? withSessionVersions(plan, versions) : null), [plan, versions]);
  useEffect(() => {
    if (pendingQualityId && qualityReached(pendingQualityId, snapshot, plan)) setPendingQualityId(undefined);
  }, [pendingQualityId, snapshot, plan]);
  useEffect(() => {
    if (playback.error) {
      setPendingQualityId(undefined);
      pendingAudio.current = null;
      pendingSubtitle.current = null;
    }
  }, [playback.error]);

  useEffect(() => {
    if (!sessionId || !resumePaused.current) return;
    resumePaused.current = false;
    send({ type: 'pause' });
  }, [sessionId, send]);

  const view: VelaPlayerProps = {
    plan: plan ?? undefined,
    command,
    videoFill: pictureChoice && settings.picture === 'fill',
    onSnapshot: next => {
      setSnapshot(next);
      if (belongs(next, plan)) {
        position.current = next.position;
        paused.current = next.state === 'paused';
        if (pendingAudio.current && pendingAudio.current.sessionId === sessionId && !next.pendingAudioTrackId && next.audioTrackId === pendingAudio.current.trackId) {
          const chosen = pendingAudio.current;
          pendingAudio.current = null;
          vela.playback.rememberTrack(chosen.sessionId, 'audio', chosen.trackId);
        }
        if (pendingSubtitle.current && pendingSubtitle.current.sessionId === sessionId && !next.pendingSubtitleTrackId) {
          const activeSub = next.subtitleTrackId || null;
          if (activeSub === pendingSubtitle.current.trackId && !next.subtitleError) {
            const chosen = pendingSubtitle.current;
            pendingSubtitle.current = null;
            vela.playback.rememberTrack(chosen.sessionId, 'subtitle', chosen.trackId);
          } else if (next.subtitleError) {
            pendingSubtitle.current = null;
          }
        }
        const asleep = sleepRef.current;
        // The end came first: an end-of-item sleep has done its work (nothing follows), a timer has none left.
        if (asleep.mode !== 'off' && next.state === 'ended') setSleepState(AWAKE);
        else if (next.state === 'playing' && sleepDue(asleep, Date.now(), next.position, plan?.chapters)) sleepNow();
      }
      if (next.failure === null) setFailure(null);
      if (next.state !== 'failed') ownerRef.current?.snapshot(next);
      vela.playback.snapshot(next);
      if (next.failure?.kind === 'network' || next.failure?.kind === 'source') vela.playback.recover(next.sessionId ?? '');
    },
    onError: error => {
      setPendingQualityId(undefined);
      pendingAudio.current = null;
      pendingSubtitle.current = null;
      if (error.kind === 'network' || error.kind === 'source') vela.playback.recover(sessionId);
      else setFailure(error);
    },
    onCommand: event => {
      if (!event.ok && event.id === pendingQuality.current) setPendingQualityId(undefined);
      if (!event.ok && pendingAudio.current?.commandId === event.id) pendingAudio.current = null;
      if (!event.ok && pendingSubtitle.current?.commandId === event.id) pendingSubtitle.current = null;
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
    // The viewer closed the picture-in-picture window of an app in the background: the watch stops as it does
    // when the app leaves the foreground, and starts again where it was when the app returns.
    onPictureInPicture: event => {
      if (!event.closed || external || away.current || AppState.currentState === 'active') return;
      away.current = true;
      void vela.playback.stop();
    },
    // An expired grant or a stale reply: core re-reads the session's authoritative plan; a gone session starts over.
    onSessionRefresh: event => {
      if (event.sessionId !== sessionId) return;
      if (event.reason === 'original_lost') {
        const held = Number.isFinite(event.positionSeconds) ? Math.max(0, event.positionSeconds!) : position.current;
        position.current = held;
        void vela.playback.originalLost(event.sessionId, held, event.sourceGeneration).then(result => {
          if (result === 'gone') startOver(event.sessionId);
        });
        return;
      }
      void vela.playback.refresh(event.sessionId).then(live => {
        if (!live) startOver(event.sessionId);
      });
    },
  };

  const setStreaming = useCallback((next: Partial<StreamingSettings>) => vela.playerSettings.setStreaming(next), [vela]);
  const streaming = useMemo(() => ({ settings: settings.streaming, metered: settings.metered, set: setStreaming }),
    [settings.streaming, settings.metered, setStreaming]);
  const sleepTimer = useMemo(() => ({ value: sleep, set: setSleep }), [sleep, setSleep]);
  const setPicture = useCallback((fill: boolean) => vela.playerSettings.setPicture(fill ? 'fill' : 'fit'), [vela]);
  const picture = useMemo(() => (pictureChoice ? { fill: settings.picture === 'fill', set: setPicture } : undefined), [pictureChoice, settings.picture, setPicture]);

  const chromeTarget: ChromeTarget = target.kind === 'programme' ? { kind, id, channelId: target.channelId, ...(target.from ? { from: target.from } : {}) } : { kind, id };
  const owned = owner && !ownedPlan ? owner : undefined;
  return {
    chrome: {
      returnedLive,
      target: chromeTarget,
      plan: chromePlan,
      snapshot: playback.phase === 'preparing' ? null : snapshot,
      startFailure: owner
        ? ownedStartFailure(owned?.failure ?? null, playback, chromeTarget)
        : startFailure(playback, chromeTarget),
      retrying: owner
        ? (owned && !owned.failure ? owned.retrying : null)
        : startRetrying(playback),
      failure: playback.phase === 'preparing' ? null : failure,
      actionError: refused || (playback.phase === 'playing' ? playback.error : ''),
      pendingQualityId,
      pendingVersionId,
      versionMessage,
      offerVersions,
      send,
      switchVersion,
      refreshVersions,
      retry,
      thumbnail,
      streaming,
      sleep: sleepTimer,
      picture,
    },
    view,
    stop,
  };
}
