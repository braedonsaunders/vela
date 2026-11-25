// The app's audio: the platform engine attached to the store's queue, the system's media
// session kept in step, and the mini player and Now Playing drawn over every route.
import { router, usePathname } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type ComponentType, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostContext } from '@vela/skin/src/host';
import { MediaActionsContext } from '@vela/skin/src/widgets/media';
import { MINI_PLAYER_HEIGHT, MiniPlayer, NowPlaying } from '@vela/skin/src/widgets/media/player';
import { MOTION, Presence } from '@vela/skin/src/presence';
import { resolveUi } from '@vela/skin/src/resolve/ui';
import { focusElement } from '@vela/skin/src/escape';
import { RoundButton } from '@vela/skin/src/widgets/media/parts';
import { useCanOpenVisualizer, useCanVisualize } from '../visualizer/availability';
import { Visualizer } from '../visualizer/visualizer';
import { beginVisualizerFullscreen } from '../visualizer/stage';
import { inVisualizerHistory, popVisualizerHistory, pushVisualizerHistory } from '../visualizer/page-history';
import { visualizerPlan, visualizerProfile } from '../visualizer/selection';
import { setVisualizerEnabled, subscribeVisualizerScene, visualizerEnabled } from '../visualizer/setting';
import { holdBack } from '@vela/skin/src/menu-key';
import { useVelaState } from '@vela/core/react';
import { currentInQueue, msg, soundSettings, type Vela as Store } from '@vela/core';
import { useVela } from '../vela';
import { preferences } from '../data/preferences';
import { audioDiagnostics, createAudioEngine, syncMediaSession, type AppAudioEngine, type MediaSessionControls } from './audio-engine';
import { useMediaPageActions } from './actions';
import { musicTV, onOpenNowPlaying, wideMusic, type NowPlayingPanel } from '@vela/skin/src/widgets/music';
import { useMediaPlayerActions } from './player-actions';
import { useReaderActions } from './reader-actions';
import { config } from '../data/config';
import { useAppScreenActions } from '../screen-actions';
import { ScreenView } from '@vela/skin/src/screen/host';
import { hasExperience } from '@vela/skin/src/screen/experience';
import { builtinHref } from '@vela/skin/src/resolve/builtin';
import { ListenDockContext, type ListenDock } from '@vela/skin/src/blocks/listen/dock';

const fill = StyleSheet.absoluteFill;
const dockStrip = { position: 'absolute', left: 0, right: 0, bottom: 0 } as const;
/** On iPhone and iPad a title page is a native modal, presented above the root view: the dock rides in
 * a window of its own above it, so the mini player and Now Playing stay on top of an album's page. A TV
 * presents pages inside the root view, and Android draws the dock above its stack already. */
const Above = Platform.OS === 'ios' && !Platform.isTV ? FullWindowOverlay : Fragment;

type Focusable = { requestTVFocus?(): void };
// RN's generated TV guide declarations omit the ref that its implementation forwards.
const FocusGuide = TVFocusGuideView as ComponentType<ComponentProps<typeof TVFocusGuideView> & { ref?: Ref<Focusable> }>;

/** On a TV, Now Playing draws over a page that stays in the focus engine: while open it takes the
 * focus and keeps it (the remote's presses never reach the page beneath), and gives it back on close. */
