// The audio app: Your Library down the left, the page in the middle, the queue on the right when
// asked for, and the now-playing bar along the bottom. Wide layouts only; phones and TVs draw the
// same pages full width with the floating mini player. Music, audiobooks and podcasts share it;
// listening.ts words each, and spoken.tsx draws spoken word's pages.
import { useState, type ReactNode } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { durationLabel, msg, number, type Card, type PlaylistModel } from '@vela/core';
import { useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { NO_RING, Glyph, useInteraction } from '../common/controls';
import { useHost } from '../../host';
import { headerInsetOf } from '../../resolve/inherit';
import { alpha, Cover, useMediaLook } from '../media/parts';
import { placeOf, useMusic } from './context';
import { LikedCover, MusicLiked, MusicPlaylist, playlistCard, Chip } from './pages';
import { ListeningHome, ListeningTitle } from './spoken';
import { listenedFraction, listeningWords } from './listening';
import { useLibraryItems, useLibraryRows, useLiked, usePlaylists } from './data';
import { MINI_PLAYER_HEIGHT } from '../media/player';
import { compactMusic, musicTV } from './layout';
import { samePlace, type MusicPlace } from './place';
import { FocusGroup, IconButton, Surface, transition } from './parts';
import { BarPanelView, NowPlayingBar, NOW_PLAYING_BAR_HEIGHT, type BarPanel } from './bar';
import { QueuePanel } from './queue';
import { ListeningSearch } from './search';

export function MusicShell({ queueOpen, onQueue }: { queueOpen: boolean; onQueue(open: boolean): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const host = useHost();
  // Below the shell's navigation, wherever this document draws it (overlay or in flow).
  const inset = host.doc.document.traits?.headerInset ?? headerInsetOf(host.doc.document.slots?.shell);
  const [collapsed, setCollapsed] = useState(false);
  const [panel, setPanel] = useState<BarPanel>('');
  const music = app.listening === 'music';
  const narrow = m.width < 1180;
  const rail = collapsed || narrow;
  const page = app.place;
  const top = `calc(${m.small ? inset.small : inset.wide} + 6px)`;
  if (musicTV()) return <TVShell top={top} />;
  if (compactMusic(m)) return <CompactShell top={top} />;
  // Flush to the window: no rounded inset panels and no gaps. The sidebar and the queue sit on
  // the raised tone and a hairline divides each from the page; the bar has a hairline above it.
  const hairline = m.box({ 'background-color': '$ui.glassEdge' });
  const side = (children: ReactNode, width: number, edge: 'left' | 'right') => (
    <View style={[{ width, backgroundColor: m.ui.raised, flexDirection: 'row' }]}>
      {edge === 'left' ? <View style={[{ width: 1 }, hairline]} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
      {edge === 'right' ? <View style={[{ width: 1 }, hairline]} /> : null}
    </View>
  );
  return (
    <View pointerEvents="box-none" style={[{ flex: 1 }, m.box({ 'padding-top': top })]} testID="music-shell">
      <View style={[{ height: 1 }, hairline]} />
      <View style={{ flex: 1, flexDirection: 'row', minHeight: 0 }}>
        {side(<Sidebar rail={rail} onToggle={() => setCollapsed(!collapsed)} />, rail ? 84 : 316, 'right')}
        {flush(
          <ScrollView key={pageKey(page)} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} testID="music-main">
            {page.kind === 'liked' && music ? <MusicLiked />
              : page.kind === 'playlist' ? <MusicPlaylist id={page.id} />
              : page.kind === 'title' ? <ListeningTitle id={page.id} />
              : page.kind === 'search' ? <ListeningSearch />
              : <ListeningHome />}
          </ScrollView>)}
        {queueOpen ? side(<QueuePanel onClose={() => onQueue(false)} />, 340, 'left') : null}
      </View>
      <View style={[{ height: 1 }, hairline]} />
      <View style={{ height: NOW_PLAYING_BAR_HEIGHT, backgroundColor: m.ui.raised }}><NowPlayingBar queueOpen={queueOpen} onQueue={() => onQueue(!queueOpen)} panel={panel} onPanel={setPanel} /></View>
      <BarPanelView panel={panel} onClose={() => setPanel('')} />
    </View>
  );
}

/** Phones and upright tablets: Home, Search and Your Library as chips under the app's
 * navigation, the page full width, and the floating mini player over it. */
function CompactShell({ top }: { top: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const page = app.place;
  const music = app.listening === 'music';
  const queued = useVelaState(state => !!state.audio.queue);
  const tabs: { label: string; place: MusicPlace }[] = [
    { label: msg('music.home'), place: { kind: 'home' } },
    { label: msg('music.search'), place: { kind: 'search' } },
    { label: msg('music.yourLibrary'), place: { kind: 'library' } },
  ];
  return (
    <View pointerEvents="box-none" style={[{ flex: 1 }, m.box({ 'padding-top': top })]} testID="music-shell">
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }} accessibilityRole="tablist">
        {tabs.map(tab => <Chip key={tab.label} label={tab.label} on={samePlace(page, tab.place)} onPress={() => app.go(tab.place)} />)}
      </View>
      <ScrollView key={pageKey(page)} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: queued ? MINI_PLAYER_HEIGHT + 48 : 32 }} testID="music-main">
        {page.kind === 'library' ? <Sidebar rail={false} onToggle={() => undefined} embedded />
          : page.kind === 'liked' && music ? <MusicLiked />
          : page.kind === 'playlist' ? <MusicPlaylist id={page.id} />
          : page.kind === 'title' ? <ListeningTitle id={page.id} />
          : page.kind === 'search' ? <ListeningSearch />
          : <ListeningHome />}
      </ScrollView>
    </View>
  );
}

