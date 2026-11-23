// Purpose-built pages for media titles (docs/media-kinds.md): an album with its tracklist, an
// artist with songs and albums, a book with its cover, author, series and reading progress, a
// series of books, an audiobook with chapters or parts, a podcast with its episodes, a photo. A
// track opens its album, a part its audiobook and a podcast episode its show. The app draws one of
// these in place of the document's title page; each takes the document's `ui` look.
import { Image } from 'expo-image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, ScrollView, Text, View, type ViewStyle } from 'react-native';
import { childrenKey, childSectionLabel, childSections, childSectionsWait, settledPluginLevels, clock, durationLabel, localeContext, msg, number, opensMediaPage, percent, plural, podcastOrder, type Card, type ChildrenModel, type DetailModel, type Loadable, type MediaCredit } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { useHost } from '../../host';
import { useMediaActions, type MediaActions } from './context';
import { alpha, Cover, CoverTile, ListRow, PillButton, Progress, RoundButton, SectionHeading, Segmented, TextLink, TileGrid, useMediaLook, VideoTile, type MediaLook } from './parts';
import { seriesCanStart, seriesCopy, seriesKind, seriesOrder, seriesStart } from './series';

/** The card kinds this page draws (core's opensMediaPage); anything else, a video show among
 * them, stays with the document's title page. */
export function isMediaPageRole(kind: string): boolean {
  return opensMediaPage(kind);
}

/** `framed`: drawn inside the document's title frame (the `mediaPage` widget), which brings the
 * scrim, the opening motion and the close control; otherwise a page of its own. */
export function MediaTitlePage({ id, framed = false, marked = '' }: { id: string; framed?: boolean; marked?: string }) {
  const detail = useDetail(id);
  const card = detail.value?.title[0];
  const role = card?.media?.role ?? '';
  const cls = card?.media?.class ?? '';
  const parent = card?.media?.parent;
  // A track opens its album, a part its audiobook, a podcast episode its show, with the item marked.
  if ((role === 'track' || role === 'part' || card?.kind === 'podcastEpisode') && parent) return <MediaTitlePage key={parent.id} id={parent.id} framed={framed} marked={id} />;
  return (
    <Frame framed={framed} accent={card?.accent ?? ''} backdrop={card ? (role === 'artist' && card.backdrop !== card.poster ? card.backdrop : card.poster) : ''} wideArt={role === 'artist' && !!card && card.backdrop !== card.poster}>
      {!card ? <Pending load={detail} id={id} />
        : cls === 'photo' ? <PhotoPage card={card} />
        : cls === 'podcast' ? <PodcastPage card={card} marked={marked} />
        : role === 'album' ? <AlbumPage card={card} detail={detail.value!} />
        : role === 'artist' ? <ArtistPage card={card} />
        : role === 'book' ? <BookPage card={card} />
        : role === 'series' ? <SeriesPage card={card} />
        : <AudiobookPage card={card} detail={detail.value!} />}
    </Frame>
  );
}

function useDetail(id: string): Loadable<DetailModel> {
  const store = useVela();
  const detail = useVelaState(state => state.titles[id]);
  useEffect(() => { if (id) void store.catalogue.title(id); }, [store, id]);
  return detail ?? { load: 'loading', error: '' };
}

/** `role`: one child level's children (features.pluginLevels.childRoles), an artist's concerts. */
function useChildren(id: string | undefined, role?: string): Loadable<ChildrenModel> | undefined {
  const store = useVela();
  const children = useVelaState(state => id ? state.children[childrenKey(id, role)] : undefined);
  useEffect(() => { if (id) void store.media.children(id, false, role); }, [store, id, role]);
  return children;
}

/** The page: its colour wash from the cover, a blurred cover behind the hero, the back control.
 * Framed, the document's title frame is the page: the wash and the content scroll in its region
 * and the frame's own close control closes it. */
function Frame({ framed, accent, backdrop, wideArt, children }: { framed: boolean; accent: string; backdrop: string; wideArt: boolean; children: ReactNode }) {
  const host = useHost();
  const m = useMediaLook();
  const actions = useMediaActions();
  const tint = accent || m.ui.accent;
  const top = m.tv ? 32 : Math.max(16, host.viewport.insets.top + 12);
  const wash = (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: wideArt ? Math.min(640, m.height * 0.8) : 620, overflow: 'hidden' }}>
      {backdrop ? <Image source={host.image(backdrop)} contentFit="cover" blurRadius={wideArt ? 0 : 70} transition={framed ? 240 : 0}
        style={{ position: 'absolute', top: wideArt ? 0 : -80, left: wideArt ? 0 : -80, right: wideArt ? 0 : -80, bottom: 0, opacity: wideArt ? 0.6 : 0.42 } as never} /> : null}
      <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
        m.box({ 'background-image': `linear-gradient(180deg, ${alpha(tint, 0.34)} 0%, ${alpha(m.ui.page, 0.55)} 55%, ${m.ui.page} 100%)` })]} />
    </View>
  );
  if (framed) return (
    // A phone's frame is full-bleed under the shell's bar, its close control at the region's top.
    <View testID="media-page" style={{ position: 'relative' }}>
      {wash}
      <View testID="media-scroll" style={{ paddingTop: m.tv ? 72 : m.small ? host.viewport.insets.top + 56 + 72 : 72, paddingBottom: 24, paddingHorizontal: m.gutter, maxWidth: 1360, width: '100%', alignSelf: 'center' } as ViewStyle}>{children}</View>
    </View>
  );
  return (
    <View style={{ flex: 1, backgroundColor: m.ui.page }} testID="media-page">
      {wash}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: top + 56, paddingBottom: 140 }} testID="media-scroll">
        <View style={{ paddingHorizontal: m.gutter, maxWidth: 1360, width: '100%', alignSelf: 'center' } as ViewStyle}>{children}</View>
      </ScrollView>
      <View style={{ position: 'absolute', top, left: m.gutter - 6 }}>
        <RoundButton icon="back" label={msg('media.ui.back')} onPress={actions.back} nativeID="detail-close" testID="detail-close" size={42} />
      </View>
    </View>
  );
}

