// The audio app's music pages: Home, an album, an artist, a playlist, Liked Songs (spoken word's
// Home, book and show pages are in spoken.tsx, which chooses between the two). Built from the store's ordinary reads; every page
// takes the document's `ui` look and the artwork's colour.
import { Image } from 'expo-image';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type ComponentRef } from 'react';
import { Platform, Text, View } from 'react-native';
import { albumOrder, durationLabel, msg, number, type Card, type Row } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { currentInQueue } from '@vela/core';
import { FocusPressable as Pressable } from '../../focus';
import { useHost } from '../../host';
import { NO_RING, Glyph, useInteraction } from '../common/controls';
import { alpha, Cover, useMediaLook, type MediaLook } from '../media/parts';
import { placeOf, useMusic } from './context';
import { useChildren, useDetailRows, useLibraryRows, useLiked, usePlaylist, usePlaylists, useRecent, useTitle } from './data';
type FacetValue = { id: string; label: string; count: number };
import { Byline, FocusScope, Heart, Icon, IconButton, MusicTile, PlayFab, Shelf, Surface, transition, Wash } from './parts';
import { listeningWords } from './listening';
import { TrackList } from './tracks';
import { compactMusic, musicTV } from './layout';
import { RewindCover } from './rewind';
import { musicHomeRows } from './home-rows';
export { compactMusic };

/** A page's side margin: tighter on a phone. */
export const coverSize = (m: MediaLook) => (compactMusic(m) ? Math.min(240, m.width - 120) : m.width >= 1300 ? 232 : 192);
export const pad = (m: MediaLook) => (m.small ? 16 : 28);

function totalLabel(tracks: Card[]): string {
  const seconds = tracks.reduce((sum, t) => sum + (t.durationSeconds || 0), 0);
  const count = msg(`media.count.tracks.${tracks.length === 1 ? 'one' : 'other'}`, { count: number(tracks.length) });
  return seconds ? `${count}, ${durationLabel(seconds)}` : count;
}

export function usePlayingFrom(id: string): boolean {
  return useVelaState(s => s.audio.queue?.source?.id === id && (s.audio.phase === 'playing' || s.audio.phase === 'buffering' || s.audio.phase === 'loading'));
}

/** The header every collection page shares: cover, eyebrow, the name, a byline. */
export function Header({ cover, eyebrow, title, children }: { cover: ReactNode; eyebrow: string; title: string; children?: ReactNode }) {
  const m = useMediaLook();
  const size = m.small ? (title.length > 24 ? 26 : 34) : title.length > 28 ? 44 : title.length > 16 ? 60 : 84;
  if (compactMusic(m)) return (
    <View style={{ alignItems: 'center', gap: 18, paddingTop: 24, paddingBottom: 6 }}>
      {cover}
      <View style={{ alignSelf: 'stretch', gap: 8 }}>
        <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })}>{eyebrow}</Text>
        <Text numberOfLines={3} accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${size}px`, 'line-height': '1.05', 'letter-spacing': '-0.01em', color: '$ui.ink' })}>{title}</Text>
        {children}
      </View>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 28, paddingTop: 48, paddingBottom: 26 }}>
      {cover}
      <View style={{ flex: 1, minWidth: 0, gap: 10, paddingBottom: 4 }}>
        <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })}>{eyebrow}</Text>
        <Text numberOfLines={2} accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${size}px`, 'line-height': '1.02', 'letter-spacing': '-0.02em', color: '$ui.ink' })}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

export function ActionBar({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 18 }}>{children}</View>;
}

export function MoreButton({ card }: { card: Card }) {
  const app = useMusic();
  const ref = useRef<ComponentRef<typeof View>>(null);
  return (
    <View ref={ref}>
      <IconButton symbol="more" label={msg('cardMenu.actionsFor', { title: card.name })} size={44} iconSize={24}
        onPress={() => ref.current?.measureInWindow((x: number, y: number, width: number, height: number) => app.menu({ card, anchor: { kind: 'card', rect: { left: x, top: y, right: x + width, bottom: y + height } } }))} testID="music-page-more" />
    </View>
  );
}

