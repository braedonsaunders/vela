// The watch route: a title played full screen through VelaPlayerView, under the player chrome
// in the active document's look. The playback controller the app provides starts and stops the
// session; without one, the route says playback could not start rather than pretending.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { msg } from '@vela/core';
import { VelaPlayerView } from '@vela/player';
import type { PlaybackController } from '@vela/skin/src/widgets/player';
import { usePlaybackController, usePlaybackSession, WatchSurface } from '@vela/skin/src/widgets/player';
import type { DetailModel } from '@vela/skin';
import { useVela } from '../../src/vela';

const UNAVAILABLE: PlaybackController = {
  start: async () => ({ kind: 'refused', capacity: false, message: msg('ui.playbackCouldnTBeStarted') }),
  command: async plan => plan,
  refresh: async () => {
    throw new Error('No playback controller');
  },
  observe: async () => undefined,
};

/** "S1 · E2 · Name" for an episode, the name otherwise. */
function heading(detail: DetailModel | undefined): string {
  const title = detail?.title[0];
  if (!title) return msg('ui.nowPlaying');
  if (title.kind === 'episode' && title.seasonNumber > 0 && title.episodeNumber > 0) {
    return msg('ui.sSeasonEEpisodeTitle', { season: title.seasonNumberLabel, episode: title.episodeNumberLabel, title: title.name });
  }
  return title.name;
}

export default function Watch() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { host, openTitle } = useVela();
  const controller = usePlaybackController() ?? UNAVAILABLE;
  const session = usePlaybackSession(controller, id);
  const skin = host('title', id);

  useEffect(() => {
    if (id) openTitle(id);
  }, [id, openTitle]);

  const { stop } = session;
  const close = useCallback(() => {
    stop();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [stop]);

  if (!skin) return <View style={styles.stage} />;
  return (
    <WatchSurface host={skin} state={{ ...session.chrome, title: heading(skin.env.detail), close }}>
      {session.view.plan ? <VelaPlayerView {...session.view} style={StyleSheet.absoluteFill} /> : null}
    </WatchSurface>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
});