function Pending({ load, id }: { load: Loadable<DetailModel>; id: string }) {
  const m = useMediaLook();
  const store = useVela();
  if (load.load === 'failed') return (
    <View style={{ paddingVertical: 80, gap: 18, alignItems: 'flex-start' }} accessibilityRole="alert">
      <Text style={m.text({ 'font-size': '18px' })}>{msg('media.ui.loadFailed')}</Text>
      <PillButton label={msg('media.ui.retry')} onPress={() => void store.catalogue.title(id, true)} />
    </View>
  );
  const size = heroCover(m);
  return (
    <View style={{ flexDirection: m.small ? 'column' : 'row', gap: 32, opacity: 0.7 }} accessibilityLabel="Loading" accessibilityRole="progressbar">
      <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: m.ui.skeleton }} />
      <View style={{ flex: 1, gap: 14, justifyContent: 'flex-end' }}>
        {[0.2, 0.6, 0.35].map((w, i) => <View key={i} style={{ width: `${w * 100}%`, height: i === 1 ? 44 : 14, borderRadius: 8, backgroundColor: m.ui.skeletonLight }} />)}
      </View>
    </View>
  );
}

function heroCover(m: MediaLook): number {
  return m.small ? Math.min(300, m.width - m.gutter * 2 - 40) : m.wide ? 320 : 260;
}

/** Cover beside the title block on wide screens, above it on phones. */
function Hero({ cover, children }: { cover: ReactNode; children: ReactNode }) {
  const m = useMediaLook();
  return (
    <View style={{ flexDirection: m.small ? 'column' : 'row', alignItems: m.small ? 'center' : 'flex-end', gap: m.small ? 24 : 44, marginBottom: m.small ? 32 : 48 }}>
      {cover}
      <View style={{ flex: m.small ? undefined : 1, alignSelf: 'stretch', justifyContent: 'flex-end', gap: 12, minWidth: 0 }}>{children}</View>
    </View>
  );
}

function Eyebrow({ children }: { children: string }) {
  const m = useMediaLook();
  return <Text style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.2em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })}>{children}</Text>;
}

function Title({ children }: { children: string }) {
  const m = useMediaLook();
  const size = m.small ? 36 : m.wide ? (children.length > 28 ? 52 : 64) : 46;
  return <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': `${size}px`, 'line-height': '1.02', 'letter-spacing': '-0.015em', color: '$ui.ink' })}>{children}</Text>;
}

function Facts({ items }: { items: string[] }) {
  const m = useMediaLook();
  const line = items.filter(Boolean).join('  ·  ');
  return line ? <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{line}</Text> : null;
}

function Summary({ text, serif = false }: { text: string; serif?: boolean }) {
  const m = useMediaLook();
  if (!text) return null;
  return <Text style={m.text({ 'font-size': serif ? '17px' : '15px', 'line-height': '1.6', color: '$ui.inkSecondary', 'max-width': '760px',
    ...(serif ? { 'font-family': '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' } : {}) })}>{text}</Text>;
}