// ——— Home ————————————————————————————————————————————————————————————————————————

export function greeting(): string {
  const hour = new Date().getHours();
  return msg(hour < 5 ? 'music.greeting.night' : hour < 12 ? 'music.greeting.morning' : hour < 18 ? 'music.greeting.afternoon' : 'music.greeting.evening');
}

export function MusicHome() {
  const app = useMusic();
  const store = useVela();
  const m = useMediaLook();
  const { rows } = useLibraryRows(app.libraryId);
  const { playlists, liked } = usePlaylists();
  const likedTotal = useLiked().trackTotal;
  const recent = useRecent();
  // The page's own rows of play contexts (Jump back in) and liked music replace Vela's.
  const { ownRecent, ownLiked, jump, shelves } = musicHomeRows(rows, recent.available);
  useVelaState(s => s.home.load);
  const recapAvailable = store.music.recapAvailable;
  const [quickWidth, setQuickWidth] = useState(0);
  const recentCards = ownRecent ? [] : recent.items.flatMap(item => (item.kind === 'favorites' ? [] : [item.card]));
  const likedRecently = recent.items.some(item => item.kind === 'favorites');
  // Quick tiles: what you played from most recently (Liked Songs and Rewind among it), then your playlists.
  const seen = new Set<string>();
  const quick: (Card | 'liked' | 'rewind')[] = [
    ...(!ownLiked && (liked || likedRecently) ? ['liked' as const] : []),
    ...(recapAvailable ? ['rewind' as const] : []),
    ...recentCards,
    ...playlists.map(playlistCard),
    ...jump,
  ].filter(item => (item === 'liked' || item === 'rewind' ? true : !seen.has(item.id) && !!seen.add(item.id))).slice(0, 8);
  const firstCard = quick.find((x): x is Card => typeof x === 'object');
  const accent = firstCard?.accent ?? '';
  return (
    <View>
      <Wash accent={accent} height={360} />
      <View style={{ paddingHorizontal: m.small ? 16 : 20, paddingTop: m.small ? 16 : 28 }}>
        <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '30px' : '38px', color: '$ui.ink', 'letter-spacing': '-0.01em' }), { marginBottom: m.small ? 14 : 20 }]}>{greeting()}</Text>
        <FocusScope.Provider value="quick"><QuickColumns.Provider value={quickColumns(quickWidth || m.width)}><View onLayout={e => setQuickWidth(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.small ? 8 : 10, marginBottom: m.small ? 24 : 36 }} testID="music-quick">
          {quick.map(item => item === 'liked'
            ? <QuickTile key="liked" title={msg('music.liked')} subtitle={msg(`media.count.tracks.${likedTotal === 1 ? 'one' : 'other'}`, { count: number(likedTotal) })} cover={<LikedCover size={musicTV() ? 72 : m.small ? 52 : 64} />} onPress={() => app.go({ kind: 'liked' })} />
            : item === 'rewind'
              ? <QuickTile key="rewind" focusKey="rewind" title={msg('music.rewind')} subtitle={msg('music.rewind.eyebrow')} cover={<RewindCover size={musicTV() ? 72 : m.small ? 52 : 64} />} onPress={() => app.go({ kind: 'rewind' })} />
              : <QuickTile key={item.id} card={item} title={item.name} cover={<Cover uri={item.poster} shape="square" size={musicTV() ? 72 : m.small ? 52 : 64} title={item.name} accent={item.accent} lift={0.2} />} onPress={() => app.go(placeOf(item))} />)}
        </View></QuickColumns.Provider></FocusScope.Provider>
      </View>
      <View style={{ paddingHorizontal: m.small ? 4 : 8 }}>
        {recentCards.length ? <Shelf title={msg('music.recentlyPlayed')}>{recentCards.map(card => <MusicTile key={card.id} card={card} size={176} subtitle={card.kind === 'playlist' ? msg('music.playlist') : undefined} />)}</Shelf> : null}
        {jump.length ? <Shelf title={msg('music.jumpBackIn')}>{jump.map(card => <MusicTile key={card.id} card={card} size={176} />)}</Shelf> : null}
        {shelves.map(row => <RowShelf key={row.id} row={row} />)}
        <Genres />
      </View>
    </View>
  );
}

