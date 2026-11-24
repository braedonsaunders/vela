// The player chrome (widget `playerChrome`): drawn over the player view by the watch route,
// in the document's own colours and type (look.ts). The top bar names what is playing, the
// middle shows the spinner or an honest failure, the bottom bar holds the timeline and the
// controls with their menus, and the info card sits at the top right. It hides itself while
// playback runs untouched and comes back on any pointer, key or remote input.
import { FocusPressable as Pressable } from '../../focus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import { clampSeek, LIVE_SLACK_SECONDS, msg } from '@vela/core';
import { useHost } from '../../host';
import { BottomBar, TopBar, type Opened, type Reveal, type TickerToggle } from './bars';
import { usePlayerChrome, type PlayerChromeState } from './context';
import { holdsChrome } from './hold';
import { useIdle } from './idle';
import { useScreenAwake } from './wake-lock';
import { InfoCard } from './info-card';
import { LiveDial, LiveNotice, useLiveWatchChrome } from './live';
import { useShortcuts } from './keys';
import { usePlayerLook } from './look';
import { present, type PlayerView } from './present';
import { NO_CLICK, pictureClick, UNDO_AFTER_MS, type ClickMemory, type PlayCommand } from './picture-click';
import { PICTURE_TEST_ID } from './remote-actions';
import { Status, type Failed } from './status';
import { useVelaState } from '@vela/core/react';
import { PlayerOverlays, usePlayerSurfaces } from '../../surfaces/player';
import { PlayerToasts, takeToastKey } from '../../surfaces/toasts';

/** Rapid steps add up from the last target, not from a position the engine has yet to report. */
const STEP_MEMORY_MS = 1500;
const ANDROID_TV = Platform.OS === 'android' && Platform.isTV;
/** A mouse or trackpad drives the web page: clicks on the picture play and pause. Touch screens
 * keep tap-to-show-the-controls. */
