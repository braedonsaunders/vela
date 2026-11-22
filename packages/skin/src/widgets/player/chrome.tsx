// The player chrome (widget `playerChrome`): drawn over the player view by the watch route,
// in the document's own colours and type (look.ts). The top bar names what is playing, the
// middle shows the spinner or an honest failure, the bottom bar holds the timeline and the
// controls with their menus, and the info card sits at the top right. It hides itself while
// playback runs untouched and comes back on any pointer, key or remote input.
import { FocusPressable as Pressable } from '../../focus';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import { msg } from '@vela/core';
import { useHost } from '../../host';
import { BottomBar, TopBar, type Opened, type Reveal } from './bars';
import { usePlayerChrome, type PlayerChromeState } from './context';
import { holdsChrome } from './hold';
import { useIdle } from './idle';
import { useScreenAwake } from './wake-lock';
import { InfoCard } from './info-card';
import { LiveDial, LiveNotice, useLiveWatchChrome } from './live';
import { useShortcuts } from './keys';
import { usePlayerLook } from './look';
import { present, type PlayerView } from './present';
import { PICTURE_TEST_ID } from './remote-actions';
import { Status, type Failed } from './status';
import { PlayerLiveOverlays, usePlayerLiveOverlay } from '../live-overlay/player';
import { takeAlertKey } from '../live-overlay/context';

/** Rapid steps add up from the last target, not from a position the engine has yet to report. */
const STEP_MEMORY_MS = 1500;
const ANDROID_TV = Platform.OS === 'android' && Platform.isTV;

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

  const failed = failureOf(state, view);
  const blocked = !state.plan || view.ended || !!failed;
  const waiting = !failed && (!state.plan || view.waiting);
  const live = useLiveWatchChrome(state.plan, state.snapshot, state.target);
  const overlay = usePlayerLiveOverlay(look, live.live);
  // The session that has played, so a later wait in it reads as a stall rather than a start.
  const playedSession = useRef('');
  const sessionId = state.plan?.sessionId ?? '';
  if (view.playing && sessionId) playedSession.current = sessionId;
  const idle = useIdle(holdsChrome({
    state: view.state, started: !!sessionId && playedSession.current === sessionId,
    menuOpen: opened !== null, active, failed: !!failed,
  }));
  // No screensaver or display sleep over a playing film (web and desktop; native players hold it themselves).
  useScreenAwake(view.playing);
  const { send } = state;

  const seek = (seconds: number) => {
    lastStep.current = { seconds, at: Date.now() };
    send({ type: 'seek', seconds });
  };
  const recentStep = () =>
    lastStep.current && Date.now() - lastStep.current.at < STEP_MEMORY_MS ? lastStep.current.seconds : null;
  const seekBy = (delta: number) => {
    if (blocked) return;
    const from = recentStep() ?? view.position;
    const limit = view.duration > 0 ? view.duration : Number.POSITIVE_INFINITY;
    seek(Math.max(0, Math.min(limit, from + delta)));
  };
  const toggle = (menu: Exclude<Opened, null>) => {
    // One version read per opening of the quality menu, never a poll while it stands open.
    if (menu === 'quality' && opened !== 'quality') state.refreshVersions?.();
    setOpened(current => (current === menu ? null : menu));
  };
  const toggleInfo = () => setInfo(on => !on);
  const togglePlay = () => {
    if (!view.ended && state.plan) send({ type: view.playing ? 'pause' : 'play' });
  };
  const play = () => {
    if (!view.ended && state.plan && !view.playing) send({ type: 'play' });
  };
  const pause = () => {
    if (state.plan && view.playing) send({ type: 'pause' });
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
    liveKey: live.live ? live.key : undefined,
    alertKey: takeAlertKey,
  });

  const tv = look.tv && Platform.isTV;

  // Touch: a tap on the picture shows a hidden chrome, or hides a standing one (closing a menu first).
  const tapStage = () => {
    if (opened) setOpened(null);
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
      {/* Sports: the score bug, the ticker and alert toasts, under the bars so a menu always covers them. */}
      <PlayerLiveOverlays look={look} overlay={overlay} chrome={idle.visible || !!failed} top={top} info={info && !failed} channelId={live.channelId} />
      <View style={[styles.bottom, { bottom: overlay.lift }, opened === 'quality' && !!state.plan?.versions?.length && !failed && styles.menuAboveStatus]}
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
      {!idle.visible && !failed ? <LiveNotice look={look} watch={live} lift={overlay.lift} /> : null}
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
