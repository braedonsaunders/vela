// The player chrome (widget `playerChrome`): drawn over the player view by the watch route,
// in the document's own colours and type (look.ts). The top bar names what is playing, the
// middle shows the spinner or an honest failure, the bottom bar holds the timeline and the
// controls with their menus, and the info card sits at the top right. It hides itself while
// playback runs untouched and comes back on any pointer, key or remote input.
import { FocusPressable as Pressable } from '../../focus';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View, Text } from 'react-native';
import { clampSeek, LIVE_SLACK_SECONDS, msg } from '@vela/core';
import { useHost } from '../../host';
import { BottomBar, TopBar, bottomFade, type Opened, type Reveal, type TickerToggle } from './bars';
import { usePlayerChrome, type PlayerChromeState } from './context';
import { holdsChrome } from './hold';
import { useIdle } from './idle';
import { useScreenAwake } from './wake-lock';
import { InfoCard } from './info-card';
import { LiveDial, LiveNotice, useLiveWatchChrome } from './live';
import { useShortcuts } from './keys';
import { usePlayerLook } from './look';
import { belongs, present, type PlayerView } from './present';
import { NO_CLICK, pictureClick, UNDO_AFTER_MS, type ClickMemory, type PlayCommand } from './picture-click';
import { PICTURE_TEST_ID } from './remote-actions';
import { watchFrames, watchPictureBounds, watchWidth } from './fold-layout';
import type { CaptionInsets } from '@vela/player-api';
import { CAPTION_MOVE_MS, captionInsets, moveCaptionInsets, type CaptionRect } from './caption-area';
import { Status, type Failed } from './status';
import { SkipButton, skipHere } from './skip';
import { useVelaState } from '@vela/core/react';
import { PlayerOverlays, usePlayerSurfaces } from '../../surfaces/player';
import { PlayerToasts, takeToastKey } from '../../surfaces/toasts';

/** After Back to live on a return to the foreground, the play (the view takes one command a render). */
const RETURN_PLAY_MS = 300;

/** Rapid steps add up from the last target, not from a position the engine has yet to report. */
const STEP_MEMORY_MS = 1500;
const ANDROID_TV = Platform.OS === 'android' && Platform.isTV;
/** A mouse or trackpad drives the web page: clicks on the picture play and pause. Touch screens
 * keep tap-to-show-the-controls. */