function TVFocusTrap({ open, children, guideRef }: { open: boolean; children: ReactNode; guideRef?: Ref<Focusable> & { current: Focusable | null } }) {
  const own = useRef<Focusable>(null);
  const guide = guideRef ?? own;
  useEffect(() => {
    // Given a guide, its owner asks for focus once what it traps has drawn.
    if (!open || guideRef) return;
    const frame = requestAnimationFrame(() => guide.current?.requestTVFocus?.());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  if (!Platform.isTV) return <>{children}</>;
  return (
    <FocusGuide ref={guide} style={fill} autoFocus focusable={open} trapFocusUp={open} trapFocusDown={open} trapFocusLeft={open} trapFocusRight={open}>
      {children}
    </FocusGuide>
  );
}
const SOUND_PREFERENCE = 'sound';

/** Now Playing's rise is a long move, so a little longer than a section; its fall is quicker. */
const NOW_PLAYING_ENTER = 420;
const NOW_PLAYING_EXIT = 280;

/**
 * The audio engine and its native player belong to the process, like the store (vela.tsx), not to a
 * mount of the app's tree: Android's Back out of the app unmounts the tree while music plays on, with
 * its notification, and opening the app mounts it again over the same queue. So one engine is attached
 * per store and kept, never detached (which would stop the music) or made again (whose subscription
 * would pass each system command on a second time).
 */
let attached: { store: Store; engine: AppAudioEngine | null; detach: () => void } | undefined;

function attachAudioEngine(store: Store): void {
  if (attached?.store === store) return;
  if (attached) { attached.detach(); attached.engine?.dispose(); }
  const engine = createAudioEngine(() => store.playback.mediaAccess());
  const detachEngine = store.audio.attach(engine);
  const unfollow = followMediaSession(store);
  attached = { store, engine, detach: () => { unfollow(); detachEngine(); } };
}

/** The system's Now Playing (notification, lock screen, Control Center) follows the queue from the
 * store, not from a mounted component: with the app's tree unmounted the music goes on to the next
 * track, and the notification must name it. */
function followMediaSession(store: Store): () => void {
  const controls: MediaSessionControls = {
    play: () => store.audio.resume(), pause: () => store.audio.pause(), next: () => store.audio.next(),
    previous: () => store.audio.previous(), seek: seconds => store.audio.seek(seconds), skip: delta => store.audio.skip(delta),
  };
  let shown = store.getState().audio;
  syncMediaSession(shown, controls);
  return store.subscribe(() => {
    const audio = store.getState().audio;
    if (audio === shown) return;
    shown = audio;
    syncMediaSession(audio, controls);
  });
}

const NOW_PLAYING_TARGET = { kind: 'screen' as const, id: 'vela.listen', page: 'nowPlaying' };
const VISUALIZER_TARGET = { kind: 'screen' as const, id: 'vela.listen', page: 'visualizer' };

export function AudioDock() {
  const vela = useVela();
  const store = vela.store;
  const audio = useVelaState(state => state.audio);
  const pathname = usePathname();
  const host = vela.host('home', '');
  const insets = useSafeAreaInsets();
  const ui = host?.doc.document.ui;
  const pageColor = useMemo(() => resolveUi(ui).page, [ui]);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [panel, setPanel] = useState<NowPlayingPanel | undefined>(undefined);
  useEffect(() => onOpenNowPlaying(next => { setPanel(next); setExpanded(false); setOpen(true); }), []);
  useEffect(() => attachAudioEngine(store), [store]);
  // Development checks read what the audio did (docs/sound.md): the store's audio and the engine's last crossfade.
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __velaSound?: unknown }).__velaSound = { audio: () => store.getState().audio, engine: audioDiagnostics };
  }, [store]);
  // The sound settings belong to this device: read once, written back whenever they change.
  useEffect(() => {
    try { store.audio.setSound(soundSettings(JSON.parse(preferences.get(SOUND_PREFERENCE) ?? 'null'))); } catch { /* Unreadable: the defaults. */ }
  }, [store]);
  const sound = audio.sound;
  const savedSound = useRef(sound);
  useEffect(() => {
    if (savedSound.current === sound) return;
    savedSound.current = sound;
    try { preferences.set(SOUND_PREFERENCE, JSON.stringify(sound)); } catch { /* Kept for this run only. */ }
  }, [sound]);
  // The viewer sees plain copy; the cause goes to the console for whoever is debugging.
  useEffect(() => { if (audio.error) console.warn(`Vela audio: ${audio.error}`); }, [audio.error]);
  useEffect(() => { if (!audio.queue) setOpen(false); }, [audio.queue]);
  const close = useCallback(() => setOpen(false), []);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), []);
  const actions = useMediaPageActions(undefined, back, useMediaPlayerActions(), useReaderActions(undefined));
  // Video and the reader own the screen; the sign-in pages have nothing to play.
  const covered = pathname.startsWith('/watch') || pathname.startsWith('/read') || pathname === '/multiview' || pathname.startsWith('/sign-in') || pathname.startsWith('/connect');
  // The audio app draws its own now-playing bar along the bottom; the floating one stands aside.
  const musicLibrary = useVelaState(state => state.libraries.value?.some(library => library.experience === 'listen' && pathname === `/library/${library.id}`));
  const inMusicShell = !!musicLibrary && !musicTV() && wideMusic(host?.viewport.width ?? 0, host?.viewport.height ?? 0);
  const playing = !!audio.queue && !covered;
  // The viewer's On/Off for this profile on this device; Off mounts no stage at all.
  const profile = useVelaState(s => visualizerProfile(s.servers.selectedId, s.auth.viewerId || s.auth.viewer));
  const visualizerOn = useSyncExternalStore(subscribeVisualizerScene, () => visualizerEnabled(profile), () => visualizerEnabled(profile));
  const capable = useCanVisualize(playing && open && currentInQueue(audio.queue)?.media?.class === 'music');
  const plan = visualizerPlan(capable, visualizerOn, expanded);
  const visuals = plan.stage !== null;
  const readyToOpen = useCanOpenVisualizer(visuals);
  const fullscreen = plan.stage === 'fullscreen';
  useEffect(() => {
    if (visuals || !expanded) return;
    setExpanded(false);
    if (Platform.OS === 'web') popVisualizerHistory(window.history);
    // Turned off from the picker (or nothing left to draw): focus goes back to Now Playing's transport.
    if (Platform.isTV || Platform.OS === 'web') requestAnimationFrame(() => focusElement('now-playing-toggle'));
  }, [visuals, expanded]);
  const visualizerSwitch = useMemo(() => plan.switch
    ? { on: visualizerOn, onToggle: (on: boolean) => setVisualizerEnabled(profile, on) } : undefined, [plan.switch, visualizerOn, profile]);
  const openVisualizer = useCallback(() => {
    beginVisualizerFullscreen();
    if (Platform.OS === 'web') pushVisualizerHistory(window.history);
    setExpanded(true);
  }, []);
  const leaveVisualizer = useCallback(() => {
    if (Platform.OS === 'web') popVisualizerHistory(window.history);
    setExpanded(false);
    if (Platform.isTV || Platform.OS === 'web') requestAnimationFrame(() => focusElement('now-playing-visualizer'));
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'web' || !visuals) return;
    const restore = () => {
      if (inVisualizerHistory(window.history)) setExpanded(true);
      else if (expanded) leaveVisualizer();
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, [visuals, expanded, leaveVisualizer]);
  useEffect(() => playing && open ? holdBack(() => {
    if (fullscreen) leaveVisualizer(); else close();
    return true;
  }) : undefined, [playing, open, fullscreen, leaveVisualizer, close]);
  useEffect(() => {
    if (!fullscreen || Platform.OS !== 'web') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        leaveVisualizer();
      } else if (event.key === 'Tab') {
        const page = document.querySelector('[data-testid="visualizer-page"]');
        const buttons = page?.querySelectorAll<HTMLElement>('[role="button"], [role="radio"]');
        const first = buttons?.[0], last = buttons?.[buttons.length - 1];
        if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [fullscreen, leaveVisualizer]);
  // Until the hard cut, builds that ask for the listen documents draw Now Playing and the
  // full-screen visualizer from them (vela:listen/nowPlaying and vela:listen/visualizer); the dock
  // still opens, closes and leads them.
  const documents = config.listen === 'documents' && hasExperience('listen');
  // A document draws once its first read answers: the trap takes focus then (a TV), not on
  // opening, so focus lands where the hand-written one's did (the guide's first child).
  const trap = useRef<Focusable>(null);
  const focusTrap = useCallback(() => { setTimeout(() => trap.current?.requestTVFocus?.(), 400); }, []);
  const dock = useMemo<ListenDock>(() => ({ close, openVisualizer: readyToOpen ? openVisualizer : undefined, visualizer: visualizerSwitch, hidden: fullscreen, shown: focusTrap }),
    [close, readyToOpen, openVisualizer, visualizerSwitch, fullscreen, focusTrap]);
  const noBack = useCallback(() => undefined, []);
  const noParams = useCallback(() => undefined, []);
  const screenActions = useAppScreenActions({ host: host ?? null, back: noBack, setParams: noParams });
  const nowPlayingParams = useMemo<Record<string, string>>(() => (panel ? { panel } : {} as Record<string, string>), [panel]);
  if (!host) return null;
  const bottom = Math.max(14, insets.bottom + 10);
  const still = host.env.still;
  // Now Playing rises out of the mini player and sinks back into it: its top starts and ends at the
  // bar's top edge while the bar fades out under it, then in again (presence.tsx).
  const fromBar = Math.max(0, host.viewport.height - bottom - MINI_PLAYER_HEIGHT);
  // A TV fades Now Playing in where it stands: risen from the bar, it was far below the screen when
  // it took focus, and tvOS scrolled its page to the transport, leaving the artwork and the Up Next
  // tabs above the screen.
  const nowPlaying = (
    <Presence shown={playing && open} still={still} offstage={Platform.isTV ? { opacity: 0 } : { y: fromBar, opacity: 0 }} enterMs={NOW_PLAYING_ENTER} exitMs={NOW_PLAYING_EXIT} style={fill}>
      <TVFocusTrap open={playing && open} guideRef={documents ? trap : undefined}>
        <View collapsable={false} style={[fill, visuals && { backgroundColor: pageColor }]} testID={fullscreen ? 'visualizer-page' : undefined} accessibilityViewIsModal>
          {documents ? (
            <ListenDockContext.Provider value={dock}>
              <ScreenView target={NOW_PLAYING_TARGET} href={builtinHref('listen', 'nowPlaying')} params={nowPlayingParams} host={host} active={playing && open}
                actions={screenActions} route={false} quiet />
              {fullscreen ? <View style={fill}><ScreenView target={VISUALIZER_TARGET} href={builtinHref('listen', 'visualizer')} host={host} active actions={screenActions} route={false} quiet /></View> : null}
            </ListenDockContext.Provider>
          ) : <>
            {plan.stage ? <Visualizer mode={plan.stage} /> : null}
            <NowPlaying onClose={close} panel={panel} hidden={fullscreen} onOpenVisualizer={readyToOpen ? openVisualizer : undefined} visualizer={visualizerSwitch} />
          </>}
          {fullscreen && !Platform.isTV ? <View style={{ position: 'absolute', top: insets.top + 16, left: insets.left + 20, borderRadius: 24, backgroundColor: pageColor }}>
            <RoundButton icon="back" label={msg('visualizer.close')} testID="visualizer-close" onPress={leaveVisualizer} />
          </View> : null}
        </View>
      </TVFocusTrap>
    </Presence>
  );
  return (
    <HostContext.Provider value={host}>
      <MediaActionsContext.Provider value={actions}>
        <Above>
          {/* On tvOS a view drawn over the page hides the focus guides beneath it from the focus engine
              (the nav, the music rail, a page's bands): a full-screen layer under the mini player kept
              the remote from leaving it, or a page, for any of them. On a TV the mini player's layer
              is only as tall as the bar, and Now Playing has a layer of its own while it is open. */}
          <View pointerEvents="box-none" style={Platform.isTV ? [dockStrip, { height: bottom + MINI_PLAYER_HEIGHT }] : fill}>
            <Presence shown={playing && !open && !inMusicShell} still={still} offstage={{ y: 18, scale: 0.98 }} exitMs={MOTION.quick} style={fill}>
              <MiniPlayer onOpen={() => setOpen(true)} bottom={bottom} />
            </Presence>
            {Platform.isTV ? null : nowPlaying}
          </View>
          {Platform.isTV ? nowPlaying : null}
        </Above>
      </MediaActionsContext.Provider>
    </HostContext.Provider>
  );
}