/** A TV: an icon rail (Home, Search, Your Library and, for music, Liked Songs) beside a full-width page; the
 * focusable mini player floats over it and opens Now Playing. Everything is one focus target at a
 * time; Back walks Now Playing → page → music Home → the app. */
function TVShell({ top }: { top: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const host = useHost();
  const page = app.place;
  const music = app.listening === 'music';
  const queued = useVelaState(state => !!state.audio.queue);
  // The page ends where the mini player begins, which the dock lifts above the bottom safe inset
  // (media/audio.tsx): Apple TV's inset is 60pt, and a fixed margin left the last rows under the bar.
  const dock = MINI_PLAYER_HEIGHT + Math.max(14, host.viewport.insets.bottom + 10) + 14;
  return (
    <View pointerEvents="box-none" style={[{ flex: 1, flexDirection: 'row' }, m.box({ 'padding-top': top })]} testID="music-shell">
      <FocusGroup style={{ width: 96, paddingTop: 24, alignItems: 'center', gap: 10 }}>
        <NavItem symbol="home" label={msg('music.home')} place={{ kind: 'home' }} rail />
        <NavItem symbol="search" label={msg('music.search')} place={{ kind: 'search' }} rail />
        <NavItem symbol="library" label={msg('music.yourLibrary')} place={{ kind: 'library' }} rail />
        {music ? <NavItem symbol="heart-fill" label={msg('music.liked')} place={{ kind: 'liked' }} rail /> : null}
      </FocusGroup>
      {/* The page ends above the floating mini player, so a focused row is never under it. */}
      <ScrollView key={pageKey(page)} style={{ flex: 1, marginBottom: queued ? dock : 0 }} contentContainerStyle={{ paddingBottom: 48, paddingRight: 32 }} testID="music-main">
        {page.kind === 'library' ? <Sidebar rail={false} onToggle={() => undefined} embedded />
          : page.kind === 'liked' && music ? <MusicLiked />
          : page.kind === 'playlist' ? <MusicPlaylist id={page.id} />
          : page.kind === 'title' ? <ListeningTitle id={page.id} />
          : page.kind === 'search' ? <ListeningSearch />
          : <ListeningHome />}
      </ScrollView>
    </View>
  );
}

/** The page column: the rest of the width, straight to the edges. */
function flush(children: ReactNode): ReactNode {
  return <View style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>{children}</View>;
}

function pageKey(place: MusicPlace): string {
  return place.kind === 'title' || place.kind === 'playlist' ? `${place.kind}:${place.id}` : place.kind;
}

type Filter = 'all' | 'playlists' | 'albums' | 'artists';

function Sidebar(props: { rail: boolean; onToggle(): void; embedded?: boolean }) {
  const app = useMusic();
  return app.listening === 'music' ? <MusicSidebar {...props} /> : <SpokenSidebar {...props} />;
}

function MusicSidebar({ rail, onToggle, embedded = false }: { rail: boolean; onToggle(): void; embedded?: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const { playlists } = usePlaylists();
  const liked = useLiked();
  const [filter, setFilter] = useState<Filter>('all');
  // Embedded in a page that scrolls (Your Library on a phone): a plain list.
  const List = (embedded ? View : ScrollView) as typeof ScrollView;
  const entries: { card: Card; subtitle: string }[] = [
    ...(filter === 'all' || filter === 'playlists' ? playlists.map(p => ({ card: playlistCard(p), subtitle: `${msg('music.playlist')} · ${countLabel(p)}` })) : []),
    ...(filter === 'all' || filter === 'albums' ? liked.albums.map(a => ({ card: a, subtitle: `${msg('media.ui.album')} · ${a.media?.byline ?? ''}` })) : []),
    ...(filter === 'all' || filter === 'artists' ? liked.artists.map(a => ({ card: a, subtitle: msg('media.ui.artist') })) : []),
  ];
  return (
    <View style={{ flex: 1 }} testID="music-library" accessibilityLabel={msg('music.yourLibrary')} {...({ role: 'navigation' } as object)}>
      {embedded ? null : <>
        <View style={{ padding: rail ? 12 : 10, gap: 2 }}>
          <NavItem symbol="home" label={msg('music.home')} place={{ kind: 'home' }} rail={rail} />
          <NavItem symbol="search" label={msg('music.search')} place={{ kind: 'search' }} rail={rail} />
        </View>
        <View style={[{ marginHorizontal: 12, height: 1 }, m.box({ 'background-color': '$ui.glassEdge' })]} />
      </>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: rail ? 'center' : 'space-between', paddingHorizontal: rail ? 0 : 16, paddingTop: 14, paddingBottom: 8 }}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={msg('music.yourLibrary')} style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Glyph symbol="library" size={24} color={m.ui.inkSecondary} />
          {!rail ? <Text style={m.text({ 'font-size': '16px', 'font-weight': '750', color: '$ui.inkSecondary' })}>{msg('music.yourLibrary')}</Text> : null}
        </Pressable>
        {!rail ? <IconButton symbol="playlist-add" label={msg('music.newPlaylist')} size={34} iconSize={19} onPress={() => app.drawer({ mode: 'create' })} testID="music-new-playlist" /> : null}
      </View>
      {!rail ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }} accessibilityRole="radiogroup">
          {(['playlists', 'albums', 'artists'] as const).map(f => <Chip key={f} label={msg(`music.${f}`)} on={filter === f} onPress={() => setFilter(filter === f ? 'all' : f)} />)}
        </View>
      ) : null}
      <List style={embedded ? undefined : { flex: 1 }} {...(embedded ? {} : { contentContainerStyle: { paddingHorizontal: 8, paddingBottom: 12 } })}>
        <View style={embedded ? { paddingHorizontal: 8 } : undefined}>
        {filter === 'all' || filter === 'playlists'
          ? <LibraryRow rail={rail} place={{ kind: 'liked' }} title={msg('music.liked')} subtitle={`${msg('music.playlist')} · ${msg(`media.count.tracks.${liked.trackTotal === 1 ? 'one' : 'other'}`, { count: number(liked.trackTotal) })}`} cover={<LikedCover size={48} />} pinned />
          : null}
        {entries.map(({ card, subtitle }) => (
          <LibraryRow key={card.id} rail={rail} place={placeOf(card)} card={card} title={card.name} subtitle={subtitle}
            cover={card.kind === 'playlist' ? <PlaylistThumb playlist={playlists.find(p => p.id === card.id)} /> : <Cover uri={card.poster} shape={card.media?.role === 'artist' ? 'round' : 'square'} size={48} title={card.name} accent={card.accent} lift={0.2} />} />
        ))}
        </View>
      </List>
    </View>
  );
}

