// The watch route: a title played full screen through VelaPlayerView, under the player chrome in
// the active document's look. Core's playback slice starts, follows and stops the session; this
// route is the trusted host that hands the server's media authorization to the player.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { msg } from '@vela/core';
import { useVela as useCore } from '@vela/core/react';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import type { DetailModel } from '@vela/skin';
import { usePlaybackSession, WatchSurface } from '@vela/skin/src/widgets/player';
import { useVela } from '../../src/vela';

/** "S1 · E2 · Name" for an episode, the name otherwise. */
function heading(detail: DetailModel | undefined): string {
  const title = detail?.title[0];
  if (!title) return msg('ui.nowPlaying');
  if (title.kind === 'episode' && title.seasonNumber > 0 && title.episodeNumber > 0) {
    const numbers = { season: title.seasonNumberLabel, episode: title.episodeNumberLabel };
    return msg('ui.sSeasonEEpisodeTitle', { ...numbers, title: title.name });
  }
  return title.name;
}

export default function Watch() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const { host, openTitle } = useVela();
  const core = useCore();
  const target = useMemo(() => ({ kind: 'title' as const, id }), [id]);
  const session = usePlaybackSession(target);
  const skin = host('title', id);
  const sessionId = session.view.plan?.sessionId ?? '';

  useEffect(() => {
    if (id) openTitle(id);
  }, [id, openTitle]);

  // Each session's media authorization goes straight to the player, never through props or state.
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    core.playback.mediaAccess().then(
      grant => {
        if (live) VelaPlayer.setMediaAccess(grant);
      },
      () => undefined,
    );
    return () => {
      live = false;
      VelaPlayer.setMediaAccess(null);
    };
  }, [core, sessionId]);

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