function Buttons({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>{children}</View>;
}

function openByline(card: Card, actions: MediaActions): (() => void) | undefined {
  const target = card.media?.bylineTarget ?? '';
  if (target.startsWith('title:')) return () => actions.openTitle({ id: target.slice(6), kind: 'artist' });
  if (target.startsWith('person:')) return () => actions.openPerson(target.slice(7), card.media?.byline ?? '');
  return undefined;
}

function tilesPerRow(m: MediaLook, min: number): { size: number; gap: number } {
  const gap = m.small ? 16 : 24;
  const inner = Math.min(1360, m.width) - m.gutter * 2;
  const count = Math.max(2, Math.floor((inner + gap) / (min + gap)));
  return { size: Math.floor((inner - gap * (count - 1)) / count), gap };
}

function playable(cards: Card[]): Card[] {
  return cards.filter(card => card.media?.audio);
}

// ── Album ────────────────────────────────────────────────────────────────────

function AlbumPage({ card, detail: _detail }: { card: Card; detail: DetailModel }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const children = useChildren(card.id);
  const tracks = useMemo(() => [...(children?.value?.items ?? [])].sort((a, b) =>
    (a.media?.disc ?? 0) - (b.media?.disc ?? 0) || (a.media?.index ?? 0) - (b.media?.index ?? 0)), [children?.value]);
  const discs = new Set(tracks.map(track => track.media?.disc ?? 0));
  const total = tracks.reduce((sum, track) => sum + track.durationSeconds, 0);
  const artist = card.media?.parents.find(parent => parent.role === 'artist');
  const source = { id: card.id, name: card.name };
  const play = (index: number, shuffle = false) => actions.play({ items: playable(tracks), index, shuffle, source });
  const count = tracks.length || card.media?.childCount || 0;
  return (
    <View>
      <Hero cover={<Cover uri={card.poster} shape="square" size={heroCover(m)} title={card.name} byline={card.media?.byline} accent={card.accent} lift={1.6} />}>
        <Eyebrow>{[msg('media.ui.album'), card.yearLabel].filter(Boolean).join(' · ')}</Eyebrow>
        <Title>{card.name}</Title>
        {card.media?.byline ? <TextLink label={card.media.byline} onPress={openByline(card, actions)} testID="media-byline"
          style={m.text({ 'font-size': '19px', 'font-weight': '600', color: '$ui.ink' })} /> : null}
        <Facts items={[count ? msg(`media.count.tracks.${count === 1 ? 'one' : 'other'}`, { count: number(count) }) : '', total ? durationLabel(total) : '', card.genres[0] ?? '']} />
        <Buttons>
          <PillButton primary icon="play" label={msg('media.ui.play')} onPress={() => play(0)} disabled={!tracks.length} testID="media-play" nativeID="media-primary" />
          <PillButton icon="shuffle" label={msg('media.ui.shuffle')} onPress={() => play(0, true)} disabled={tracks.length < 2} testID="media-shuffle" />
        </Buttons>
      </Hero>
      <View style={{ gap: 2, marginBottom: 40 }} testID="media-tracklist">
        {children?.load === 'loading' && !tracks.length ? <ListSkeleton rows={Math.min(10, count || 8)} /> : null}
        {children?.load === 'failed' && !tracks.length ? <ChildrenFailed id={card.id} /> : null}
        {tracks.map((track, i) => (
          <View key={track.id}>
            {discs.size > 1 && (i === 0 || tracks[i - 1]!.media?.disc !== track.media?.disc)
              ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: i ? 22 : 4, paddingBottom: 8 }}>
                  <Text style={m.text({ 'font-size': '13px', 'font-weight': '700', 'letter-spacing': '0.14em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{msg('media.ui.disc', { disc: number(track.media?.disc || 1) })}</Text>
                </View> : null}
            <ListRow number={track.media?.index ? number(track.media.index) : number(i + 1)} title={track.name}
              subtitle={track.media?.byline && track.media.byline !== card.media?.byline ? track.media.byline : undefined}
              trailing={track.media?.clockLabel || (track.durationSeconds ? clock(track.durationSeconds) : '')}
              current={actions.nowPlaying?.id === track.id} playing={actions.nowPlaying?.playing}
              onPress={() => play(playable(tracks).findIndex(t => t.id === track.id))} testID={`media-track-${track.id}`} />
          </View>
        ))}
      </View>
      {card.summary ? <View style={{ marginBottom: 40 }}><Summary text={card.summary} /></View> : null}
      <FactList card={card} />
      {artist ? <MoreBy artistId={artist.id} name={artist.name} exclude={card.id} /> : null}
    </View>
  );
}

function ChildrenFailed({ id, role }: { id: string; role?: string }) {
  const m = useMediaLook();
  const store = useVela();
  return (
    <View style={{ paddingVertical: 24, gap: 14, alignItems: 'flex-start' }} accessibilityRole="alert">
      <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary' })}>{msg('media.ui.loadFailed')}</Text>
      <PillButton compact label={msg('media.ui.retry')} onPress={() => void store.media.children(id, true, role)} testID="media-children-retry" />
    </View>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  const m = useMediaLook();
  return <>{Array.from({ length: rows }, (_, i) => <View key={i} style={{ height: 44, marginVertical: 3, borderRadius: 10, backgroundColor: i % 2 ? m.ui.skeleton : m.ui.skeletonLight }} />)}</>;
}

function FactList({ card }: { card: Card }) {
  const m = useMediaLook();
  const facts = card.media?.facts ?? [];
  if (!facts.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 40, rowGap: 14, marginBottom: 48 }}>
      {facts.map(fact => (
        <View key={fact.label} style={{ gap: 3, minWidth: 140 }}>
          <Text style={m.text({ 'font-size': '11px', 'font-weight': '700', 'letter-spacing': '0.16em', 'text-transform': 'uppercase', color: '$ui.inkQuiet' })}>{fact.label}</Text>
          <Text style={m.text({ 'font-size': '14px', color: '$ui.inkSecondary' })}>{fact.value}</Text>
        </View>
      ))}
    </View>
  );
}

function MoreBy({ artistId, name, exclude }: { artistId: string; name: string; exclude: string }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  // Albums only: an artist's video children (concerts) carry no media facts and are not "more by".
  const albums = (useChildren(artistId)?.value?.items ?? []).filter(album => album.id !== exclude && !!album.media);
  if (!albums.length) return null;
  const { size, gap } = tilesPerRow(m, m.small ? 140 : 190);
  return (
    <View style={{ marginBottom: 32 }}>
      <SectionHeading title={msg('media.ui.moreBy', { name })} />
      <TileGrid gap={gap}>
        {albums.map(album => <CoverTile key={album.id} card={album} size={size} subtitle={album.yearLabel} onPress={() => actions.openTitle(album)} testID={`media-album-${album.id}`} />)}
      </TileGrid>
    </View>
  );
}

// ── Artist ───────────────────────────────────────────────────────────────────

function ArtistPage({ card }: { card: Card }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  // A server that counts each child level (features.pluginLevels) splits an artist's albums from
  // its concerts; with albums alone (or no counts) the page reads its children whole, as before.
  // Followed from bootstrap: an artist opened straight from its address may draw before the server
  // has said it answers child roles, and one whose counts would split waits for it.
  const homeLevels = useVelaState(state => state.home.value?.pluginLevels);
  const homeFailed = useVelaState(state => state.home.load === 'failed' && !state.home.value);
  const levels = settledPluginLevels(homeLevels, homeFailed, () => store.catalogue.pluginLevels());
  const childRoles = levels?.childRoles ?? false;
  const counts = card.media?.childCounts;
  const waiting = childSectionsWait(counts ?? {}, levels);
  const sections = useMemo(() => childSections(counts ?? {}, childRoles), [counts, childRoles]);
  const split = sections.length > 0;
  const hasAlbums = !waiting && (!split || sections.includes('album'));
  const [chosen, setChosen] = useState('');
  const section = sections.includes(chosen) ? chosen : sections[0] ?? 'album';
  const albumsLoad = useChildren(hasAlbums ? card.id : undefined, split ? 'album' : undefined);
  const albumItems = albumsLoad?.value?.items ?? EMPTY;
  const albums = useMemo(() => albumItems.filter(album => !!album.media).sort((a, b) => b.year - a.year), [albumItems]);
  const videoSection = split && section !== 'album' ? section : undefined;
  const videosLoad = useChildren(videoSection ? card.id : undefined, videoSection);
  const newest = albums[0];
  const songs = useChildren(newest?.id)?.value?.items ?? [];
  const top = playable(songs).slice(0, 5);
  // Play and Shuffle are the artist's music: its albums' tracks, never its concerts.
  const playAll = async (shuffle: boolean) => {
    const tracks: Card[] = [];
    for (const album of albums) {
      await store.media.children(album.id);
      tracks.push(...playable(store.getState().children[album.id]?.value?.items ?? []));
    }
    if (tracks.length) actions.play({ items: tracks, index: 0, shuffle, source: { id: card.id, name: card.name } });
  };
  const portrait = m.small ? 200 : m.wide ? 260 : 220;
  const { size, gap } = tilesPerRow(m, m.small ? 140 : 200);
  const albumGrid = albums.length ? (
    <TileGrid gap={gap}>
      {albums.map(album => <CoverTile key={album.id} card={album} size={size} subtitle={[album.yearLabel, album.media?.childCount ? msg(`media.count.tracks.${album.media.childCount === 1 ? 'one' : 'other'}`, { count: number(album.media.childCount) }) : ''].filter(Boolean).join(' · ')}
        onPress={() => actions.openTitle(album)} testID={`media-album-${album.id}`} />)}
    </TileGrid>
  ) : split && section === 'album' && albumsLoad?.load === 'failed' ? <ChildrenFailed id={card.id} role="album" /> : null;
  const sectionGrid = videoSection ? <VideoGrid id={card.id} role={videoSection} load={videosLoad} /> : albumGrid;
  return (
    <View>
      <Hero cover={<Cover uri={card.poster} shape="round" size={portrait} title={card.name} accent={card.accent} lift={1.4} />}>
        <Eyebrow>{msg('media.ui.artist')}</Eyebrow>
        <Title>{card.name}</Title>
        <Facts items={[card.facts, card.genres.slice(0, 2).join(', ')]} />
        {/* While waiting the counts already say whether there is music to play: no button comes and goes. */}
        {(waiting ? !!counts?.album : hasAlbums) ? <Buttons>
          <PillButton primary icon="play" label={msg('media.ui.play')} onPress={() => void playAll(false)} disabled={!albums.length} testID="media-play" nativeID="media-primary" />
          <PillButton icon="shuffle" label={msg('media.ui.shuffle')} onPress={() => void playAll(true)} disabled={!albums.length} testID="media-shuffle" />
        </Buttons> : null}
      </Hero>
      {top.length ? (
        <View style={{ marginBottom: 44 }}>
          <SectionHeading title={msg('media.ui.songs')} detail={newest?.name} />
          <View style={{ gap: 2 }}>
            {top.map((track, i) => (
              <ListRow key={track.id} number={number(i + 1)} title={track.name} subtitle={track.media?.parent?.name}
                trailing={track.media?.clockLabel} current={actions.nowPlaying?.id === track.id} playing={actions.nowPlaying?.playing}
                onPress={() => actions.play({ items: playable(songs), index: playable(songs).findIndex(t => t.id === track.id), source: { id: newest!.id, name: newest!.name } })}
                testID={`media-track-${track.id}`} />
            ))}
          </View>
        </View>
      ) : null}
      {sections.length > 1 ? (
        <View style={{ marginBottom: 40, gap: m.small ? 16 : 22 }}>
          <Segmented label={msg('media.ui.sections')} value={section} onChange={setChosen} testID="media-sections"
            options={sections.map(key => ({ id: key, label: childSectionLabel(key) }))} />
          {sectionGrid}
        </View>
      ) : albums.length || videoSection ? (
        <View style={{ marginBottom: 40 }}>
          <SectionHeading title={childSectionLabel(videoSection ?? 'album')} />
          {sectionGrid}
        </View>
      ) : null}
      {card.summary ? <View style={{ marginBottom: 40 }}><SectionHeading title={msg('media.ui.details')} /><Summary text={card.summary} /></View> : null}
    </View>
  );
}

/** One child level of video titles (an artist's concerts): 16:9 tiles when the titles carry stills of
 * their own (thumb art), their 2:3 posters otherwise. A backdrop alone is not enough: a plugin may
 * give every concert its artist's photo as backdrop, and a row of identical tiles names nothing.
 * Each opens the standard video title page. */
function VideoGrid({ id, role, load }: { id: string; role: string; load: Loadable<ChildrenModel> | undefined }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const items = load?.value?.items ?? EMPTY;
  const wide = items.length ? items.every(item => !!item.thumbnail) : true;
  const { size, gap } = tilesPerRow(m, wide ? (m.small ? 240 : 300) : (m.small ? 140 : 190));
  if (!items.length && load?.load === 'failed') return <ChildrenFailed id={id} role={role} />;
  if (!items.length && (!load || load.load === 'loading' || load.load === 'idle')) return (
    <TileGrid gap={gap}>
      {[0, 1, 2].map(i => <View key={i} style={{ width: size, height: Math.round(size * 9 / 16), borderRadius: 10, backgroundColor: i % 2 ? m.ui.skeleton : m.ui.skeletonLight }} />)}
    </TileGrid>
  );
  return (
    <TileGrid gap={gap}>
      {items.map(item => <VideoTile key={item.id} card={item} size={size} wide={wide} subtitle={[item.yearLabel, item.durationLabel].filter(Boolean).join(' · ')}
        onPress={() => actions.openTitle(item)} testID={`media-video-${item.id}`} />)}
    </TileGrid>
  );
}

function useChildrenItems(id: string): Card[] {
  return useChildren(id)?.value?.items ?? EMPTY;
}
const EMPTY: Card[] = [];

// ── Book ─────────────────────────────────────────────────────────────────────

/** Books are read on phones, tablets, the web and desktop. A TV offers no Read at all: a book's page
 * there is its details, with a quiet line saying where reading is. */
const READS_HERE = !Platform.isTV;

/** On a TV, in place of Read: the reader's own words for where books are read. */
function ReadElsewhere() {
  const m = useMediaLook();
  return <Text testID="media-read-elsewhere" style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.reader.unsupported')}</Text>;
}

function readLabel(card: Card): string {
  const fraction = card.media?.readingFraction ?? 0;
  if (card.played || fraction >= 0.98) return msg('media.ui.readAgain');
  return fraction > 0 ? msg('media.ui.continueReading') : msg('media.ui.read');
}

function BookPage({ card }: { card: Card }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const media = card.media!;
  const series = media.parents.find(parent => parent.role === 'series');
  const canRead = !!media.readingFormat && store.media.features().reading.includes(media.readingFormat);
  const fraction = media.readingFraction;
  const size = m.small ? Math.min(230, m.width - m.gutter * 2 - 60) : m.wide ? 280 : 230;
  return (
    <View>
      <Hero cover={<View style={{ paddingRight: 6, paddingBottom: 6 }}><Cover uri={card.poster} shape="book" size={size} title={card.name} byline={media.byline} accent={card.accent} lift={1.7} /></View>}>
        {series ? <TextLink label={media.index ? msg('media.ui.bookOf', { index: number(media.index), series: series.name }) : series.name}
          onPress={() => actions.openTitle({ id: series.id, kind: 'series' })} testID="media-series"
          style={m.text({ 'font-size': '12px', 'font-weight': '700', 'letter-spacing': '0.2em', 'text-transform': 'uppercase', color: '$ui.inkSecondary' })} />
          : <Eyebrow>{msg('media.ui.book')}</Eyebrow>}
        <Title>{card.name}</Title>
        {media.byline ? <TextLink label={msg('media.ui.by', { name: media.byline })} onPress={openByline(card, actions)} testID="media-byline"
          style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', 'font-style': 'italic', color: '$ui.ink' })} /> : null}
        <Facts items={[card.yearLabel, media.pages ? msg(`media.pages.${media.pages === 1 ? 'one' : 'other'}`, { count: number(media.pages) }) : '',
          media.readingFormat ? msg(`media.ui.format.${media.readingFormat}`) : '', card.genres.slice(0, 2).join(', ')]} />
        {fraction > 0 && fraction < 0.98 ? (
          <View style={{ gap: 8, maxWidth: 420, marginTop: 4 }} testID="media-reading-progress">
            <Progress fraction={fraction} height={5} />
            <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{[msg('media.ui.readProgress', { percent: percent(fraction) }), media.readingLabel].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : card.played || fraction >= 0.98 ? <Text style={m.text({ 'font-size': '13px', color: '$ui.accent', 'font-weight': '600' })}>{msg('media.ui.finished')}</Text> : null}
        {READS_HERE ? <Buttons>
          <PillButton primary icon="book" label={readLabel(card)} onPress={() => actions.read(card)} disabled={!canRead} testID="media-read" nativeID="media-primary" />
        </Buttons> : null}
        {READS_HERE && !canRead ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.ui.cannotRead')}</Text> : null}
        {READS_HERE ? null : <ReadElsewhere />}
      </Hero>
      {card.summary ? <View style={{ marginBottom: 44 }}><Summary text={card.summary} serif /></View> : null}
      <FactList card={card} />
      {series ? <SeriesShelf seriesId={series.id} name={series.name} current={card.id} /> : null}
    </View>
  );
}

function SeriesShelf({ seriesId, name, current }: { seriesId: string; name: string; current: string }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const books = useChildrenItems(seriesId).filter(book => book.id !== current);
  if (!books.length) return null;
  const { size, gap } = tilesPerRow(m, m.small ? 120 : 160);
  return (
    <View style={{ marginBottom: 32 }}>
      <SectionHeading title={msg('media.ui.moreIn', { name })} />
      <TileGrid gap={gap}>
        {books.map(book => <CoverTile key={book.id} card={book} size={size} subtitle={book.media?.indexLabel || book.yearLabel}
          progress={book.media?.readingFraction} onPress={() => actions.openTitle(book)} testID={`media-book-${book.id}`} />)}
      </TileGrid>
    </View>
  );
}

// ── Series ───────────────────────────────────────────────────────────────────

function SeriesPage({ card }: { card: Card }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const bookItems = useChildrenItems(card.id);
  const books = useMemo(() => seriesOrder(bookItems), [bookItems]);
  const next = books.find(book => !book.played && (book.media?.readingFraction ?? 0) < 0.98) ?? books[0];
  const canStart = seriesCanStart(next, store.media.features());
  const start = next ? seriesStart(next) : null;
  const fan = books.slice(0, 3);
  const size = m.small ? 150 : 190;
  const byline = card.media?.byline || books[0]?.media?.byline || '';
  const { size: tile, gap } = tilesPerRow(m, m.small ? 130 : 170);
  const copy = seriesCopy(seriesKind(books, card), books.length || card.media?.childCount || 0);
  return (
    <View>
      <Hero cover={
        <View style={{ width: size + (fan.length - 1) * size * 0.32, height: size * 1.5 + 12 }} accessibilityElementsHidden>
          {(fan.length ? fan : [card]).map((book, i, all) => (
            <View key={book.id} style={{ position: 'absolute', left: i * size * 0.32, top: (all.length - 1 - i) * 4, zIndex: all.length - i,
              transform: [{ rotate: `${(i - (all.length - 1) / 2) * 3}deg` }] }}>
              <Cover uri={book.poster} shape="book" size={size} title={book.name} byline={book.media?.byline} accent={book.accent} lift={1.3} />
            </View>
          )).reverse()}
        </View>}>
        <Eyebrow>{msg('media.ui.series')}</Eyebrow>
        <Title>{card.name}</Title>
        {byline ? <TextLink label={msg('media.ui.by', { name: byline })} onPress={openByline(books[0] ?? card, actions)}
          style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', 'font-style': 'italic', color: '$ui.ink' })} /> : null}
        <Facts items={[copy.count, card.genres.slice(0, 2).join(', ')]} />
        <Buttons>
          {next && start && (READS_HERE || start.icon !== 'book') ? <PillButton primary icon={start.icon} label={start.label}
            onPress={() => actions.openTitle(next)} disabled={!canStart} testID="media-play" nativeID="media-primary" /> : null}
        </Buttons>
        {start && !canStart && (READS_HERE || start.icon !== 'book') ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{start.unavailable}</Text> : null}
        {start && !READS_HERE && start.icon === 'book' ? <ReadElsewhere /> : null}
      </Hero>
      {card.summary ? <View style={{ marginBottom: 40 }}><Summary text={card.summary} serif /></View> : null}
      <SectionHeading title={copy.heading} />
      <TileGrid gap={gap}>
        {books.map(book => <CoverTile key={book.id} card={book} size={tile} subtitle={[book.media?.indexLabel, book.yearLabel].filter(Boolean).join(' · ')}
          progress={book.media?.readingFraction} onPress={() => actions.openTitle(book)} testID={`media-book-${book.id}`} />)}
      </TileGrid>
    </View>
  );
}

// ── Audiobook ────────────────────────────────────────────────────────────────

/** "Narrated by …", each narrator linked to their person page like the author when the credit names one. */
function Narrators({ credits }: { credits: readonly MediaCredit[] }) {
  const m = useMediaLook();
  const actions = useMediaActions();
  const narrators = credits.filter(credit => credit.role === 'narrator');
  if (!narrators.length) return null;
  const style = m.text({ 'font-size': '15px', color: '$ui.inkSecondary' });
  const link = (name: string, personId: string) => (personId ? () => actions.openPerson(personId, name) : undefined);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline' }} testID="media-narrators">
      {narrators.map((credit, i) => (
        <View key={`${credit.personId || credit.name}-${i}`} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          {i > 0 ? <Text style={style}>{', '}</Text> : null}
          <TextLink label={i === 0 ? msg('media.ui.narratedBy', { name: credit.name }) : credit.name}
            onPress={link(credit.name, credit.personId)} style={style} testID={`media-narrator-${i}`} />
        </View>
      ))}
    </View>
  );
}

function AudiobookPage({ card, detail }: { card: Card; detail: DetailModel }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  // The same rule as a series' Start listening, so the two always agree.
  const canListen = store.media.features().audio;
  const media = card.media;
  const parts = playable(useChildrenItems(card.id)).sort((a, b) => (a.media?.index ?? 0) - (b.media?.index ?? 0));
  const chapters = detail.chapters ?? [];
  // A multi-file book resumes in the part the viewer stopped in.
  const resumePart = Math.max(0, parts.findIndex(part => part.progressSeconds > 0 && !part.played));
  const partsBefore = parts.slice(0, resumePart).reduce((sum, part) => sum + part.durationSeconds, 0);
  const position = parts.length ? (parts[resumePart]?.progressSeconds ?? 0) + partsBefore : card.progressSeconds;
  const resumable = position > 0 && !card.played;
  const total = card.durationSeconds || parts.reduce((sum, part) => sum + part.durationSeconds, 0);
  const source = { id: card.id, name: card.name };
  const listen = (from: 'resume' | 'start') => parts.length
    ? actions.play({ items: parts, index: from === 'resume' ? resumePart : 0, positionSeconds: from === 'resume' ? parts[resumePart]?.progressSeconds : 0, source })
    : actions.play({ items: [card], index: 0, positionSeconds: from === 'resume' ? position : 0, source });
  const chapter = [...chapters].reverse().find(c => c.startSeconds <= position);
  return (
    <View>
      <Hero cover={<Cover uri={card.poster} shape="square" size={heroCover(m)} title={card.name} byline={media?.byline} accent={card.accent} lift={1.6} />}>
        <Eyebrow>{[msg('media.ui.audiobook'), card.yearLabel].filter(Boolean).join(' · ')}</Eyebrow>
        <Title>{card.name}</Title>
        {media?.byline ? <TextLink label={msg('media.ui.by', { name: media.byline })} onPress={openByline(card, actions)} testID="media-byline"
          style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': '22px', 'font-style': 'italic', color: '$ui.ink' })} /> : null}
        <Narrators credits={media?.credits ?? []} />
        <Facts items={[total ? durationLabel(total) : '', parts.length ? msg(`media.count.parts.${plural(parts.length)}`, { count: number(parts.length) })
          : chapters.length ? msg(`media.count.chapters.${plural(chapters.length)}`, { count: number(chapters.length) }) : '', card.genres[0] ?? '']} />
        {resumable && total ? (
          <View style={{ gap: 8, maxWidth: 420, marginTop: 4 }} testID="media-listen-progress">
            <Progress fraction={position / total} height={5} />
            <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{[msg('media.ui.left', { time: durationLabel(Math.max(0, total - position)) }), chapter?.name].filter(Boolean).join(' · ')}</Text>
          </View>
        ) : null}
        <Buttons>
          <PillButton primary icon={resumable ? 'play' : 'headphones'} label={resumable ? msg('media.ui.resume') : msg('media.ui.listen')} onPress={() => listen('resume')} disabled={!canListen} testID="media-play" nativeID="media-primary" />
          {resumable ? <PillButton icon="back15" label={msg('media.ui.startOver')} onPress={() => listen('start')} disabled={!canListen} testID="media-start-over" /> : null}
        </Buttons>
        {!canListen ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.ui.cannotListen')}</Text> : null}
      </Hero>
      {card.summary ? <View style={{ marginBottom: 44 }}><Summary text={card.summary} serif /></View> : null}
      {parts.length ? (
        <View style={{ marginBottom: 40 }}>
          <SectionHeading title={msg('media.ui.parts')} />
          {parts.map((part, i) => <ListRow key={part.id} number={number(part.media?.index || i + 1)} title={part.name} trailing={part.durationSeconds ? durationLabel(part.durationSeconds) : ''}
            current={actions.nowPlaying?.id === part.id} playing={actions.nowPlaying?.playing} dim={part.played}
            onPress={() => actions.play({ items: parts, index: i, source })} testID={`media-part-${part.id}`} />)}
        </View>
      ) : chapters.length ? (
        <View style={{ marginBottom: 40 }}>
          <SectionHeading title={msg('media.ui.chapters')} detail={total ? durationLabel(total) : undefined} />
          {chapters.map((c, i) => <ListRow key={c.id} number={number(i + 1)} title={c.name} trailing={clock(c.startSeconds)}
            current={actions.nowPlaying?.id === card.id && chapter?.id === c.id} playing={actions.nowPlaying?.playing} dim={c.startSeconds < position && chapter?.id !== c.id}
            onPress={() => actions.play({ items: [card], index: 0, positionSeconds: c.startSeconds, source })} testID={`media-chapter-${i}`} />)}
        </View>
      ) : null}
      <FactList card={card} />
    </View>
  );
}

/** A date as the viewer reads it ("23 Nov 2026"), else the year label; '' when neither is known. */
function dayLabel(card: Card): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(card.airDate)) {
    const date = new Date(`${card.airDate}T00:00:00Z`);
    if (Number.isFinite(date.getTime())) {
      try { return new Intl.DateTimeFormat(localeContext().formatLocale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date); } catch { /* The year below. */ }
    }
  }
  return card.yearLabel;
}

// ── Photo ────────────────────────────────────────────────────────────────────

/** A photo, as large as the page allows in its own shape, with its name and date. Nothing plays or
 * reads: the page is the picture. */
function PhotoPage({ card }: { card: Card }) {
  const m = useMediaLook();
  const host = useHost();
  // The largest art the card carries: its landscape sizes are read at the backdrop width.
  const uri = card.thumbnail || card.backdrop || card.poster;
  const height = Math.max(240, Math.round(m.height * (m.small ? 0.58 : 0.7)));
  return (
    <View testID="media-photo-page">
      <View style={{ width: '100%', height, marginBottom: m.small ? 20 : 28, alignItems: 'center', justifyContent: 'center' }} testID="media-photo">
        {uri ? <Image source={host.image(uri)} contentFit="contain" transition={200} accessibilityLabel={card.name}
          style={{ width: '100%', height: '100%' }} />
          : <View style={{ width: '60%', height: '80%', borderRadius: 10, backgroundColor: m.ui.skeleton }} />}
      </View>
      <View style={{ gap: 8, marginBottom: 32 }}>
        <Eyebrow>{msg('media.ui.photo')}</Eyebrow>
        <Text accessibilityRole="header" style={m.text({ 'font-family': '$ui.fontDisplay', 'font-size': m.small ? '26px' : '34px', 'line-height': '1.1', color: '$ui.ink' })}>{card.name}</Text>
        <Facts items={[dayLabel(card)]} />
      </View>
      <FactList card={card} />
    </View>
  );
}

// ── Podcast ──────────────────────────────────────────────────────────────────

/** A podcast show and its episodes, newest first; or one episode on its own (no show to open). */
function PodcastPage({ card, marked }: { card: Card; marked: string }) {
  const m = useMediaLook();
  const store = useVela();
  const actions = useMediaActions();
  const canListen = store.media.features().audio;
  const show = card.kind === 'podcast';
  const children = useChildren(show ? card.id : undefined);
  const episodes = useMemo(() => show ? podcastOrder(playable(children?.value?.items ?? EMPTY)) : [card], [show, children?.value, card]);
  const source = { id: card.id, name: card.name };
  const resumable = (episode: Card) => episode.progressSeconds > 0 && !episode.played;
  // Play resumes the episode under way, else the newest the viewer has not heard.
  const primary = episodes.find(resumable) ?? episodes.find(episode => !episode.played) ?? episodes[0];
  const play = (episode: Card, from: 'resume' | 'start' = 'resume') =>
    actions.play({ items: [episode], index: 0, positionSeconds: from === 'resume' && resumable(episode) ? episode.progressSeconds : 0, source: show ? source : { id: episode.id, name: episode.name } });
  const count = episodes.length && show ? episodes.length : card.media?.childCount ?? 0;
  const left = !show && resumable(card) && card.durationSeconds ? Math.max(0, card.durationSeconds - card.progressSeconds) : 0;
  return (
    <View>
      <Hero cover={<Cover uri={card.poster} shape="square" size={heroCover(m)} title={card.name} byline={card.media?.byline} accent={card.accent} lift={1.6} />}>
        <Eyebrow>{show ? msg('media.ui.podcast') : [msg('media.ui.episode'), dayLabel(card)].filter(Boolean).join(' · ')}</Eyebrow>
        <Title>{card.name}</Title>
        {card.media?.byline ? <TextLink label={card.media.byline} onPress={openByline(card, actions)} testID="media-byline"
          style={m.text({ 'font-size': '19px', 'font-weight': '600', color: '$ui.ink' })} /> : null}
        <Facts items={[show && count ? msg(`media.count.episodes.${plural(count)}`, { count: number(count) }) : '', !show && card.durationSeconds ? durationLabel(card.durationSeconds) : '', card.genres[0] ?? '']} />
        {left ? (
          <View style={{ gap: 8, maxWidth: 420, marginTop: 4 }} testID="media-listen-progress">
            <Progress fraction={card.progressSeconds / card.durationSeconds} height={5} />
            <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.ui.left', { time: durationLabel(left) })}</Text>
          </View>
        ) : null}
        <Buttons>
          <PillButton primary icon="play" label={primary && resumable(primary) ? msg('media.ui.resume') : msg('media.ui.play')} onPress={() => primary && play(primary)}
            disabled={!canListen || !primary} testID="media-play" nativeID="media-primary" />
          {!show && resumable(card) ? <PillButton icon="back15" label={msg('media.ui.startOver')} onPress={() => play(card, 'start')} disabled={!canListen} testID="media-start-over" /> : null}
        </Buttons>
        {!canListen ? <Text style={m.text({ 'font-size': '13px', color: '$ui.inkQuiet' })}>{msg('media.ui.cannotPlayPodcast')}</Text> : null}
      </Hero>
      {card.summary ? <View style={{ marginBottom: 44 }}><Summary text={card.summary} /></View> : null}
      {show ? (
        <View style={{ gap: 2, marginBottom: 40 }} testID="media-episodes">
          <SectionHeading title={msg('media.ui.episodes')} />
          {children?.load === 'loading' && !episodes.length ? <ListSkeleton rows={Math.min(10, count || 8)} /> : null}
          {children?.load === 'failed' && !episodes.length ? <ChildrenFailed id={card.id} /> : null}
          {episodes.map((episode, i) => {
            const playingThis = actions.nowPlaying?.id === episode.id;
            const remaining = resumable(episode) && episode.durationSeconds ? msg('media.ui.left', { time: durationLabel(Math.max(0, episode.durationSeconds - episode.progressSeconds)) }) : '';
            return <ListRow key={episode.id} number={number(episode.media?.index || episodes.length - i)} title={episode.name}
              subtitle={[dayLabel(episode), remaining].filter(Boolean).join(' · ') || undefined}
              trailing={episode.durationSeconds ? durationLabel(episode.durationSeconds) : ''}
              current={playingThis || episode.id === marked} playing={playingThis && actions.nowPlaying?.playing} dim={episode.played}
              onPress={() => play(episode)} testID={`media-episode-${episode.id}`} />;
          })}
        </View>
      ) : null}
      <FactList card={card} />
    </View>
  );
}