/** Your Library for spoken word: the library's books or shows, the viewer's under way first, with
 * In progress, Saved (Following) and Finished as filters. No playlists and no Liked Songs. */
function SpokenSidebar({ rail, onToggle, embedded = false }: { rail: boolean; onToggle(): void; embedded?: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const words = listeningWords(app.listening);
  const { items } = useLibraryItems(app.libraryId);
  const { rows } = useLibraryRows(app.libraryId);
  const [filter, setFilter] = useState('');
  // What is under way: the library's Continue listening, each part or episode as its book or show.
  const resume = rows.find(row => row.purpose === 'continue')?.items ?? [];
  const progress = new Map<string, Card>();
  for (const card of resume) { const place = placeOf(card); const id = place.kind === 'title' ? place.id : card.id; if (!progress.has(id)) progress.set(id, card); }
  const List = (embedded ? View : ScrollView) as typeof ScrollView;
  const ordered = [...items.filter(card => progress.has(card.id)), ...items.filter(card => !progress.has(card.id))];
  const shown = ordered.filter(card => filter === 'progress' ? progress.has(card.id) : filter === 'saved' ? app.liked(card.id) : filter === 'finished' ? card.played : true);
  const subtitle = (card: Card) => {
    const under = progress.get(card.id);
    const left = under && under.durationSeconds ? msg('media.ui.left', { time: durationLabel(Math.max(0, under.durationSeconds - under.progressSeconds)) }) : '';
    return [card.media?.byline ?? '', left || (card.played ? msg('media.ui.finished') : '')].filter(Boolean).join(' · ');
  };
  return (
    <View style={{ flex: 1 }} testID="music-library" accessibilityLabel={msg('music.yourLibrary')} {...({ role: 'navigation' } as object)}>
      {embedded ? null : <>
        <View style={{ padding: rail ? 12 : 10, gap: 2 }}>
          <NavItem symbol="home" label={msg('music.home')} place={{ kind: 'home' }} rail={rail} />
          <NavItem symbol="search" label={msg('music.search')} place={{ kind: 'search' }} rail={rail} />
        </View>
        <View style={[{ marginHorizontal: 12, height: 1 }, m.box({ 'background-color': '$ui.glassEdge' })]} />
      </>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: rail ? 'center' : 'flex-start', paddingHorizontal: rail ? 0 : 16, paddingTop: 14, paddingBottom: 8 }}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityLabel={msg('music.yourLibrary')} style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
          <Glyph symbol="library" size={24} color={m.ui.inkSecondary} />
          {!rail ? <Text style={m.text({ 'font-size': '16px', 'font-weight': '750', color: '$ui.inkSecondary' })}>{msg('music.yourLibrary')}</Text> : null}
        </Pressable>
      </View>
      {!rail ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }} accessibilityRole="radiogroup">
          {words.filters.map(f => <Chip key={f.role} label={msg(f.label)} on={filter === f.role} onPress={() => setFilter(filter === f.role ? '' : f.role)} />)}
        </View>
      ) : null}
      <List style={embedded ? undefined : { flex: 1 }} {...(embedded ? {} : { contentContainerStyle: { paddingHorizontal: 8, paddingBottom: 12 } })}>
        <View style={embedded ? { paddingHorizontal: 8 } : undefined}>
          {shown.map(card => {
            const under = progress.get(card.id);
            return (
              <LibraryRow key={card.id} rail={rail} place={placeOf(card)} card={card} title={card.name} subtitle={subtitle(card)}
                cover={<View><Cover uri={card.poster} shape="square" size={48} title={card.name} accent={card.accent} lift={0.2} />
                  {under ? <View style={{ position: 'absolute', left: 3, right: 3, bottom: 3, height: 3, borderRadius: 2, backgroundColor: alpha('#000000', 0.45), overflow: 'hidden' }}>
                    <View style={{ width: `${Math.round(listenedFraction(under) * 100)}%`, height: 3, backgroundColor: m.ui.accent }} /></View> : null}</View>} />
            );
          })}
          {!shown.length && !rail ? <Text style={[m.text({ 'font-size': '13px', color: '$ui.inkQuiet' }), { padding: 12 }]}>{msg('listening.nothingHere')}</Text> : null}
        </View>
      </List>
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
  const tv = musicTV();
  const { state, handlers } = useInteraction();
  const on = samePlace(app.place, place);
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={() => app.go(place)} accessibilityRole="link" accessibilityState={{ selected: on }} accessibilityLabel={label}
      style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 16, height: tv ? 60 : 44, width: tv ? 60 : undefined, paddingHorizontal: rail ? 0 : 12, justifyContent: rail ? 'center' : 'flex-start', borderRadius: tv ? 30 : 10,
        backgroundColor: tv && state.focus ? m.ui.ink : lit ? m.ui.control : on && tv ? m.ui.control : 'transparent', transform: [{ scale: tv && state.focus ? 1.08 : 1 }] }, transition('background-color, transform', 120)]}>
      <Glyph symbol={symbol} size={tv ? 28 : 24} color={tv && state.focus ? m.ui.inkInverse : on || lit ? m.ui.ink : m.ui.inkSecondary} />
      {!rail ? <Text style={m.text({ 'font-size': '16px', 'font-weight': '700', color: on || lit ? '$ui.ink' : '$ui.inkSecondary' })}>{label}</Text> : null}
    </Pressable>
  );
}