const POINTER_CLICKS = Platform.OS === 'web' && typeof window !== 'undefined'
  && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Draws nothing outside a watch route (the route provides the chrome's state). */
export function PlayerChrome() {
  const state = usePlayerChrome();
  return state ? <Chrome state={state} /> : null;
}

/** What stops playback, in the viewer's words: a start the server refused, or the engine's failure. */
function failureOf(state: PlayerChromeState, view: PlayerView): Failed | null {
  if (state.startFailure) {
    const message = state.startFailure.capacity ? msg('player.capacity') : state.startFailure.message;
    return { message, capacity: state.startFailure.capacity };
  }
  if (state.failure && !state.failure.recoverable) return { message: state.failure.message, capacity: false };
  if (view.state === 'failed') return { message: view.reason || msg('ui.playbackCouldnTBeStarted'), capacity: false };
  return null;
}

function waitingLabel(view: PlayerView): string {
  if (view.state === 'recovering') return msg('ui.findingAWayForward');
  if (view.state === 'loading' || view.state === 'idle') return msg('ui.preparingYourScreening');
  return msg('ui.buildingALittleBreathingRoom');
}

function Chrome({ state }: { state: PlayerChromeState }) {
  const look = usePlayerLook();
  const { viewport } = useHost();
  const view = useMemo(() => present(state.plan, state.snapshot), [state.plan, state.snapshot]);
  const [opened, setOpened] = useState<Opened>(null);
  const [info, setInfo] = useState(false);
  const [active, setActive] = useState(false);
  /** What a hidden chrome focuses when it comes up (TV): the play toggle, or the timeline after a
   * step from the remote, so that the next side presses keep stepping. */
  const [reveal, setReveal] = useState<Reveal>('toggle');
  const lastStep = useRef<{ seconds: number; at: number } | null>(null);
  const lastClick = useRef<ClickMemory>(NO_CLICK);
  /** A double click's undo, waiting behind its full-screen command (picture-click.ts). */
  const pendingUndo = useRef<{ command: PlayCommand; timer: ReturnType<typeof setTimeout> } | null>(null);
  /** Cancels a waiting undo and returns it: the caller's own play or pause takes its place. */
  const takeUndo = (): PlayCommand | null => {
    const pending = pendingUndo.current;
    if (!pending) return null;
    clearTimeout(pending.timer);
    pendingUndo.current = null;
    return pending.command;
  };
  useEffect(() => () => { if (pendingUndo.current) clearTimeout(pendingUndo.current.timer); }, []);

  const failed = failureOf(state, view);
  const blocked = !state.plan || view.ended || !!failed;
  const waiting = !failed && (!state.plan || view.waiting);
  const live = useLiveWatchChrome(state.plan, state.snapshot, state.target, state.send);
  // Plugin overlays and toasts (docs/plugin-screens.md: Surfaces), where the app draws them.
  const liveEvent = useVelaState(s => s.playback.liveEvent);
  // The session that has played, so a later wait in it reads as a stall rather than a start.
  const playedSession = useRef('');
  const sessionId = state.plan?.sessionId ?? '';
  if (view.playing && sessionId) playedSession.current = sessionId;
  const idle = useIdle(holdsChrome({
    state: view.state, started: !!sessionId && playedSession.current === sessionId,
    menuOpen: opened !== null, active, failed: !!failed,
  }));
  const chromeUp = idle.visible || !!failed;
  const surfaces = usePlayerSurfaces({
    channelId: live.live ? live.channelId : '', eventId: live.live ? liveEvent?.id ?? '' : '', feed: live.live ? liveEvent?.feed : undefined,
    kind: live.live ? 'channel' : live.archive ? 'programme' : 'title', titleId: !live.live && !live.archive ? state.target?.id : undefined,
    chrome: chromeUp, behindSeconds: live.behindSeconds, pictureAt: live.pictureAt,
  });
  // A `toggle` overlay's switch is the chrome's ticker button (the others are in the subtitles menu).
  const toggleSwitch = surfaces.switches.find(s => s.button);
  const overlay: TickerToggle = { available: !!toggleSwitch, ticker: toggleSwitch?.on ?? false, toggleTicker: () => toggleSwitch?.toggle(), label: toggleSwitch?.label ?? '' };
  // No screensaver or display sleep over a playing film (web and desktop; native players hold it themselves).
  useScreenAwake(view.playing);
  const { send } = state;

  // A channel's rewind window bounds every seek; one that reaches the live edge goes back to live.
  const rewind = live.live && live.window?.seekable ? live.window : null;
  const seek = (seconds: number) => {
    if (rewind) {
      if (!live.archive && seconds >= rewind.edge - LIVE_SLACK_SECONDS) {
        lastStep.current = null;
        live.backToLive();
        return;
      }
      seconds = clampSeek(rewind, seconds);
      live.leftLive();
    }
    lastStep.current = { seconds, at: Date.now() };
    send({ type: 'seek', seconds });
  };
  const recentStep = () =>
    lastStep.current && Date.now() - lastStep.current.at < STEP_MEMORY_MS ? lastStep.current.seconds : null;
  const seekBy = (delta: number) => {
    if (blocked) return;
    const from = recentStep() ?? (rewind ? rewind.position : view.position);
    const limit = rewind ? rewind.edge : view.duration > 0 ? view.duration : Number.POSITIVE_INFINITY;
    seek(Math.max(rewind ? rewind.start : 0, Math.min(limit, from + delta)));
  };
  const toggle = (menu: Exclude<Opened, null>) => {
    // One version read per opening of the quality menu, never a poll while it stands open.
    if (menu === 'quality' && opened !== 'quality') state.refreshVersions?.();
    setOpened(current => (current === menu ? null : menu));
  };
  const toggleInfo = () => setInfo(on => !on);
  // While a double click's undo waits, the picture is about to be back as it was before the double
  // click: a toggle starts from there, and an explicit play or pause is sent even when the view
  // already reads that way, since the undo it replaces would have changed it.
  const togglePlay = () => {
    const undo = takeUndo();
    const playing = undo ? undo === 'play' : view.playing;
    if (playing) live.leftLive();
    if (!view.ended && state.plan) send({ type: playing ? 'pause' : 'play' });
  };
  const play = () => {
    const undone = takeUndo() !== null;
    if (!view.ended && state.plan && (undone || !view.playing)) send({ type: 'play' });
  };
  const pause = () => {
    const undone = takeUndo() !== null;
    live.leftLive();
    if (state.plan && (undone || view.playing)) send({ type: 'pause' });
  };

  const wake = (focus?: Reveal) => {
    if (focus) setReveal(focus);
    idle.wake();
  };
  // A chrome brought up by anything else (a press up or down, a pause) comes up on the toggle.
  useEffect(() => {
    if (!idle.visible) setReveal('toggle');
  }, [idle.visible]);

  useShortcuts({
    visible: idle.visible,
    wake,
    menuOpen: opened !== null,
    togglePlay,
    play,
    pause,
    seekBy,
    volumeBy: delta => send({ type: 'volume', value: Math.max(0, Math.min(1, view.volume + delta)) }),
    toggleMute: () => send({ type: 'mute', muted: !view.muted }),
    toggleInfo,
    fullscreen: () => {
      if (view.fullscreen) send({ type: 'fullscreen' });
    },
    closeMenu: () => setOpened(null),
    liveKey: live.live || live.archive ? live.key : undefined,
    liveSteps: !!rewind,
    alertKey: takeToastKey,
  });

  const tv = look.tv && Platform.isTV;

  // Touch: a tap on the picture shows a hidden chrome, or hides a standing one (closing a menu first).
  const tapStage = () => {
    if (opened) setOpened(null);
    // A mouse click on the picture plays or pauses (and shows the chrome), as in every desktop
    // web player; a double click changes full screen only (picture-click.ts).
    else if (POINTER_CLICKS) {
      const undo = takeUndo();
      const click = pictureClick(lastClick.current, {
        now: Date.now(),
        playing: undo ? undo === 'play' : view.playing,
        canToggle: !view.ended && !!state.plan,
        fullscreen: view.fullscreen,
      });
      lastClick.current = click.memory;
      if (click.now === 'pause') live.leftLive();
      if (click.now) send({ type: click.now });
      const later = click.later;
      // The view takes one command a render: the undo follows full screen once the host has it.
      if (later) pendingUndo.current = {
        command: later,
        timer: setTimeout(() => {
          pendingUndo.current = null;
          send({ type: later });
        }, UNDO_AFTER_MS),
      };
      idle.wake();
    }
    else if (idle.visible && view.playing) idle.hide();
    else idle.wake();
  };
  const top = look.small ? 76 : look.size(108);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="player-chrome">
      {/* On TV remove the picture's focus destination on reveal, rather than leaving a
          mounted preferred target competing with the control row during native layout. */}
      {(!Platform.isTV || !idle.visible) && <Pressable
        accessible={false}
        testID={PICTURE_TEST_ID}
        // Android TV's remote presses on the picture are the shortcuts' (remotePress): select plays
        // or pauses there, which a press here would undo.
        onPress={ANDROID_TV ? undefined : tapStage}
        style={StyleSheet.absoluteFill}
        focusable={Platform.isTV ? !idle.visible : Platform.OS === 'android'}
        hasTVPreferredFocus={Platform.isTV}
      />}
      {/* Each bar holds its own edge: on a short screen they overlap at the middle rather than
          push the controls off the bottom. On TV, moving focus along a bar keeps the chrome up:
          the focus engine takes those presses, so they never reach the remote's event stream,
          but a control's focus bubbles to its bar (and counts only while the chrome stands). */}
      <View style={styles.top} pointerEvents="box-none" onFocus={tv ? idle.stir : undefined}>
        <TopBar look={look} title={state.title} visible={idle.visible || !!failed} onClose={state.close} />
      </View>
      {/* Plugin overlays (the score bug, the ticker) and alert toasts, under the bars so a menu always covers them. */}
      <PlayerOverlays look={look} surfaces={surfaces} chrome={chromeUp} top={top} />
      <PlayerToasts look={look} top={chromeUp ? top : look.small ? 18 : look.size(30)} playingChannelId={live.live ? live.channelId : ''}
        right={info && !failed && !look.small ? look.gutter + look.size(300) + look.size(14) : undefined} />
      <View style={[styles.bottom, { bottom: surfaces.lift }, opened === 'quality' && !!state.plan?.versions?.length && !failed && styles.menuAboveStatus]}
        pointerEvents="box-none" onFocus={tv ? idle.stir : undefined}>
        <BottomBar
          look={look}
          state={state}
          view={view}
          visible={idle.visible && !failed}
          reveal={reveal}
          stepFrom={recentStep}
          blocked={blocked}
          opened={opened}
          info={info}
          menuHeight={Math.round(viewport.height * 0.55)}
          send={send}
          seek={seek}
          seekBy={seekBy}
          toggle={toggle}
          closeMenu={() => setOpened(null)}
          toggleInfo={toggleInfo}
          onActive={setActive}
          live={live}
          overlay={overlay}
          overlaySwitches={surfaces.switches}
        />
      </View>
      <View
        style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
        pointerEvents="box-none"
      >
        <Status
          look={look}
          failed={failed}
          waiting={waiting}
          waitingLabel={waitingLabel(view)}
          retrying={failed ? null : state.retrying ?? null}
          onRetry={state.retry}
          onClose={state.close}
          zap={live.live && live.canZap ? live.zap : undefined}
          dial={failed && live.canZap ? <LiveDial channelId={live.channelId} small={look.small} still={look.still} /> : null}
        />
      </View>
      {!idle.visible && !failed ? <LiveNotice look={look} watch={live} lift={surfaces.lift} /> : null}
      {state.versionMessage && !failed ? (
        // A version switch reports here, not only inside the quality menu, which has closed by
        // the time the server answers: a refused switch must never look like a click that did nothing.
        <View pointerEvents="none" accessibilityLiveRegion="polite" testID="player-version-notice"
          style={{ position: 'absolute', top: top + look.size(64), alignSelf: 'center', maxWidth: '80%',
            paddingVertical: look.size(8), paddingHorizontal: look.size(14), borderRadius: look.radiusControl, backgroundColor: look.scrim }}>
          <Text style={look.text(14, 500, look.ink)}>{state.versionMessage}</Text>
        </View>
      ) : null}
      {info && !failed ? <InfoCard look={look} view={view} top={top} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  menuAboveStatus: { zIndex: 1 },
});
