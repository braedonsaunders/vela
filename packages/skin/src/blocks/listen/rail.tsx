// Your Library (the `rail` block): the music app's sidebar. Home, Search and Rewind; Your Library's
// heading with its collapse control, new playlist and the library tools; filters; and the
// playlists, liked albums and artists (music) or the books and shows under way (spoken word).
// Collapsed it is an icon rail. Embedded (Your Library on a phone or a TV) it is a plain list.
import { useState, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { durationLabel, msg, number, type Card, type PlaylistModel } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { FocusPressable as Pressable } from '../../focus';
import { focusTarget } from '../../escape';
import { NO_RING, Glyph, useInteraction } from '../../widgets/common/controls';
import { alpha, Cover, useMediaLook } from '../../widgets/media/parts';
import { placeOf, useMusic } from './app';
import { listenedFraction, listeningWords } from './listening';
import { useLibraryItems, useLibraryRows, useLiked, usePlaylists } from './data';
import { musicTV } from './layout';
import { samePlace, type MusicPlace } from './place';
import { Chip, FocusGroup, IconButton, LikedCover, playlistCard, Surface, transition } from './parts';

type Filter = 'all' | 'playlists' | 'albums' | 'artists';

/** "Your Library" is a heading, not a button: collapsing the sidebar is its own control beside it
 * (and, collapsed to a rail, the library icon opens it again). Embedded (phone, TV) it never collapses. */
function LibraryHeading({ rail, embedded, onToggle }: { rail: boolean; embedded: boolean; onToggle(): void }) {
  const m = useMediaLook();
  if (rail) return <IconButton symbol="library" label={msg('music.expandLibrary')} onPress={onToggle} size={40} iconSize={24} testID="music-library-expand" />;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {embedded ? null : <IconButton symbol="sidebar" label={msg('music.collapseLibrary')} onPress={onToggle} size={34} iconSize={20} testID="music-library-collapse" />}
      <View accessibilityRole="header" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: embedded ? 0 : 2 }}>
        {embedded ? <Glyph symbol="library" size={24} color={m.ui.inkSecondary} /> : null}
        <Text style={m.text({ 'font-size': '16px', 'font-weight': '750', color: '$ui.inkSecondary' })}>{msg('music.yourLibrary')}</Text>
      </View>
    </View>
  );
}

export function Sidebar(props: { rail: boolean; onToggle(): void; embedded?: boolean }) {
  const app = useMusic();
  return app.listening === 'music' ? <MusicSidebar {...props} /> : <SpokenSidebar {...props} />;
}