function LibraryRow({ place, card, title, subtitle, cover, rail, pinned = false }: { place: MusicPlace; card?: Card; title: string; subtitle: string; cover: ReactNode; rail: boolean; pinned?: boolean }) {
  const app = useMusic();
  const m = useMediaLook();
  const on = samePlace(app.place, place);
  const tv = musicTV();
  return (
    <Surface onPress={() => app.go(place)} onMenu={card ? (anchor, mode, opener) => app.menu({ card, anchor, mode, opener }) : undefined}
      focusId={card?.id ?? place.kind} selected={on} label={`${title}, ${subtitle}`} testID={`music-library-${card?.id ?? place.kind}`}
      style={(lit, focus) => [{ borderRadius: 8, backgroundColor: on ? alpha(m.ui.ink, 0.1) : lit ? m.ui.control : 'transparent' },
        tv ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent' } : {}, transition('background-color', 120)]}
      contentStyle={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: tv ? 10 : 6, justifyContent: rail ? 'center' : 'flex-start' }}>
      {() => (
        <>
          <View pointerEvents="none">{cover}</View>
          {!rail ? (
            <View pointerEvents="none" style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '20px' : '15px', 'font-weight': '600', color: on ? m.ui.accent : '$ui.ink' })}>{title}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {pinned ? <Glyph symbol="star-fill" size={12} color={m.ui.accent} /> : null}
                <Text numberOfLines={1} style={m.text({ 'font-size': tv ? '16px' : '13px', color: '$ui.inkQuiet' })}>{subtitle}</Text>
              </View>
            </View>
          ) : null}
        </>
      )}
    </Surface>
  );
}