function RowShelf({ row }: { row: Row }) {
  const m = useMediaLook();
  // layout tracks: track leaves (each with a duration and an album or artist parent) as a track list.
  if (row.layout === 'tracks') return <View style={{ paddingHorizontal: 12, marginBottom: 28 }} testID={`music-row-tracks-${row.id}`}>
    <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '22px' : '26px', color: '$ui.ink', 'letter-spacing': '-0.01em' }), { marginBottom: 8 }]}>{row.name}</Text>
    <TrackList tracks={row.items} options={{ covers: true, album: true, position: true, source: { id: row.id, name: row.name } }} />
  </View>;
  const tracks = row.items.every(item => item.media?.role === 'track');
  // A row of songs shows each song's album once (Recently played reads as albums you came back to).
  const items = tracks ? dedupeAlbums(row.items) : row.items;
  return <Shelf title={row.name}>{items.map(card => <MusicTile key={card.id} card={card} size={176} subtitle={tracks ? card.media?.byline : undefined} />)}</Shelf>;
}

function dedupeAlbums(items: Card[]): Card[] {
  const seen = new Set<string>();
  return items.filter(item => { const album = item.media?.parent?.id ?? item.id; if (seen.has(album)) return false; seen.add(album); return true; });
}

export function playlistCard(p: { id: string; name: string; poster: string; itemCount: number }): Card {
  return { id: p.id, kind: 'playlist', name: p.name, poster: p.poster, backdrop: '', accent: '', receipt: '', yearLabel: '', summary: '', genres: [], durationSeconds: 0, progressSeconds: 0, played: false } as unknown as Card;
}

/** How many quick tiles fit a row of the page's measured width. */
const QuickColumns = createContext(2);
function quickColumns(width: number): number {
  return musicTV() ? 4 : width >= 940 ? 4 : width >= 600 ? 3 : 2;
}

function QuickTile({ card, focusKey, title, subtitle, cover, onPress }: { card?: Card; focusKey?: string; title: string; subtitle?: string; cover: ReactNode; onPress(): void }) {
  const app = useMusic();
  const m = useMediaLook();
  const columns = useContext(QuickColumns);
  // A percentage every platform lays out (native has no calc()): the gaps take the rest.
  const width = `${100 / columns - (columns === 4 ? 1.2 : columns === 3 ? 1.4 : 1.6)}%`;
  const tv = musicTV();
  return (
    <Surface onPress={onPress} onMenu={card ? (anchor, mode, opener) => app.menu({ card, anchor, mode, opener }) : undefined} focusId={card?.id ?? focusKey ?? 'liked'} label={title}
      style={(lit, focus) => [{ width: width as never, height: tv ? 76 : m.small ? 52 : 64, borderRadius: tv ? 12 : 8, overflow: 'hidden', backgroundColor: lit ? m.ui.controlHover : alpha(m.ui.ink, 0.07) },
        tv ? { borderWidth: 2, borderColor: focus ? m.ui.ink : 'transparent', transform: [{ scale: focus ? 1.03 : 1 }] } : {}, transition('background-color, transform', 140)]}
      contentStyle={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: m.small ? 10 : 14, paddingRight: m.small ? 8 : 12 }}>
      {lit => (
        <>
          <View pointerEvents="none">{cover}</View>
          <View pointerEvents="none" style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={m.text({ 'font-size': musicTV() ? '19px' : m.small ? '13px' : '15px', 'font-weight': '700', color: '$ui.ink' })}>{title}</Text>
            {subtitle ? <Text numberOfLines={1} style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet' })}>{subtitle}</Text> : null}
          </View>
          {m.small || musicTV() ? null : <View pointerEvents={lit ? 'auto' : 'none'} style={[{ position: 'absolute', right: 10, opacity: lit ? 1 : 0 }, transition('opacity', 160)]}>
            <PlayFab playing={false} size={38} onPress={card ? () => app.playCard(card) : onPress} />
          </View>}
        </>
      )}
    </Surface>
  );
}

