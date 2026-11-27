import { useVelaState } from '@vela/core/react';
// The watch route: a title, a channel (`?kind=channel`) or an extra (`?kind=extra`) played full
// screen through VelaPlayerView, under the player chrome in the active document's look. Core's
// playback slice starts, follows and stops the session; this route is the trusted host that hands
// the server's media authorization to the player.
import { router, useIsFocused, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, type ComponentProps } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaFrame, useSafeAreaInsets } from 'react-native-safe-area-context';
import { msg, type PlaybackTarget } from '@vela/core';
import { pictureInPicture, VelaPlayerView } from '@vela/player';
import type { DetailModel } from '@vela/skin';
import { useLiveContext, useLiveView, useLiveWatch } from '@vela/skin/src/widgets/guide';
import { backFromNavigation, episodeLabel, useBackHeld, useNextEpisode, usePlaybackSession, WatchSurface, type NextEpisode } from '@vela/skin/src/widgets/player';
import { playerUsesHandheldGeometry } from '@vela/skin/src/widgets/player/look';
import { phoneControlLayout, watchSideInsets } from '@vela/skin/src/widgets/player/phone-layout';
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

function targetOf(kind: string | undefined, id: string, libraryId?: string, tab?: string, channelId?: string, from?: string, showId?: string, startAt?: string, durationSeconds?: string): PlaybackTarget {
  if (kind === 'channel') return { kind: 'channel', id };
  // A programme from the channel's archive: ended (catch-up), or on air from its start.
  if (kind === 'programme' && channelId) {
    const duration = Number(durationSeconds);
    const range = startAt && Number.isFinite(Date.parse(startAt)) && Number.isFinite(duration) && duration > 0
      ? { startAt, durationSeconds: duration } : undefined;
    return { kind: 'programme', id, channelId, ...(range ? { range } : from === 'start' ? { from } : {}) };
  }
  if (kind === 'extra') return { kind: 'extra', id };
  if (kind === 'library-live' && libraryId) return { kind: 'library-live', id, libraryId, tab };
  return { kind: 'title', id, ...(showId ? { showId } : {}) };
}

export default function Watch() {
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const { store } = useVela();
  const phase = useVelaState(state => state.auth.phase);
  const hydrated = useVelaState(state => state.downloads.hydrated);
  if (phase !== 'signed-in' && !(phase === 'offline' && hydrated && !kind && store.downloads.isPlayable(id))) {
    return <View style={styles.stage} />;
  }
  return <WatchPlayer />;
}