function MusicSidebar({ rail, onToggle, embedded = false }: { rail: boolean; onToggle(): void; embedded?: boolean }) {
  const app = useMusic();
  const store = useVela();
  const m = useMediaLook();
  const { playlists } = usePlaylists();
  const liked = useLiked();
  useVelaState(state => state.home.load);
  const recapAvailable = store.music.recapAvailable;
  const importAvailable = store.music.playlistImportAvailable;
  const duplicatesAvailable = store.music.duplicatesAvailable;
  const toolsAvailable = importAvailable || duplicatesAvailable;
  const [filter, setFilter] = useState<Filter>('all');
  const [toolsOpen, setToolsOpen] = useState(false);
  // Embedded in a page that scrolls (Your Library on a phone): a plain list.
  const List = (embedded ? View : ScrollView) as typeof ScrollView;
  const entries: { card: Card; subtitle: string }[] = [
    ...(filter === 'all' || filter === 'playlists' ? playlists.map(p => ({ card: playlistCard(p), subtitle: `${msg('music.playlist')} · ${countLabel(p)}` })) : []),
    ...(filter === 'all' || filter === 'albums' ? liked.albums.map(a => ({ card: a, subtitle: `${msg('media.ui.album')} · ${a.media?.byline ?? ''}` })) : []),
    ...(filter === 'all' || filter === 'artists' ? liked.artists.map(a => ({ card: a, subtitle: msg('media.ui.artist') })) : []),
  ];
  const toolsActive = app.place.kind === 'import' || app.place.kind === 'duplicates';
  return (
    <View style={{ flex: 1 }} testID="music-library" accessibilityLabel={msg('music.yourLibrary')} {...({ role: 'navigation' } as object)}>
      {embedded ? null : <>
        <View style={{ padding: rail ? 12 : 10, gap: 2 }}>
          <NavItem symbol="home" label={msg('music.home')} place={{ kind: 'home' }} rail={rail} />
          <NavItem symbol="search" label={msg('music.search')} place={{ kind: 'search' }} rail={rail} />
          {recapAvailable ? <NavItem symbol="sparkles" label={msg('music.rewind')} place={{ kind: 'rewind' }} rail={rail} testID="music-nav-rewind" /> : null}
        </View>
        <View style={[{ marginHorizontal: 12, height: 1 }, m.box({ 'background-color': '$ui.glassEdge' })]} />
      </>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: rail ? 'center' : 'space-between', paddingHorizontal: rail ? 0 : 16, paddingTop: 14, paddingBottom: 8 }}>
        <LibraryHeading rail={rail} embedded={embedded} onToggle={onToggle} />
        {!rail ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <IconButton symbol="playlist-add" label={msg('music.newPlaylist')} size={34} iconSize={19} onPress={() => app.drawer({ mode: 'create' })} testID="music-new-playlist" />
            {toolsAvailable ? (
              <IconButton
                symbol="sliders"
                label={msg('music.libraryTools')}
                size={34}
                iconSize={17}
                active={toolsOpen || toolsActive}
                onPress={() => setToolsOpen(open => !open)}
                testID="music-library-tools"
              />
            ) : null}
          </View>
        ) : null}
      </View>
      {!rail && toolsAvailable && toolsOpen ? (
        <View
          testID="music-library-tools-menu"
          style={{
            marginHorizontal: 12,
            marginBottom: 10,
            padding: 6,
            borderRadius: 12,
            backgroundColor: alpha(m.ui.ink, 0.06),
            borderWidth: 1,
            borderColor: m.ui.glassEdge,
            gap: 2,
          }}>
          {importAvailable ? (
            <LibraryToolItem
              symbol="playlist-add"
              label={msg('music.import')}
              active={app.place.kind === 'import'}
              testID="music-tools-import"
              onPress={() => {
                setToolsOpen(false);
                app.go({ kind: 'import' });
              }}
            />
          ) : null}
          {duplicatesAvailable ? (
            <LibraryToolItem
              symbol="layers"
              label={msg('music.duplicates.menu')}
              active={app.place.kind === 'duplicates'}
              testID="music-tools-duplicates"
              onPress={() => {
                setToolsOpen(false);
                app.go({ kind: 'duplicates' });
              }}
            />
          ) : null}
        </View>
      ) : null}
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

function LibraryToolItem({
  symbol,
  label,
  active,
  testID,
  onPress,
}: {
  symbol: string;
  label: string;
  active: boolean;
  testID: string;
  onPress(): void;
}) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable
      {...handlers}
      onPress={onPress}
      testID={testID}
      accessibilityRole="menuitem"
      accessibilityLabel={label}
      style={[
        NO_RING,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 8,
          backgroundColor: active ? alpha(m.ui.accent, 0.16) : lit ? m.ui.control : 'transparent',
        },
        transition('background-color', 120),
      ]}>
      <Glyph symbol={symbol} size={17} color={active ? m.ui.accent : lit ? m.ui.ink : m.ui.inkSecondary} />
      <Text style={m.text({ 'font-size': '14px', 'font-weight': '650', color: active ? m.ui.accent : '$ui.ink' })}>{label}</Text>
    </Pressable>
  );
}

/** Your Library for spoken word: the library's books or shows, the viewer's under way first, with
 * In progress, Saved (Following) and Finished as filters. No playlists and no Liked Songs. */
