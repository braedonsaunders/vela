// The music app: Your Library down the left, the page in the middle, the queue on the right when
// asked for, and the now-playing bar along the bottom. Wide layouts only; phones and TVs draw the
// same pages full width with the floating mini player.
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { msg, number, type Card, type PlaylistModel } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, Glyph, useInteraction } from '../common/controls';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { placeOf, useMusic } from './context';
import { useLiked, usePlaylists } from './data';
import { LikedCover, MusicHome, MusicLiked, MusicPlaylist, MusicTitle, playlistCard, Chip } from './pages';
import { samePlace, type MusicPlace } from './place';
import { IconButton, menuHandlers, transition } from './parts';
import { NowPlayingBar, NOW_PLAYING_BAR_HEIGHT } from './bar';
import { QueuePanel } from './queue';

export function MusicShell({ queueOpen, onQueue }: { queueOpen: boolean; onQueue(open: boolean): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const [collapsed, setCollapsed] = useState(false);
  const narrow = m.width < 1180;
  const rail = collapsed || narrow;
  const page = app.place;
  const panel = (children: ReactNode, style: object = {}) => (
    <View style={[{ backgroundColor: m.ui.raised, borderRadius: Number(m.ui.radiusPanel) || 14, overflow: 'hidden' }, m.box({ border: '1px solid $ui.glassEdge' }), style]}>{children}</View>
  );
  return (
    <View pointerEvents="box-none" style={{ flex: 1, paddingHorizontal: 10, paddingTop: 62, gap: 8 }} testID="music-shell">
      <View style={{ flex: 1, flexDirection: 'row', gap: 8, minHeight: 0 }}>
        {panel(<Sidebar rail={rail} onToggle={() => setCollapsed(!collapsed)} />, { width: rail ? 84 : 316 })}
        {panel(
          <ScrollView key={pageKey(page)} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} testID="music-main">
            {page.kind === 'home' ? <MusicHome />
              : page.kind === 'liked' ? <MusicLiked />
              : page.kind === 'playlist' ? <MusicPlaylist id={page.id} />
              : page.kind === 'title' ? <MusicTitle id={page.id} />
              : <MusicHome />}
          </ScrollView>, { flex: 1 })}
        {queueOpen ? panel(<QueuePanel onClose={() => onQueue(false)} />, { width: 340 }) : null}
      </View>
      <View style={{ height: NOW_PLAYING_BAR_HEIGHT }}><NowPlayingBar queueOpen={queueOpen} onQueue={() => onQueue(!queueOpen)} /></View>
    </View>
  );
}

function pageKey(place: MusicPlace): string {
  return place.kind === 'title' || place.kind === 'playlist' ? `${place.kind}:${place.id}` : place.kind;
}

type Filter = 'all' | 'playlists' | 'albums' | 'artists';