/** Genres as tiles, each in a colour of its own drawn from the document's accent. */
export function Genres() {
  const app = useMusic();
  const store = useVela();
  const m = useMediaLook();
  const [genres, setGenres] = useState<FacetValue[]>([]);
  useEffect(() => {
    let live = true;
    void store.catalogue.libraryFacets(app.libraryId, 'genres').then(page => { if (live) setGenres(page.items.slice(0, 12)); }).catch(() => undefined);
    return () => { live = false; };
  }, [store, app.libraryId]);
  if (!genres.length) return null;
  const hues = [12, 200, 280, 140, 330, 40, 170, 230, 300, 90, 0, 260];
  return (
    <View style={{ paddingHorizontal: m.small ? 8 : 12, marginBottom: 32 }}>
      <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' }), { marginBottom: 14 }]}>{msg('music.browseGenres')}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: m.small ? 10 : 14 }}>
        {genres.map((g, i) => (
          <View key={g.id} style={[{ width: m.small ? (m.width - 48) / 2 : 196, height: m.small ? 96 : 112, borderRadius: Number(m.ui.radiusCard) || 12, padding: 14, overflow: 'hidden' },
            m.box({ 'background-image': `linear-gradient(135deg, hsl(${hues[i % hues.length]} 46% 38%) 0%, hsl(${(hues[i % hues.length]! + 34) % 360} 52% 22%) 100%)` })]}>
            <Text style={m.text({ 'font-size': '19px', 'font-weight': '750', color: '#ffffff' })}>{g.label}</Text>
            <Text style={m.text({ 'font-size': '12px', color: 'rgba(255,255,255,0.72)' })}>{msg(listeningWords(app.listening).genreCount, { count: number(g.count) })}</Text>
            <View style={{ position: 'absolute', right: -14, bottom: -18, transform: [{ rotate: '22deg' }], opacity: 0.22 }}><Icon name={app.listening === 'music' ? 'album' : 'headphones'} size={86} color="#ffffff" /></View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ——— Album ————————————————————————————————————————————————————————————————————————

export function MusicTitle({ id }: { id: string }) {
  const detail = useTitle(id);
  const card = detail?.value?.title[0];
  const m = useMediaLook();
  if (!card) return <View style={{ padding: 40 }}><Text style={m.text({ color: '$ui.inkQuiet' })}>{detail?.load === 'failed' ? msg('media.ui.loadFailed') : ''}</Text></View>;
  if (card.media?.role === 'artist') return <ArtistView card={card} />;
  return <AlbumView card={card} />;
}

function AlbumView({ card }: { card: Card }) {
  const app = useMusic();
  const m = useMediaLook();
  const children = useChildren(card.id);
  const tracks = useMemo(() => albumOrder(children?.value?.items ?? []), [children?.value]);
  const playing = usePlayingFrom(card.id);
  const source = { id: card.id, name: card.name, kind: 'title' as const };
  const artist = card.media?.parents.find(p => p.role === 'artist');
  const kind = (card.media?.childCount ?? tracks.length) <= 3 ? msg('music.single') : (card.media?.childCount ?? tracks.length) <= 6 ? msg('music.ep') : msg('media.ui.album');
  return (
    <View>
      <Wash accent={card.accent} image={card.poster} />
      <View style={{ paddingHorizontal: pad(m) }}>
        <Header eyebrow={kind} title={card.name} cover={<Cover uri={card.poster} shape="square" size={coverSize(m)} title={card.name} accent={card.accent} lift={2} />}>
          <Byline card={card} facts={[card.yearLabel, tracks.length ? totalLabel(tracks) : '']} />
        </Header>
        <ActionBar>
          <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : app.play(tracks, 0, source))} testID="music-play" opensPage />
          <IconButton symbol="shuffle" label={msg('media.ui.shuffle')} size={44} iconSize={24} onPress={() => app.play(tracks, 0, source, true)} />
          <Heart card={card} size={44} iconSize={26} />
          <MoreButton card={card} />
        </ActionBar>
        <TrackList tracks={tracks} options={{ source }} />
        <View style={{ paddingVertical: 28, gap: 4 }}>
          {card.airDate ? <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{new Date(card.airDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</Text> : null}
          {card.media?.facts.filter(f => f.label === 'Label').map(f => <Text key={f.label} style={m.text({ 'font-size': '12px', color: '$ui.inkQuiet' })}>© {f.value}</Text>)}
        </View>
      </View>
      {artist ? <MoreBy artistId={artist.id} name={artist.name} exclude={card.id} /> : null}
    </View>
  );
}

function MoreBy({ artistId, name, exclude }: { artistId: string; name: string; exclude: string }) {
  const children = useChildren(artistId);
  const albums = (children?.value?.items ?? []).filter(item => item.id !== exclude && item.media?.role === 'album').slice(0, 12);
  if (!albums.length) return null;
  return <View style={{ paddingHorizontal: 16 }}><Shelf title={msg('music.moreBy', { name })}>{albums.map(a => <MusicTile key={a.id} card={a} size={168} subtitle={a.yearLabel} />)}</Shelf></View>;
}

// ——— Artist ———————————————————————————————————————————————————————————————————————

function ArtistView({ card }: { card: Card }) {
  const app = useMusic();
  const m = useMediaLook();
  const host = useHost();
  const children = useChildren(card.id);
  const rows = useDetailRows(card.id);
  const top = rows.find(r => r.id.endsWith(':top'))?.items ?? [];
  const related = rows.find(r => r.id.endsWith(':related'));
  const similar = (related?.items ?? []).filter(a => a.media?.role === 'artist').slice(0, 20);
  const [more, setMore] = useState(false);
  const albums = (children?.value?.items ?? []).filter(i => i.media?.role === 'album');
  // S0: release type by length until the plugin's releaseType reaches the wire (plan §2.6).
  const full = albums.filter(a => (a.media?.childCount ?? 0) > 6);
  const short = albums.filter(a => (a.media?.childCount ?? 0) <= 6);
  const [section, setSection] = useState<'albums' | 'singles'>('albums');
  const shown = section === 'albums' && full.length ? full : short.length ? short : full;
  const liked = useLiked().tracks.filter(t => t.media?.byline === card.name);
  const playing = usePlayingFrom(card.id);
  const source = { id: card.id, name: card.name, kind: 'title' as const };
  const art = card.backdrop || card.poster;
  const following = app.liked(card.id);
  return (
    <View>
      <View style={{ height: m.small ? 300 : 360, overflow: 'hidden', justifyContent: 'flex-end' }}>
        {art ? <Image source={host.image(art)} contentFit="cover" contentPosition="top" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as never} /> : null}
        <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, m.box({ 'background-image': `linear-gradient(180deg, ${alpha(m.ui.page, 0)} 30%, ${alpha(card.accent || m.ui.page, 0.35)} 70%, ${m.ui.page} 100%)` })]} />
        <View style={{ paddingHorizontal: pad(m), paddingBottom: 22 }}>
          <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })}>{msg('media.ui.artist')}</Text>
          <Text accessibilityRole="header" numberOfLines={1} style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? (card.name.length > 14 ? '40px' : '54px') : card.name.length > 18 ? '64px' : '96px', 'line-height': '1', 'letter-spacing': '-0.03em', color: '$ui.ink' })}>{card.name}</Text>
          <Text style={[m.text({ 'font-size': '15px', color: '$ui.inkSecondary' }), { marginTop: 10 }]}>{[albums.length ? msg('music.releasesCount', { count: number(albums.length) }) : '', card.genres.slice(0, 2).join(', ')].filter(Boolean).join(' · ')}</Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: pad(m) }}>
        <ActionBar>
          <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : app.play(top, 0, source))} testID="music-play" opensPage />
          <IconButton symbol="shuffle" label={msg('media.ui.shuffle')} size={44} iconSize={24} onPress={() => app.play(top, 0, source, true)} />
          <FollowButton on={following} onPress={() => app.like(card, !following)} />
          <MoreButton card={card} />
        </ActionBar>
        <View style={m.small ? { gap: 28 } : { flexDirection: 'row', gap: 40, flexWrap: 'wrap' }}>
          <View style={m.small ? { alignSelf: 'stretch' } : { flex: 2, minWidth: 520 }}>
            <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' }), { marginBottom: 10 }]}>{msg('music.popular')}</Text>
            <TrackList tracks={top.slice(0, more ? 10 : 5)} options={{ covers: true, position: true, source }} />
            {top.length > 5 ? (
              <Pressable onPress={() => setMore(!more)} accessibilityRole="button" style={[NO_RING, { paddingHorizontal: 16, paddingVertical: 12 }]}>
                <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.inkSecondary' })}>{more ? msg('music.showLess') : msg('music.seeMore')}</Text>
              </Pressable>
            ) : null}
          </View>
          {liked.length ? (
            <View style={m.small ? { alignSelf: 'stretch' } : { flex: 1, minWidth: 260, maxWidth: 380 }}>
              <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' }), { marginBottom: 14 }]}>{msg('music.likedSongs')}</Text>
              <Pressable onPress={() => app.go({ kind: 'liked' })} accessibilityRole="link" style={[NO_RING, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                <View><Cover uri={card.poster} shape="round" size={72} title={card.name} accent={card.accent} />
                  <View style={{ position: 'absolute', right: -4, bottom: -2, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: m.ui.accent }}><Glyph symbol="heart-fill" size={15} color={m.ui.onAccent} /></View></View>
                <View style={{ flex: 1 }}>
                  <Text style={m.text({ 'font-size': '15px', 'font-weight': '700', color: '$ui.ink' })}>{msg('music.youLiked', { count: number(liked.length) })}</Text>
                  <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('music.byArtist', { name: card.name })}</Text>
                </View>
              </Pressable>
            </View>
          ) : null}
        </View>
        <View style={{ marginTop: 34 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' }), { marginRight: 12 }]}>{msg('music.discography')}</Text>
            {full.length ? <Chip label={msg('music.albums')} on={section === 'albums'} onPress={() => setSection('albums')} /> : null}
            {short.length ? <Chip label={msg('music.singlesEps')} on={section === 'singles' || !full.length} onPress={() => setSection('singles')} /> : null}
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: 16 }}>
        <Shelf title="">{shown.map(a => <MusicTile key={a.id} card={a} size={168} subtitle={[a.yearLabel, (a.media?.childCount ?? 0) <= 3 ? msg('music.single') : (a.media?.childCount ?? 0) <= 6 ? msg('music.ep') : msg('media.ui.album')].filter(Boolean).join(' · ')} />)}</Shelf>
      </View>
      {similar.length ? (
        <View style={{ paddingHorizontal: m.small ? 4 : 16 }}>
          <Shelf title={related?.name || msg('music.fansAlsoLike')}>{similar.map(a => <MusicTile key={a.id} card={a} size={168} />)}</Shelf>
        </View>
      ) : null}
      {card.summary ? (
        <View style={{ paddingHorizontal: pad(m), paddingBottom: 40, maxWidth: 860 }}>
          <Text accessibilityRole="header" style={[m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '26px', color: '$ui.ink' }), { marginBottom: 10 }]}>{msg('music.about')}</Text>
          <Text style={m.text({ 'font-size': '15px', 'line-height': '1.6', color: '$ui.inkSecondary' })}>{card.summary}</Text>
        </View>
      ) : null}
    </View>
  );
}