function WatchPlayer() {
  const { id = '', kind, libraryId, tab, mediaSourceId, audioTrackId, positionSeconds, versionId, channelId, from, showId, startAt, durationSeconds, playbackRequest } = useLocalSearchParams<{ id: string; kind?: string; libraryId?: string; tab?: string; mediaSourceId?: string; audioTrackId?: string; positionSeconds?: string; versionId?: string; channelId?: string; from?: string; showId?: string; startAt?: string; durationSeconds?: string; playbackRequest?: string }>();
  const { host, openTitle, store } = useVela();
  const target = useMemo(() => ({ ...targetOf(kind, id, libraryId, tab, channelId, from, showId, startAt, durationSeconds), ...(kind !== 'channel' && kind !== 'extra' && kind !== 'library-live' && startPosition(positionSeconds) !== undefined ? { positionSeconds: startPosition(positionSeconds) } : {}), ...(mediaSourceId ? { mediaSourceId } : {}), ...(audioTrackId ? { audioTrackId } : {}), ...(versionId ? { versionId } : {}) }), [kind, id, libraryId, tab, mediaSourceId, audioTrackId, positionSeconds, versionId, channelId, from, showId, startAt, durationSeconds]);
  const live = useLiveContext();
  const liveView = useLiveView();
  // A channel's session is the live controller's: its plan, its refusal (or a retry on the
  // server's terms) and Try again all come from the tile tuned to this channel.
  const tile = liveView.tile.channelId === id ? liveView.tile : null;
  const owned = target.kind === 'channel' && live ? {
    plan: tile?.plan ?? null,
    failure: tile?.failure ?? null,
    retrying: tile?.retrying ?? null,
    snapshot: (value: Parameters<typeof live.controller.tileSnapshot>[0]) => live.controller.tileSnapshot(value),
    retry: () => live.controller.retryWatch(id),
    updatePlan: (plan: Parameters<typeof live.controller.updateWatchPlan>[0]) => live.controller.updateWatchPlan(plan),
  } : undefined;
  // Android's picture-in-picture window keeps the watch on screen while the app is in the background.
  const { width, height } = useWindowDimensions();
  const webPicture = Platform.OS === 'web' && phoneControlLayout(width, height, playerUsesHandheldGeometry(), false).compact;
  const session = usePlaybackSession(target, owned, pictureInPicture, webPicture, playbackRequest);
  const skin = host('watch', id);
  const sessionId = session.view.plan?.sessionId ?? '';
  const channels = liveView.guide?.channels;
  const focused = useIsFocused();
  // A programme from the archive flicks channels too: up and down tune the neighbours live.
  useLiveWatch(focused && (target.kind === 'channel' || target.kind === 'programme'));
  useEffect(() => {
    if (!live || target.kind !== 'channel' || !focused || !id) return;
    live.controller.enterWatch(id);
    return () => { setTimeout(() => live.controller.leaveWatch(id), 0); };
  }, [live, focused, target.kind, id]);
  // Back with a player menu open closes the menu. tvOS's Menu also reaches the native stack,
  // which would pop the player: its removal waits while a menu holds Back.
  usePreventRemove(useBackHeld(), backFromNavigation);

  const local = session.view.plan?.sessionId.startsWith('local-') === true;
  const offline = useVelaState(state => state.auth.phase === 'offline');
  useEffect(() => (!offline && !store.downloads.isPlayable(id) && id && target.kind === 'title' ? openTitle(id) : undefined), [id, target.kind, openTitle, offline, store]);

  // Media authorization belongs to the signed-in session (src/media-access.ts), not to a watch.

  // An episode's next one: the chrome offers it (and on the final credits, in place of Skip
  // credits). Starting it keeps this route, so the session in hand stops before the next begins.
  const detailTitle = skin?.env.detail?.title[0];
  const next = useNextEpisode(!offline && !local && target.kind === 'title' && detailTitle?.id === id ? detailTitle : undefined);
  const nextEpisode = useMemo<NextEpisode | null>(() => next ? {
    label: episodeLabel(next),
    play: () => router.setParams({ id: next.id, kind: undefined, positionSeconds: undefined, mediaSourceId: undefined, audioTrackId: undefined, versionId: undefined, showId: next.showId ?? showId }),
  } : null, [next, showId]);
  const plex = useVelaState(state => state.servers.list.some(server => server.selected && server.kind === 'plex'));
  const handledEnd = useRef('');
  const sleepingEnd = useRef('');
  // Wait for Plex to confirm completion. An earlier end can still be a transition between parts.
  const ended = session.view.plan?.state === 'ended' && session.view.plan.titleId === id;
  useEffect(() => {
    if (!plex || !focused || !ended || !sessionId || !nextEpisode || handledEnd.current === sessionId || sleepingEnd.current === sessionId) return;
    handledEnd.current = sessionId;
    nextEpisode.play();
  }, [plex, focused, ended, sessionId, nextEpisode]);
  type ObservationEvent = Parameters<NonNullable<typeof session.view.onObservation>>[0];
  const lastReport = useRef<ObservationEvent | null>(null);
  const onObservation = (event: ObservationEvent) => {
    if (event.sessionId !== sessionId) return;
    lastReport.current = event;
    session.view.onObservation?.(event);
  };
  const onSnapshot: typeof session.view.onSnapshot = snapshot => {
    // The session clears its sleep timer on the final snapshot.
    session.view.onSnapshot?.(snapshot);
    if (snapshot.state !== 'ended' || !sessionId || snapshot.sessionId !== sessionId) return;
    if (session.chrome.sleep && session.chrome.sleep.value.mode !== 'off') sleepingEnd.current = sessionId;
    if (Platform.OS !== 'web' || !plex || target.kind !== 'title' || local || !snapshot.sourceId) return;
    const { sourceGeneration, seekGeneration, position, sourceId } = snapshot;
    // Web emits snapshots before observations. If its progress throttle skipped this final report,
    // forward the terminal snapshot once the player's synchronous observation handler has run.
    queueMicrotask(() => {
      const plan = store.getState().playback.plan;
      if (plan?.sessionId !== sessionId || plan.state === 'ended' ||
        plan.sourceGeneration !== sourceGeneration || plan.seekGeneration !== seekGeneration) return;
      const last = lastReport.current?.sessionId === sessionId ? lastReport.current.observation : undefined;
      if (last?.state === 'ended' && last.sourceGeneration === sourceGeneration && last.seekGeneration === seekGeneration) return;
      const sequence = (last?.sequence ?? 0) + 1;
      onObservation({ sessionId, observation: {
        idempotencyKey: `${sessionId}:${sourceGeneration}:${seekGeneration}:${sequence}`,
        sourceGeneration, seekGeneration, sequence, state: 'ended', observedAt: new Date().toISOString(),
        positionSeconds: position, selectedPathId: sourceId, playableRanges: [],
      } });
    });
  };

  const { stop } = session;
  const close = useCallback(() => {
    stop();
    if (router.canGoBack()) router.back();
    else router.replace(offline || local ? '/downloads' : '/');
  }, [stop, offline, local]);

  const liveChannelId = session.view.plan?.channelId || (target.kind === 'channel' ? id : '');
  const channel = liveChannelId ? channels?.find(c => c.id === liveChannelId) : undefined;
  const programmeChannel = target.kind === 'programme' ? channels?.find(c => c.id === target.channelId) : undefined;
  const title = channel
    ? `${channel.number} · ${channel.name}`
    : target.kind === 'programme'
      ? [session.view.plan?.title, !liveChannelId ? programmeChannel?.name : undefined].filter(Boolean).join(' · ') || msg('catchUp.fromArchive')
    : target.kind === 'library-live'
      ? session.view.plan?.title ?? 'Live'
      : heading(skin?.env.detail);
  // Now Playing (the system's controls): the heading the chrome shows, and the title's poster.
  const poster = target.kind === 'title' ? skin?.env.detail?.title[0]?.poster : undefined;
  const metadata = { title, ...(poster ? { artworkUrl: poster } : {}) };
  if (!skin) return <View style={styles.stage} />;
  return (
    <RouteSurface host={skin} state={{ ...session.chrome, title, close, nextEpisode, episode: target.kind === 'title' && skin.env.detail?.title[0]?.kind === 'episode' }}>
      {captionInsets => session.view.plan ? (
        <View pointerEvents={Platform.OS === 'android' ? 'none' : 'box-none'} style={StyleSheet.absoluteFill}>
          <VelaPlayerView {...session.view} onSnapshot={onSnapshot} onObservation={onObservation} metadata={metadata} captionInsets={captionInsets} style={StyleSheet.absoluteFill} />
        </View>
      ) : null}
    </RouteSurface>
  );
}

type SurfaceProps = ComponentProps<typeof WatchSurface>;

function RouteSurface(props: SurfaceProps) {
  if (Platform.isTV || Platform.OS === 'web') return <WatchSurface {...props} />;
  // A full-screen modal owns its own UIKit/Android view and system bars.
  return <SafeAreaProvider><NativeWatchSurface {...props} /></SafeAreaProvider>;
}

function NativeWatchSurface({ host, ...props }: SurfaceProps) {
  const { width, height } = useSafeAreaFrame();
  const safe = useSafeAreaInsets();
  const { top, bottom } = safe;
  const { left, right } = watchSideInsets(width, height, Platform.OS === 'ios' && !Platform.isPad, safe.left, safe.right);
  const watchHost = useMemo(() => ({
    ...host,
    viewport: {
      ...host.viewport,
      width: width - left - right,
      height,
      insets: { top, right: 0, bottom, left: 0 },
      sides: { left, right },
    },
  }), [host, width, height, top, right, bottom, left]);
  return <WatchSurface {...props} host={watchHost} />;
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
});
