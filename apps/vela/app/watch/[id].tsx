// The watch route: a title, a channel (`?kind=channel`) or an extra (`?kind=extra`) played full
// screen through VelaPlayerView, under the player chrome in the active document's look. Core's
// playback slice starts, follows and stops the session; this route is the trusted host that hands
// the server's media authorization to the player.
import { router, useIsFocused, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { msg, type PlaybackTarget } from '@vela/core';
import { VelaPlayer, VelaPlayerView } from '@vela/player';
import type { DetailModel } from '@vela/skin';
import { useLiveContext, useLiveView, useLiveWatch } from '@vela/skin/src/widgets/guide';
import { backFromNavigation, useBackHeld, usePlaybackSession, WatchSurface } from '@vela/skin/src/widgets/player';
import { startPosition } from '../../src/play-action';
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

function targetOf(kind: string | undefined, id: string, libraryId?: string, tab?: string): PlaybackTarget {
  if (kind === 'channel') return { kind: 'channel', id };
  if (kind === 'extra') return { kind: 'extra', id };
  if (kind === 'library-live' && libraryId) return { kind: 'library-live', id, libraryId, tab };
  return { kind: 'title', id };
}

export default function Watch() {
  const { id = '', kind, libraryId, tab, mediaSourceId, audioTrackId, positionSeconds } = useLocalSearchParams<{ id: string; kind?: string; libraryId?: string; tab?: string; mediaSourceId?: string; audioTrackId?: string; positionSeconds?: string }>();
  const { host, openTitle, store } = useVela();
  const target = useMemo(() => ({ ...targetOf(kind, id, libraryId, tab), ...(kind !== 'channel' && kind !== 'extra' && kind !== 'library-live' && startPosition(positionSeconds) !== undefined ? { positionSeconds: startPosition(positionSeconds) } : {}), ...(mediaSourceId ? { mediaSourceId } : {}), ...(audioTrackId ? { audioTrackId } : {}) }), [kind, id, libraryId, tab, mediaSourceId, audioTrackId, positionSeconds]);
  const live = useLiveContext();
  const liveView = useLiveView();
  const owned = target.kind === 'channel' && live ? {
    plan: liveView.tile.channelId === id ? liveView.tile.plan : null,
    snapshot: (value: Parameters<typeof live.controller.tileSnapshot>[0]) => live.controller.tileSnapshot(value),
    failed: () => live.controller.tileFailed(),
    updatePlan: (plan: Parameters<typeof live.controller.updateWatchPlan>[0]) => live.controller.updateWatchPlan(plan),
  } : undefined;
  const session = usePlaybackSession(target, owned);
  const skin = host('watch', id);
  const sessionId = session.view.plan?.sessionId ?? '';
  const channels = liveView.guide?.channels;
  const focused = useIsFocused();
  useLiveWatch(focused && target.kind === 'channel');
  useEffect(() => {
    if (!live || target.kind !== 'channel' || !focused || !id) return;
    live.controller.enterWatch(id);
    return () => { setTimeout(() => live.controller.leaveWatch(id), 0); };
  }, [live, focused, target.kind, id]);
  // Back with a player menu open closes the menu. tvOS's Menu also reaches the native stack,
  // which would pop the player: its removal waits while a menu holds Back.
  usePreventRemove(useBackHeld(), backFromNavigation);

  useEffect(() => (id && target.kind === 'title' ? openTitle(id) : undefined), [id, target.kind, openTitle]);

  // Each session's media authorization goes straight to the player, never through props or state.
  useEffect(() => {
    if (!sessionId || owned) return;
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
  }, [store, sessionId, !!owned]);

  const { stop } = session;
  const close = useCallback(() => {
    stop();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [stop]);

  const channel = target.kind === 'channel' ? channels?.find(c => c.id === id) : undefined;
  const title = channel
    ? `${channel.number} · ${channel.name}`
    : target.kind === 'library-live'
      ? session.view.plan?.title ?? 'Live'
      : heading(skin?.env.detail);
  // Now Playing (the system's controls): the heading the chrome shows, and the title's poster.
  const poster = target.kind === 'title' ? skin?.env.detail?.title[0]?.poster : undefined;
  const metadata = { title, ...(poster ? { artworkUrl: poster } : {}) };
  if (!skin) return <View style={styles.stage} />;
  return (
    <WatchSurface host={skin} state={{ ...session.chrome, title, close }}>
      {session.view.plan ? (
        <View pointerEvents={Platform.OS === 'android' ? 'none' : 'box-none'} style={StyleSheet.absoluteFill}>
          <VelaPlayerView {...session.view} metadata={metadata} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
    </WatchSurface>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
});
