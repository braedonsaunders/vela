// The player chrome (widget `playerChrome`): drawn over the player view by the watch route,
// in the document's own colours and type (look.ts). The top bar names what is playing, the
// middle shows the spinner or an honest failure, the bottom bar holds the timeline and the
// controls with their menus, and the info card sits at the top right. It hides itself while
// playback runs untouched and comes back on any pointer, key or remote input.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { msg } from '@vela/core';
import type { Focusable } from '../../escape';
import { useHost } from '../../host';
import { BottomBar, TopBar, type Opened } from './bars';
import { usePlayerChrome, type PlayerChromeState } from './context';
import { useIdle } from './idle';
import { InfoCard } from './info-card';
import { useLiveWatchChrome } from './live';
import { useShortcuts } from './keys';
import { usePlayerLook } from './look';
import { present, type PlayerView } from './present';
import { Status, type Failed } from './status';

/** Rapid steps add up from the last target, not from a position the engine has yet to report. */
const STEP_MEMORY_MS = 1500;

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
  const lastStep = useRef<{ seconds: number; at: number } | null>(null);
  const toggleRef = useRef<Focusable>(null);

  const failed = failureOf(state, view);
  const blocked = !state.plan || view.ended || !!failed;
  const waiting = !failed && (!state.plan || view.waiting);
  const live = useLiveWatchChrome(state.plan, state.snapshot);
  const idle = useIdle(!view.playing || opened !== null || active || !!failed || live.attention);
  const { send } = state;

  const seek = (seconds: number) => {
    lastStep.current = { seconds, at: Date.now() };
    send({ type: 'seek', seconds });
  };
  const seekBy = (delta: number) => {
    if (blocked) return;
    const recent =
      lastStep.current && Date.now() - lastStep.current.at < STEP_MEMORY_MS ? lastStep.current.seconds : null;
    const from = recent ?? view.position;
    const limit = view.duration > 0 ? view.duration : Number.POSITIVE_INFINITY;
    seek(Math.max(0, Math.min(limit, from + delta)));
  };
  const toggle = (menu: Exclude<Opened, null>) => setOpened(current => (current === menu ? null : menu));
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

  useShortcuts({
    visible: idle.visible,
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
  });

  // TV: whenever the chrome comes up, focus is on the play toggle, never on the top bar's close
  // (select there would leave the player when the viewer meant to pause).
  const tv = look.tv && Platform.isTV;
  useEffect(() => {
    if (!tv || !idle.visible || failed) return;
    const frame = requestAnimationFrame(() => toggleRef.current?.requestTVFocus?.());
    return () => cancelAnimationFrame(frame);
  }, [tv, idle.visible, !!failed]);

  // Touch: a tap on the picture shows a hidden chrome, or hides a standing one (closing a menu first).
  const tapStage = () => {
    if (opened) setOpened(null);
    else if (idle.visible && view.playing) idle.hide();
    else idle.wake();
  };
  const top = look.small ? 76 : look.size(108);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" testID="player-chrome">
      <Pressable
        accessible={false}
        onPress={tapStage}
        style={StyleSheet.absoluteFill}
        focusable={Platform.isTV && !idle.visible}
        hasTVPreferredFocus={Platform.isTV && !idle.visible}
      />
      {/* Each bar holds its own edge: on a short screen they overlap at the middle rather than
          push the controls off the bottom. */}
      <View style={styles.top} pointerEvents="box-none">
        <TopBar look={look} title={state.title} visible={idle.visible || !!failed} onClose={state.close} />
      </View>
      <View style={styles.bottom} pointerEvents="box-none">
        <BottomBar
          look={look}
          state={state}
          view={view}
          visible={idle.visible && !failed}
          blocked={blocked}
          opened={opened}
          info={info}
          menuHeight={Math.round(viewport.height * 0.55)}
          send={send}
          seek={seek}
          seekBy={seekBy}
          toggle={toggle}
          toggleInfo={toggleInfo}
          onActive={setActive}
          live={live}
          toggleRef={toggleRef}
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
          onRetry={state.retry}
          onClose={state.close}
        />
      </View>
      {info && !failed ? <InfoCard look={look} view={view} top={top} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
});