function FollowButton({ on, onPress }: { on: boolean; onPress(): void }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} testID="music-follow"
      style={[NO_RING, { height: 34, paddingHorizontal: 16, borderRadius: 17, justifyContent: 'center', borderWidth: 1, borderColor: lit ? m.ui.ink : alpha(m.ui.ink, 0.45), transform: [{ scale: lit ? 1.04 : 1 }] }, transition('transform, border-color', 140)]}>
      <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.ink' })}>{on ? msg('music.following') : msg('cardMenu.follow')}</Text>
    </Pressable>
  );
}

export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress(): void }) {
  const m = useMediaLook();
  const { state, handlers } = useInteraction();
  const lit = state.hover || state.focus;
  return (
    <Pressable {...handlers} onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: on }}
      style={[NO_RING, { height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? m.ui.ink : lit ? m.ui.controlHover : m.ui.control,
        // A hairline keeps an unchosen chip visible where the control tone is the surface's own (a light document's white).
        borderWidth: 1, borderColor: on ? m.ui.ink : m.ui.glassEdge }, transition('background-color', 120)]}>
      <Text style={m.text({ 'font-size': '13px', 'font-weight': '650', color: on ? m.ui.inkInverse : m.ui.ink })}>{label}</Text>
    </Pressable>
  );
}