function Sidebar({ rail, onToggle }: { rail: boolean; onToggle(): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const { playlists } = usePlaylists();
  const liked = useLiked();
  const [filter, setFilter] = useState<Filter>('all');
  const entries: { card: Card; subtitle: string }[] = [
    ...(filter === 'all' || filter === 'playlists' ? playlists.map(p => ({ card: playlistCard(p), subtitle: `${msg('music.playlist')} · ${countLabel(p)}` })) : []),
    ...(filter === 'all' || filter === 'albums' ? liked.albums.map(a => ({ card: a, subtitle: `${msg('media.ui.album')} · ${a.media?.byline ?? ''}` })) : []),
    ...(filter === 'all' || filter === 'artists' ? liked.artists.map(a => ({ card: a, subtitle: msg('media.ui.artist') })) : []),
  ];
  return (
    <View style={{ flex: 1 }} testID="music-library" accessibilityLabel={msg('music.yourLibrary')} {...({ role: 'navigation' } as object)}>
      <View style={{ padding: rail ? 12 : 10, gap: 2 }}>
        <NavItem symbol="home" label={msg('music.home')} place={{ kind: 'home' }} rail={rail} />
        <NavItem symbol="search" label={msg('music.search')} place={{ kind: 'search' }} rail={rail} />
      </View>
      <View style={[{ marginHorizontal: 12, height: 1 }, m.box({ 'background-color': '$ui.glassEdge' })]} />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: rail ? 'center' : 'space-between', paddingHorizontal: rail ? 0 : 16, paddingTop: 14, paddingBottom: 8 }}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={msg('music.yourLibrary')} style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Glyph symbol="library" size={24} color={m.ui.inkSecondary} />
          {!rail ? <Text style={m.text({ 'font-size': '16px', 'font-weight': '750', color: '$ui.inkSecondary' })}>{msg('music.yourLibrary')}</Text> : null}
        </Pressable>
        {!rail ? <IconButton symbol="playlist-add" label={msg('music.newPlaylist')} size={34} iconSize={19} onPress={() => undefined} testID="music-new-playlist" /> : null}
      </View>
      {!rail ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }} accessibilityRole="radiogroup">
          {(['playlists', 'albums', 'artists'] as const).map(f => <Chip key={f} label={msg(`music.${f}`)} on={filter === f} onPress={() => setFilter(filter === f ? 'all' : f)} />)}
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: rail ? 8 : 8, paddingBottom: 12 }}>
        {filter === 'all' || filter === 'playlists'
          ? <LibraryRow rail={rail} place={{ kind: 'liked' }} title={msg('music.liked')} subtitle={`${msg('music.playlist')} · ${msg(`media.count.tracks.${liked.tracks.length === 1 ? 'one' : 'other'}`, { count: number(liked.tracks.length) })}`} cover={<LikedCover size={48} />} pinned />
          : null}
        {entries.map(({ card, subtitle }) => (
          <LibraryRow key={card.id} rail={rail} place={placeOf(card)} card={card} title={card.name} subtitle={subtitle}
            cover={card.kind === 'playlist' ? <PlaylistThumb playlist={playlists.find(p => p.id === card.id)} /> : <Cover uri={card.poster} shape={card.media?.role === 'artist' ? 'round' : 'square'} size={48} title={card.name} accent={card.accent} lift={0.2} />} />
        ))}
      </ScrollView>
    </View>
  );
}

function countLabel(p: PlaylistModel): string {
  return msg(`media.count.tracks.${p.itemCount === 1 ? 'one' : 'other'}`, { count: number(p.itemCount) });
}

function PlaylistThumb({ playlist }: { playlist?: PlaylistModel }) {
  const m = useMediaLook();
  if (playlist?.poster) return <Cover uri={playlist.poster} shape="square" size={48} title={playlist.name} lift={0.2} />;
  return <View style={{ width: 48, height: 48, borderRadius: 4, backgroundColor: m.ui.control, alignItems: 'center', justifyContent: 'center' }}><Glyph symbol="list" size={20} color={m.ui.inkQuiet} /></View>;
}

function NavItem({ symbol, label, place, rail }: { symbol: string; label: string; place: MusicPlace; rail: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const on = samePlace(app.place, place);
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={() => app.go(place)} accessibilityRole="link" accessibilityState={{ selected: on }} accessibilityLabel={label}
      style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 16, height: 44, paddingHorizontal: rail ? 0 : 12, justifyContent: rail ? 'center' : 'flex-start', borderRadius: 10, backgroundColor: lit ? m.ui.control : 'transparent' }, transition('background-color', 120)]}>
      <Glyph symbol={symbol} size={24} color={on || lit ? m.ui.ink : m.ui.inkSecondary} />
      {!rail ? <Text style={m.text({ 'font-size': '16px', 'font-weight': '700', color: on || lit ? '$ui.ink' : '$ui.inkSecondary' })}>{label}</Text> : null}
    </Pressable>
  );
}

function LibraryRow({ place, card, title, subtitle, cover, rail, pinned = false }: { place: MusicPlace; card?: Card; title: string; subtitle: string; cover: ReactNode; rail: boolean; pinned?: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  const on = samePlace(app.place, place);
  return (
    <Pressable {...handlers} {...(card ? menuHandlers(point => app.menu({ card, anchor: { kind: 'point', point } })) : {})} onPress={() => app.go(place)}
      accessibilityRole="link" accessibilityState={{ selected: on }} accessibilityLabel={`${title}, ${subtitle}`} testID={`music-library-${card?.id ?? place.kind}`}
      style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 6, borderRadius: 8, justifyContent: rail ? 'center' : 'flex-start',
        backgroundColor: on ? alpha(m.ui.ink, 0.1) : lit ? m.ui.control : 'transparent' }, transition('background-color', 120)]}>
      {cover}
      {!rail ? (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={m.text({ 'font-size': '15px', 'font-weight': '600', color: on ? m.ui.accent : '$ui.ink' })}>{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {pinned ? <Glyph symbol="star-fill" size={12} color={m.ui.accent} /> : null}
            <Text numberOfLines={1} style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{subtitle}</Text>
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}