const POINTER_CLICKS = Platform.OS === 'web' && typeof window !== 'undefined'
  && typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** Draws nothing outside a watch route (the route provides the chrome's state). */
export function PlayerChrome() {
  return <WatchPlayerChrome />;
}

export const WatchPlayerChrome = memo(function WatchPlayerChrome({ onCaptionInsets }: { onCaptionInsets?: (value: CaptionInsets) => void }) {
  const state = usePlayerChrome();
  return state ? <Chrome state={state} onCaptionInsets={onCaptionInsets} /> : null;
});

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

function Chrome({ state, onCaptionInsets }: { state: PlayerChromeState; onCaptionInsets?: (value: CaptionInsets) => void }) {
  const look = usePlayerLook();
  const { viewport } = useHost();
  const view = useMemo(() => present(state.plan, state.snapshot), [state.plan, state.snapshot]);
  const [opened, setOpened] = useState<Opened>(null);
  const [info, setInfo] = useState(false);
  const [infoBounds, setInfoBounds] = useState<CaptionRect>();
  const [active, setActive] = useState(false);
  /** The bottom bar's height (its fade included): the skip button stands just over its controls. */
  const [barHeight, setBarHeight] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);
  const [menuLayout, setMenuLayout] = useState<{ menu: Opened; width: number; height: number }>();
  const captionCurrent = useRef<CaptionInsets | null>(null);
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
  // A channel back in the foreground goes to the live edge and plays (session.ts, returnedLive).
  const returnedLive = state.returnedLive ?? 0;
  useEffect(() => {
    if (!returnedLive || !live.live || live.archive) return;
    live.backToLive();
    // The engine paused as the app left; a play that finds it playing changes nothing.
    const timer = setTimeout(() => state.send({ type: 'play' }), RETURN_PLAY_MS);
    return () => clearTimeout(timer);
  }, [returnedLive]);
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
  useEffect(() => {
    if (!state.offerVersions) return;
    state.refreshVersions?.();
    setOpened('quality');
    idle.wake();
  }, [state.offerVersions]);
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
  // Skip intro, Skip credits or Next episode, while the position is inside a range the plan names.
  const skip = failed || live.live || live.archive ? null : skipHere(state.plan?.markers, view.position, view.ended, state.nextEpisode);
  const fade = bottomFade(look);
  const skipBottom = surfaces.lift + (chromeUp && barHeight > fade ? barHeight - fade + look.size(look.small ? 8 : 12) : look.size(look.small ? 20 : 44));

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
  const top = look.small ? (look.short ? 54 : 76) : look.size(108);
  // The chrome spans the stage, so a tap anywhere on the picture wakes it; its controls keep to
  // the safe area (and to a tabletop's lower half: fold-layout.ts).
  const frames = watchFrames(viewport);
  const frame = frames.chrome;
  const width = watchWidth(viewport);
  const height = viewport.height;
  const picture = { left: frames.picture.left, top: frames.picture.top,
    right: width - frames.picture.right, bottom: height - frames.picture.bottom };
  const shown = watchPictureBounds(viewport, { ...frames, chrome: frames.picture }, state.snapshot?.video, state.picture?.fill ?? false);
  const video = { left: shown.left, top: shown.top, right: width - shown.right, bottom: height - shown.bottom };
  const barBottom = height - frame.bottom - surfaces.lift;
  const controlsTop = chromeUp && !failed && barHeight > fade ? barBottom - barHeight + fade : Infinity;
  const hasPanel = chromeUp && !failed && opened !== null && !(opened === 'chapters' && Platform.OS === 'web' && !look.small);
  const panelRight = width - frame.right - look.gutter;
  const rowPadding = look.small ? (look.short ? 6 : 18) : look.size(30);
  const panelBottom = barBottom - rowPadding - rowHeight - look.size(12);
  const portrait = look.small && height > width;
  const menuHeight = Math.round(Math.min(
    (height - frame.top - frame.bottom) * 0.55,
    portrait ? Math.max(44, panelBottom - video.top - Math.min(128, (video.bottom - video.top) * 0.55)) : Infinity,
  ));
  const wide = opened === 'quality' && !!state.plan?.versions?.length;
  const panelWidth = menuLayout?.menu === opened ? menuLayout.width :
    portrait && !wide ? panelRight - frame.left - look.gutter : look.size(wide ? 420 : 320);
  const panelHeight = menuLayout?.menu === opened ? Math.min(menuHeight, menuLayout.height) : menuHeight;
  const panels: CaptionRect[] = [];
  if (hasPanel) panels.push({
    left: panelRight - panelWidth, right: panelRight, bottom: panelBottom, top: panelBottom - panelHeight,
  });
  if (info && !failed && infoBounds) panels.push({
    left: frame.left + infoBounds.left, right: frame.left + infoBounds.right,
    top: frame.top + infoBounds.top, bottom: frame.top + infoBounds.bottom,
  });
  const { left, right, top: captionTop, bottom } = captionInsets(picture, video, controlsTop, panels);
  useEffect(() => {
    if (!onCaptionInsets) return;
    const target = { left, right, top: captionTop, bottom };
    const from = captionCurrent.current;
    const put = (value: CaptionInsets) => {
      captionCurrent.current = value;
      onCaptionInsets(value);
    };
    if (!from || look.still) { put(target); return; }
    let tick = 0;
    let start: number | undefined;
    const animate = (now: number) => {
      start ??= now;
      const progress = (now - start) / CAPTION_MOVE_MS;
      put(moveCaptionInsets(from, target, progress));
      if (progress < 1) tick = requestAnimationFrame(animate);
    };
    tick = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(tick);
  }, [left, right, captionTop, bottom, look.still, onCaptionInsets]);
  // Give the cue its column/band before mounting the panel. Closing removes the
  // panel immediately so the cue has room to return along the same path.
  const [presentedMenu, setPresentedMenu] = useState<Opened>(null);
  useEffect(() => {
    if (!hasPanel || look.still) { setPresentedMenu(opened); return; }
    const timer = setTimeout(() => setPresentedMenu(opened), CAPTION_MOVE_MS + 34);
    return () => clearTimeout(timer);
  }, [opened, hasPanel, look.still]);
  // Fade across the whole picture, including the area under side insets or a book's other pane.
  const bleed = look.small ? { left: -frame.left, right: -frame.right } : undefined;
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
        // A skip button over the hidden chrome takes focus instead, so select skips.
        hasTVPreferredFocus={Platform.isTV && !skip}
      />}
      <PlayerOverlays look={look} surfaces={surfaces} chrome={chromeUp} top={top}
        video={belongs(state.snapshot, state.plan) ? state.snapshot.video : null} fill={state.picture?.fill ?? false} />
      <View style={[StyleSheet.absoluteFill, frame]} pointerEvents="box-none">
      {/* Each bar holds its own edge: on a short screen they overlap at the middle rather than
          push the controls off the bottom. On TV, moving focus along a bar keeps the chrome up:
          the focus engine takes those presses, so they never reach the remote's event stream,
          but a control's focus bubbles to its bar (and counts only while the chrome stands). */}
      <View style={styles.top} pointerEvents="box-none" onFocus={tv ? idle.stir : undefined}>
        <TopBar look={look} title={state.title} visible={idle.visible || !!failed} onClose={state.close} bleed={bleed} />
      </View>
      {/* Alert toasts stay under the bars so a menu always covers them. */}
      <PlayerToasts look={look} top={chromeUp ? top : look.small ? 18 : look.size(30)} playingChannelId={live.live ? live.channelId : ''}
        right={info && !failed && !look.small ? look.gutter + look.size(300) + look.size(14) : undefined} />
      <View style={[styles.bottom, { bottom: surfaces.lift }, opened === 'quality' && !!state.plan?.versions?.length && !failed && styles.menuAboveStatus]}
        pointerEvents="box-none" onFocus={tv ? idle.stir : undefined} onLayout={event => setBarHeight(event.nativeEvent.layout.height)}>
        <BottomBar
          look={look}
          state={state}
          view={view}
          visible={idle.visible && !failed}
          reveal={reveal}
          stepFrom={recentStep}
          blocked={blocked}
          opened={opened}
          presentPanel={!hasPanel || presentedMenu === opened}
          info={info}
          menuHeight={menuHeight}
          onRowLayout={setRowHeight}
          onMenuLayout={(width, height) => setMenuLayout(previous =>
            previous?.menu === opened && previous.width === width && previous.height === height
              ? previous : { menu: opened, width, height })}
          bleed={bleed}
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
      {/* Over the bottom bar's fade (which would dim it and take its presses); gone while a menu is open. */}
      {skip && !opened ? <SkipButton look={look} action={skip} next={state.nextEpisode} bottom={skipBottom} chromeUp={idle.visible} seek={seek} /> : null}
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
          useOriginal={state.startFailure?.streamingCap && state.streaming ? () => {
            const streaming = state.streaming!;
            streaming.set({ [streaming.metered ? 'mobile' : 'wifi']: 'original' });
            state.retry();
          } : undefined}
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
      {info && !failed ? <InfoCard look={look} view={view} top={top} onLayout={event => {
        const { x, y, width, height } = event.nativeEvent.layout;
        setInfoBounds(previous => previous?.left === x && previous.top === y &&
          previous.right === x + width && previous.bottom === y + height
          ? previous : { left: x, top: y, right: x + width, bottom: y + height });
      }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', top: 0, left: 0, right: 0 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  menuAboveStatus: { zIndex: 1 },
});