// ——— Playlists and Liked Songs ————————————————————————————————————————————————————

/** A playlist's cover: its own art, else the first four distinct album covers as a 2×2 mosaic. */
export function Mosaic({ tracks, size, poster }: { tracks: Card[]; size: number; poster?: string }) {
  const host = useHost();
  const m = useMediaLook();
  const covers = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const t of tracks) { const k = t.media?.parent?.id ?? t.poster; if (t.poster && !seen.has(k)) { seen.add(k); out.push(t.poster); } if (out.length === 4) break; }
    return out;
  }, [tracks]);
  const frame = { width: size, height: size, borderRadius: 6, overflow: 'hidden' as const, backgroundColor: m.ui.control };
  if (covers.length < 4) return <View style={[frame, m.box({ 'box-shadow': '0px 22px 48px -16px rgba(0,0,0,0.7)' })]}>{covers[0] || poster ? <Image source={host.image(covers[0] || poster!)} style={{ width: size, height: size }} /> : <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Glyph symbol="list" size={size / 3} color={m.ui.inkQuiet} /></View>}</View>;
  return (
    <View style={[frame, { flexDirection: 'row', flexWrap: 'wrap' }, m.box({ 'box-shadow': '0px 22px 48px -16px rgba(0,0,0,0.7)' })]}>
      {covers.map(c => <Image key={c} source={host.image(c)} style={{ width: size / 2, height: size / 2 }} />)}
    </View>
  );
}

