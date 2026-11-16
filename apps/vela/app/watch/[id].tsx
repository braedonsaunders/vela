// The watch route: a title, a channel (`?kind=channel`) or an extra (`?kind=extra`) played full
// screen through VelaPlayerView, under the player chrome in the active document's look. Core's
// playback slice starts, follows and stops the session; this route is the trusted host that hands
// the server's media authorization to the player.
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { msg, type PlaybackTarget } from '@vela/core';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import type { DetailModel } from '@vela/skin';
import { useLiveView, useLiveWatch } from '@vela/skin/src/widgets/guide';
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

function targetOf(kind: string | undefined, id: string): PlaybackTarget {
  if (kind === 'channel') return { kind: 'channel', id };
  if (kind === 'extra') return { kind: 'extra', id };
  return { kind: 'title', id };
}

export default function Watch() {
  const { id = '', kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const { host, openTitle, store } = useVela();
  const target = useMemo(() => targetOf(kind, id), [kind, id]);
  const session = usePlaybackSession(target);
  const skin = host('watch', id);
  const sessionId = session.view.plan?.sessionId ?? '';
  const channels = useLiveView().guide?.channels;
  const focused = useIsFocused();
  useLiveWatch(focused && target.kind === 'channel');

  useEffect(() => {
    if (id && target.kind === 'title') openTitle(id);
  }, [id, target.kind, openTitle]);

  // Each session's media authorization goes straight to the player, never through props or state.
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    store.playback.mediaAccess().then(
      grant => {
        if (live) VelaPlayer.setMediaAccess(grant);
      },
      () => undefined,
    );
    return () => {
      live = false;
      VelaPlayer.setMediaAccess(null);
    };
  }, [store, sessionId]);

  const { stop } = session;
  const close = useCallback(() => {
    stop();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [stop]);

  const channel = target.kind === 'channel' ? channels?.find(c => c.id === id) : undefined;
  const title = channel ? `${channel.number} · ${channel.name}` : heading(skin?.env.detail);
  // Now Playing (the system's controls): the heading the chrome shows, and the title's poster.
  const poster = target.kind === 'title' ? skin?.env.detail?.title[0]?.poster : undefined;
  const metadata = { title, ...(poster ? { artworkUrl: poster } : {}) };
  if (!skin) return <View style={styles.stage} />;
  return (
    <WatchSurface host={skin} state={{ ...session.chrome, title, close }}>
      {session.view.plan ? (
        <VelaPlayerView {...session.view} metadata={metadata} style={StyleSheet.absoluteFill} />
      ) : null}
    </WatchSurface>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
});
