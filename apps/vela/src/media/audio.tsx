// The app's audio: the platform engine attached to the store's queue, the browser's media
// session kept in step, and the mini player and Now Playing drawn over every route.
import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HostContext } from '@vela/skin/src/host';
import { MediaActionsContext } from '@vela/skin/src/widgets/media';
import { MINI_PLAYER_HEIGHT, MiniPlayer, NowPlaying } from '@vela/skin/src/widgets/media/player';
import { MOTION, Presence } from '@vela/skin/src/presence';
import { useVelaState } from '@vela/core/react';
import { useVela } from '../vela';
import { createAudioEngine, syncMediaSession, type MediaSessionControls } from './audio-engine';
import { useMediaPageActions } from './actions';
import { useMediaPlayerActions } from './player-actions';
import { useReaderActions } from './reader-actions';

const fill = StyleSheet.absoluteFill;
/** Now Playing's rise is a long move, so a little longer than a section; its fall is quicker. */
const NOW_PLAYING_ENTER = 420;
const NOW_PLAYING_EXIT = 280;

export function AudioDock() {
  const vela = useVela();
  const store = vela.store;
  const audio = useVelaState(state => state.audio);
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  useEffect(() => store.audio.attach(createAudioEngine()), [store]);
  const controls = useMemo<MediaSessionControls>(() => ({
    play: () => store.audio.resume(), pause: () => store.audio.pause(), next: () => store.audio.next(),
    previous: () => store.audio.previous(), seek: seconds => store.audio.seek(seconds), skip: delta => store.audio.skip(delta),
  }), [store]);
  useEffect(() => syncMediaSession(audio, controls), [audio, controls]);
  // The viewer sees plain copy; the cause goes to the console for whoever is debugging.
  useEffect(() => { if (audio.error) console.warn(`Vela audio: ${audio.error}`); }, [audio.error]);
  useEffect(() => { if (!audio.queue) setOpen(false); }, [audio.queue]);
  const close = useCallback(() => setOpen(false), []);
  const back = useCallback(() => (router.canGoBack() ? router.back() : router.replace('/')), []);
  const actions = useMediaPageActions(undefined, back, useMediaPlayerActions(), useReaderActions(undefined));
  const host = vela.host('home', '');
  // Video and the reader own the screen; the sign-in pages have nothing to play.
  const covered = pathname.startsWith('/watch') || pathname.startsWith('/read') || pathname.startsWith('/sign-in') || pathname.startsWith('/connect');
  const playing = !!audio.queue && !covered;
  if (!host) return null;
  const bottom = Math.max(14, insets.bottom + 10);
  const still = host.env.still;
  // Now Playing rises out of the mini player and sinks back into it: its top starts and ends at the
  // bar's top edge while the bar fades out under it, then in again (presence.tsx).
  const fromBar = Math.max(0, host.viewport.height - bottom - MINI_PLAYER_HEIGHT);
  return (
    <HostContext.Provider value={host}>
      <MediaActionsContext.Provider value={actions}>
        <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
          <Presence shown={playing && !open} still={still} offstage={{ y: 18, scale: 0.98 }} exitMs={MOTION.quick} style={fill}>
            <MiniPlayer onOpen={() => setOpen(true)} bottom={bottom} />
          </Presence>
          <Presence shown={playing && open} still={still} offstage={{ y: fromBar, opacity: 0 }} enterMs={NOW_PLAYING_ENTER} exitMs={NOW_PLAYING_EXIT} style={fill}>
            <NowPlaying onClose={close} />
          </Presence>
        </View>
      </MediaActionsContext.Provider>
    </HostContext.Provider>
  );
}
