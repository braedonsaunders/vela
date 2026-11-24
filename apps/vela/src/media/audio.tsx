// The app's audio: the platform engine attached to the store's queue, the system's media
// session kept in step, and the mini player and Now Playing drawn over every route.
import { router, usePathname } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentType, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, TVFocusGuideView, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostContext } from '@vela/skin/src/host';
import { MediaActionsContext } from '@vela/skin/src/widgets/media';
import { MINI_PLAYER_HEIGHT, MiniPlayer, NowPlaying } from '@vela/skin/src/widgets/media/player';
import { MOTION, Presence } from '@vela/skin/src/presence';
import { holdBack } from '@vela/skin/src/menu-key';
import { useVelaState } from '@vela/core/react';
import { useVela } from '../vela';
import { createAudioEngine, syncMediaSession, type MediaSessionControls } from './audio-engine';
import { useMediaPageActions } from './actions';
import { musicTV, onOpenNowPlaying, type NowPlayingPanel } from '@vela/skin/src/widgets/music';
import { useMediaPlayerActions } from './player-actions';
import { useReaderActions } from './reader-actions';

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
function TVFocusTrap({ open, children }: { open: boolean; children: ReactNode }) {
  const guide = useRef<Focusable>(null);
  useEffect(() => {
    if (!open) return;
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
/** Now Playing's rise is a long move, so a little longer than a section; its fall is quicker. */
const NOW_PLAYING_ENTER = 420;
const NOW_PLAYING_EXIT = 280;

export function AudioDock() {
  const vela = useVela();
  const store = vela.store;
  const audio = useVelaState(state => state.audio);
  const pathname = usePathname();
  const host = vela.host('home', '');
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<NowPlayingPanel | undefined>(undefined);
  useEffect(() => onOpenNowPlaying(next => { setPanel(next); setOpen(true); }), []);
  useEffect(() => store.audio.attach(createAudioEngine(() => store.playback.mediaAccess())), [store]);
  const controls = useMemo<MediaSessionControls>(() => ({
    play: () => store.audio.resume(), pause: () => store.audio.pause(), next: () => store.audio.next(),
    previous: () => store.audio.previous(), seek: seconds => store.audio.seek(seconds), skip: delta => store.audio.skip(delta),
  }), [store]);
  useEffect(() => syncMediaSession(audio, controls), [audio, controls]);
  // The viewer sees plain copy; the cause goes to the console for whoever is debugging.
  useEffect(() => { if (audio.error) console.warn(`Vela audio: ${audio.error}`); }, [audio.error]);
  useEffect(() => { if (!audio.queue) setOpen(false); }, [audio.queue]);
  const close = useCallback(() => setOpen(false), []);
  // Back (Menu on tvOS) closes Now Playing before it reaches the page beneath.
  useEffect(() => (audio.queue && open ? holdBack(() => { setOpen(false); return true; }) : undefined), [audio.queue, open]);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), []);
  const actions = useMediaPageActions(undefined, back, useMediaPlayerActions(), useReaderActions(undefined));
  // Video and the reader own the screen; the sign-in pages have nothing to play.
  const covered = pathname.startsWith('/watch') || pathname.startsWith('/read') || pathname.startsWith('/sign-in') || pathname.startsWith('/connect');
  // The audio app draws its own now-playing bar along the bottom; the floating one stands aside.
  const musicLibrary = useVelaState(state => state.libraries.value?.some(library => library.experience === 'audio' && pathname === `/library/${library.id}`));
  const inMusicShell = !!musicLibrary && !musicTV() && (host?.viewport.width ?? 0) >= 980;
  const playing = !!audio.queue && !covered;
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
      <TVFocusTrap open={playing && open}>
        <NowPlaying onClose={close} panel={panel} />
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
