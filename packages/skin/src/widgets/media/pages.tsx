// Purpose-built pages for media titles (docs/media-kinds.md): an album with its tracklist, an
// artist with songs and albums, an audiobook with chapters or parts, and a podcast with its
// episodes. Read handles books and series. Gallery handles photos. A track opens its album, a part its audiobook and
// a podcast episode its show. The app draws one of
// these in place of the document's title page; each takes the document's `ui` look.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { childrenKey, childSectionLabel, childSections, childSectionsWait, settledPluginLevels, clock, durationLabel, msg, number, plural, podcastOrder, type Card, type ChildrenModel, type DetailModel, type Loadable, type MediaCredit } from '@vela/core';
import { useVela, useVelaState } from '@vela/core/react';
import { dayLabel } from '../../blocks/media/day';
import { heroCover, MediaTitlePending } from '../../blocks/media/title-pending';
import { useMediaActions } from './context';
import { Cover, CoverTile, ListRow, PillButton, Progress, SectionHeading, Segmented, TextLink, TileGrid, useMediaLook, VideoTile, type MediaLook } from './parts';
import { Buttons, Eyebrow, FactList, Facts, Hero, MediaFrame as Frame, openByline, Summary, tilesPerRow, Title } from '../../blocks/media/title';

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
      {!card ? <MediaTitlePending load={detail} id={id} />
        : cls === 'podcast' ? <PodcastPage card={card} marked={marked} />
        : role === 'album' ? <AlbumPage card={card} detail={detail.value!} />
        : role === 'artist' ? <ArtistPage card={card} />
        : cls === 'audiobook' ? <AudiobookPage card={card} detail={detail.value!} />
        : null}
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

/** Cover beside the title block on wide screens, above it on phones. */
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