export function LikedCover({ size }: { size: number }) {
  const m = useMediaLook();
  return (
    <View style={[{ width: size, height: size, borderRadius: size > 100 ? 6 : 4, alignItems: 'center', justifyContent: 'center' },
      m.box({ 'background-image': `linear-gradient(140deg, ${m.ui.accent} 0%, ${alpha(m.ui.accent, 0.55)} 45%, #3b2a6b 100%)`, ...(size > 100 ? { 'box-shadow': '0px 22px 48px -16px rgba(0,0,0,0.7)' } : {}) })]}>
      <Glyph symbol="heart-fill" size={size * 0.38} color="#ffffff" />
    </View>
  );
}

export function MusicPlaylist({ id }: { id: string }) {
  const app = useMusic();
  const m = useMediaLook();
  const list = usePlaylist(id);
  const meta = usePlaylists().playlists.find(p => p.id === id);
  const viewer = useVelaState(s => s.auth.viewer);
  const tracks = useMemo(() => (list?.value?.items ?? []).filter(i => i.media?.audio), [list?.value]);
  const entryIds = useMemo(() => (list?.value?.items ?? []).filter(i => i.media?.audio).map(i => (i as Card & { entryId?: string }).entryId ?? ''), [list?.value]);
  const name = list?.value?.name ?? meta?.name ?? '';
  const playing = usePlayingFrom(id);
  const source = { id, name, kind: 'playlist' as const };
  const accent = tracks[0]?.accent ?? '';
  return (
    <View>
      <Wash accent={accent} image={tracks[0]?.poster} />
      <View style={{ paddingHorizontal: pad(m) }}>
        <Header eyebrow={msg('music.playlist')} title={name} cover={<Mosaic tracks={tracks} size={coverSize(m)} poster={meta?.poster} />}>
          {list?.value?.summary ? <Text numberOfLines={2} style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{list.value.summary}</Text> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: m.ui.accent, alignItems: 'center', justifyContent: 'center' }}><Text style={m.text({ 'font-size': '12px', 'font-weight': '800', color: m.ui.onAccent })}>{viewer.slice(0, 1).toUpperCase()}</Text></View>
            <Text style={m.text({ 'font-size': '15px', 'font-weight': '700', color: '$ui.ink' })}>{viewer}</Text>
            <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>· {totalLabel(tracks)}</Text>
          </View>
        </Header>
        <ActionBar>
          <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : app.play(tracks, 0, source))} testID="music-play" opensPage />
          <IconButton symbol="shuffle" label={msg('media.ui.shuffle')} size={44} iconSize={24} onPress={() => app.play(tracks, 0, source, true)} />
          <IconButton symbol="more" label={msg('music.editDetails')} size={44} iconSize={24} testID="music-playlist-edit"
            onPress={() => app.drawer({ mode: 'edit', id, name, summary: list?.value?.summary ?? '' })} />
        </ActionBar>
        <TrackList tracks={tracks} options={{ covers: true, album: true, position: true, source, playlist: { id, entryIds } }} />
        <View style={{ height: 40 }} />
      </View>
    </View>
  );
}