function SpokenSidebar({ rail, onToggle, embedded = false }: { rail: boolean; onToggle(): void; embedded?: boolean }) {
  const app = useMusic();
  const store = useVela();
  const m = useMediaLook();
  const words = listeningWords(app.listening);
  const { items } = useLibraryItems(app.libraryId);
  const { rows } = useLibraryRows(app.libraryId);
  useVelaState(state => state.home.load);
  const recapAvailable = store.music.recapAvailable;
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
          {recapAvailable ? <NavItem symbol="sparkles" label={msg('music.rewind')} place={{ kind: 'rewind' }} rail={rail} testID="music-nav-rewind" /> : null}
        </View>
        <View style={[{ marginHorizontal: 12, height: 1 }, m.box({ 'background-color': '$ui.glassEdge' })]} />
      </>}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: rail ? 'center' : 'flex-start', paddingHorizontal: rail ? 0 : 16, paddingTop: 14, paddingBottom: 8 }}>
        <LibraryHeading rail={rail} embedded={embedded} onToggle={onToggle} />
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

/** Apple TV (tvOS): where the rail's items are named focus targets. */
const APPLE_TV = Platform.isTV && Platform.OS === 'ios';

export function NavItem({ symbol, label, place, rail, testID }: { symbol: string; label: string; place: MusicPlace; rail: boolean; testID?: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const tv = musicTV();
  const { state, handlers } = useInteraction();
  const on = samePlace(app.place, place);
  const lit = state.hover || state.focus;
  // On Apple TV the rail's items are focus targets by name (music-nav-home, …), so a document can
  // name its first focus (the listen shell's focus.initial: Home, as the hand-written shell's
  // focus guide gave it). Android TV's first focus is the app's navigation, so nothing registers
  // there; web and phones are untouched.
  const navId = APPLE_TV ? `music-nav-${place.kind}` : undefined;
  return (
    <Pressable {...handlers} {...(navId ? { ref: focusTarget(navId) as never, nativeID: navId } : {})} onPress={() => app.go(place)} testID={testID} accessibilityRole="link" accessibilityState={{ selected: on }} accessibilityLabel={label}
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

/** A TV's icon rail: Home, Search, Your Library, Rewind and, for music, Liked Songs. */
export function RailIcons() {
  const app = useMusic();
  const store = useVela();
  useVelaState(state => state.home.load);
  const recapAvailable = store.music.recapAvailable;
  const music = app.listening === 'music';
  return (
    <FocusGroup style={{ width: 96, paddingTop: 24, alignItems: 'center', gap: 10 }}>
      <NavItem symbol="home" label={msg('music.home')} place={{ kind: 'home' }} rail />
      <NavItem symbol="search" label={msg('music.search')} place={{ kind: 'search' }} rail />
      <NavItem symbol="library" label={msg('music.yourLibrary')} place={{ kind: 'library' }} rail />
      {recapAvailable ? <NavItem symbol="sparkles" label={msg('music.rewind')} place={{ kind: 'rewind' }} rail /> : null}
      {music ? <NavItem symbol="heart-fill" label={msg('music.liked')} place={{ kind: 'liked' }} rail /> : null}
    </FocusGroup>
  );
}

/** Phones and upright tablets: Home, Search and Your Library (plus Rewind when available) as chips. */
export function RailChips() {
  const app = useMusic();
  const store = useVela();
  useVelaState(state => state.home.load);
  const recapAvailable = store.music.recapAvailable;
  const tabs: { label: string; place: MusicPlace }[] = [
    { label: msg('music.home'), place: { kind: 'home' } },
    { label: msg('music.search'), place: { kind: 'search' } },
    { label: msg('music.yourLibrary'), place: { kind: 'library' } },
    ...(recapAvailable ? [{ label: msg('music.rewind'), place: { kind: 'rewind' as const } }] : []),
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }} accessibilityRole="tablist">
      {tabs.map(tab => <Chip key={tab.label} label={tab.label} on={samePlace(app.place, tab.place)} onPress={() => app.go(tab.place)} />)}
    </ScrollView>
  );
}