export function MusicLiked() {
  const app = useMusic();
  const m = useMediaLook();
  const liked = useLiked();
  const { tracks } = liked;
  const viewer = useVelaState(s => s.auth.viewer);
  // Recently played's context for Liked Songs is the liked list of tracks.
  const id = 'track';
  const playing = usePlayingFrom(id);
  const source = { id, name: msg('music.liked'), kind: 'favorites' as const };
  return (
    <View>
      <Wash accent={m.ui.accent} height={460} />
      <View style={{ paddingHorizontal: pad(m) }}>
        <Header eyebrow={msg('music.playlist')} title={msg('music.liked')} cover={<LikedCover size={coverSize(m)} />}>
          <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}><Text style={m.text({ 'font-weight': '700', color: '$ui.ink' })}>{viewer}</Text> · {liked.moreTracks ? msg(`media.count.tracks.other`, { count: number(liked.trackTotal) }) : totalLabel(tracks)}</Text>
        </Header>
        <ActionBar>
          <PlayFab playing={playing} size={58} onPress={() => (playing ? app.toggle() : app.play(tracks, 0, source))} testID="music-play" opensPage />
          <IconButton symbol="shuffle" label={msg('media.ui.shuffle')} size={44} iconSize={24} onPress={() => app.play(tracks, 0, source, true)} />
        </ActionBar>
        <TrackList tracks={tracks} options={{ covers: true, album: true, position: true, source }} />
        {liked.moreTracks ? (
          <Pressable onPress={liked.loadMoreTracks} accessibilityRole="button" style={[NO_RING, { alignSelf: 'center', paddingHorizontal: 18, paddingVertical: 12 }]} testID="music-liked-more">
            <Text style={m.text({ 'font-size': '14px', 'font-weight': '700', color: '$ui.inkSecondary' })}>{msg('music.seeMore')}</Text>
          </Pressable>
        ) : null}
        <View style={{ height: 40 }} />
      </View>
    </View>
  );
}
