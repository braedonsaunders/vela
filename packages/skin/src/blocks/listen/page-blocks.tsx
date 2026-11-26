// The Listen page-level blocks (L2's list): the pieces of today's music pages a page document
// arranges — the artwork wash, the collection header, covers, the action bar, the byline, music
// shelves, Home's quick tiles and shelves, genres, the artist page's band, liked songs and
// discography, and (whole, for now) search, spoken word's Home and title pages and the albums grid.
// Each draws today's engine (pages.tsx, parts.tsx, spoken.tsx, search.tsx, albums.tsx) from its
// props; with the same data it draws the same pixels.
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { isUnreleased, msg, releaseLabel, type Card } from '@vela/core';
import type { RecordReader } from '../../screen/scope';
import { useMediaLook } from '../../widgets/media/parts';
import { DuplicatesCover } from '../duplicates';
import { ImportCover, usePlaylistImport } from '../import';
import { importSubtitle } from '../import-copy';
import { RewindCover } from '../recap';
import { MusicAlbums } from './albums';
import { useMusic } from './app';
import {
  ActionBar, ArtistHero, ArtistLiked, coverSize, DiscographyHeading, DiscographyShelf, FollowButton, Genres, Header, HomeShelves, MoreButton, Mosaic,
  pad, QuickTiles, usePlayingFrom,
} from './pages';
import { Byline, Heart, IconButton, LikedCover, MusicTile, PlayFab, ReleaseStatus, Shelf, Wash } from './parts';
import { cardOf, cardsOf, dedupeAlbums, shelfSubtitle } from './props';
import type { Props } from './rich';
import { ListeningSearch, RecentSearches, SearchField, SearchResults } from './search';
import { ContinueListening, Credits, ListeningHome, ListeningTitle, SpokenAbout, SpokenCollectionShelf, SpokenFacts, SpokenItems, SpokenPlay, SpokenProgress } from './spoken';
import { PageEnd } from './paging';
import { FocusGroup, FocusScope } from './parts';
import { musicTV } from './layout';
import type { ScreenPress } from '../../host';
import { Cover } from '../../widgets/media/parts';

export const PAGE_BLOCKS = ['wash', 'collectionHeader', 'cover', 'actionBar', 'byline', 'musicShelf', 'quickTiles', 'homeShelves', 'genres',
  'artistHero', 'artistLiked', 'discography', 'listenSearch', 'spokenHome', 'spokenTitle', 'albumsGrid',
  'importSubtitle', 'searchField', 'recentSearches', 'searchResults', 'tileGrid', 'continueListening', 'spokenCredits', 'spokenFacts', 'spokenProgress', 'spokenPlay', 'spokenItems', 'spokenAbout', 'spokenCollectionShelf'] as const;
export type PageBlockName = (typeof PAGE_BLOCKS)[number];

export function isPageBlock(name: string): name is PageBlockName {
  return (PAGE_BLOCKS as readonly string[]).includes(name);
}

/** Draw a page-level block; `template` draws one of the node's part templates (or nothing). */
export function PageBlock({ name, props, read, template, press }: { name: PageBlockName; props: Props; read: RecordReader; template(part: string): ReactNode; press?(p: ScreenPress): void }) {
  switch (name) {
    case 'wash': return <Wash accent={props.text('accent')} image={props.text('image') || undefined} height={props.num('height', 0, 2000) || 420} />;
    case 'collectionHeader': return <Header eyebrow={props.text('eyebrow')} title={props.text('title')} cover={template('collectionHeader.cover')}>{template('collectionHeader.byline')}</Header>;
    case 'cover': return <CoverBlock props={props} read={read} />;
    case 'actionBar': return <ActionBarBlock props={props} read={read} />;
    case 'byline': return <BylineBlock props={props} read={read} />;
    case 'musicShelf': return <MusicShelfBlock props={props} read={read} />;
    case 'quickTiles': return <QuickTiles />;
    case 'homeShelves': return <HomeShelves />;
    case 'genres': return <Genres />;
    case 'artistHero': return <WithCard props={props} read={read}>{card => <ArtistHero card={card} />}</WithCard>;
    case 'artistLiked': return <WithCard props={props} read={read}>{card => <ArtistLiked card={card} />}</WithCard>;
    case 'discography': return <WithCard props={props} read={read}>{card => <Discography card={card} />}</WithCard>;
    case 'listenSearch': return <ListeningSearch />;
    case 'spokenHome': return <ListeningHome />;
    case 'spokenTitle': return <ListeningTitle id={props.text('id')} />;
    case 'albumsGrid': return <MusicAlbums query={props.text('query')} />;
    case 'importSubtitle': return <ImportSubtitle />;
    case 'searchField': return <SearchField />;
    case 'recentSearches': return <RecentSearches />;
    case 'searchResults': return <SearchResults />;
    case 'tileGrid': return <TileGridBlock props={props} read={read} press={press} />;
    case 'continueListening': return <ContinueBlock props={props} read={read} />;
    case 'spokenCredits': return <WithCard props={props} read={read}>{card => <Credits card={card} />}</WithCard>;
    case 'spokenFacts': return <WithCard props={props} read={read}>{card => <SpokenFacts card={card} />}</WithCard>;
    case 'spokenProgress': return <WithCard props={props} read={read}>{card => <SpokenProgress card={card} />}</WithCard>;
    case 'spokenPlay': return <WithCard props={props} read={read}>{card => <SpokenPlay card={card} />}</WithCard>;
    case 'spokenItems': return <WithCard props={props} read={read}>{card => <SpokenItems card={card} />}</WithCard>;
    case 'spokenCollectionShelf': return <WithCard props={props} read={read}>{card => <SpokenCollectionShelf card={card} />}</WithCard>;
    case 'spokenAbout': return <WithCard props={props} read={read}>{card => <SpokenAbout card={card} />}</WithCard>;
  }
}

function WithCard({ props, read, children }: { props: Props; read: RecordReader; children(card: Card): ReactNode }) {
  const card = cardOf(props.value('item'), read);
  return card ? <>{children(card)}</> : null;
}

function Discography({ card }: { card: Card }) {
  const m = useMediaLook();
  return (
    <>
      <View style={{ paddingHorizontal: pad(m) }}><DiscographyHeading card={card} /></View>
      <DiscographyShelf card={card} />
    </>
  );
}

function CoverBlock({ props, read }: { props: Props; read: RecordReader }) {
  const m = useMediaLook();
  const kind = props.enum('kind', ['square', 'round', 'book', 'liked', 'mosaic', 'rewind', 'import', 'duplicates'] as const);
  const size = props.num('size', 0, 1000) || coverSize(m);
  const lift = props.num('lift', 0, 4);
  const card = cardOf(props.value('item'), read);
  switch (kind) {
    case 'liked': return <LikedCover size={size} />;
    case 'rewind': return <RewindCover size={size} />;
    case 'import': return <ImportCover size={size} />;
    case 'duplicates': return <DuplicatesCover size={size} />;
    case 'mosaic': return <Mosaic tracks={cardsOf(props.value('tracks'), read)} size={size} poster={props.text('poster') || card?.poster || undefined} />;
    default:
      return card ? <Cover uri={card.poster} shape={kind} size={kind === 'book' ? Math.round(size / 1.5) : size} title={card.name} accent={card.accent} lift={lift}
        {...(props.bool('byline') ? { byline: card.media?.byline } : {})} /> : null;
  }
}

function ActionBarBlock({ props, read }: { props: Props; read: RecordReader }) {
  const app = useMusic();
  const card = cardOf(props.value('item'), read);
  const release = releaseLabel(card?.airDate);
  const tracks = cardsOf(props.value('tracks'), read).filter(t => t.media?.audio !== false);
  const playable = tracks.filter(t => !isUnreleased(t.airDate));
  const blocked = release || (tracks.length && !playable.length ? releaseLabel(tracks[0]?.airDate) : '');
  const sourceId = props.text('sourceId') || card?.id || '';
  const source = { id: sourceId, name: props.text('sourceName') || card?.name || '', kind: props.enum('sourceKind', ['title', 'playlist', 'favorites'] as const) };
  const playing = usePlayingFrom(sourceId);
  const buttons = props.text('buttons').split(',').map(b => b.trim()).filter(Boolean);
  const playlist = props.text('playlist');
  const following = card ? app.liked(card.id) : false;
  return (
    <ActionBar>
      {buttons.map(button => {
        switch (button) {
          case 'play': return blocked ? <ReleaseStatus key={button} label={blocked} /> : <PlayFab key={button} playing={playing} size={58} onPress={() => (playing ? app.toggle() : app.play(playable, 0, source))} testID="music-play" opensPage />;
          case 'shuffle': return blocked ? null : <IconButton key={button} symbol="shuffle" label={msg('media.ui.shuffle')} size={44} iconSize={24} onPress={() => app.play(playable, 0, source, true)} />;
          case 'heart': return card ? <Heart key={button} card={card} size={44} iconSize={26} /> : null;
          case 'follow': return card ? <FollowButton key={button} on={following} onPress={() => app.like(card, !following)} /> : null;
          case 'more': return card ? <MoreButton key={button} card={card} /> : null;
          case 'edit': return playlist ? <IconButton key={button} symbol="more" label={msg('music.editDetails')} size={44} iconSize={24} testID="music-playlist-edit"
            onPress={() => app.drawer({ mode: 'edit', id: playlist, name: props.text('sourceName') || card?.name || '', summary: props.text('summary') })} /> : null;
          default: return null;
        }
      })}
    </ActionBar>
  );
}

function BylineBlock({ props, read }: { props: Props; read: RecordReader }) {
  const card = cardOf(props.value('item'), read);
  const raw = props.value('facts');
  const facts = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split('|') : [];
  return card ? <Byline card={card} facts={facts} /> : null;
}

function MusicShelfBlock({ props, read }: { props: Props; read: RecordReader }) {
  const exclude = props.text('exclude');
  const role = props.text('role');
  const limit = props.num('limit', 0, 500);
  const raw = cardsOf(props.value('items'), read).filter(card => card.id !== exclude && (!role || card.media?.role === role));
  const deduped = props.bool('dedupeAlbums') ? dedupeAlbums(raw) : raw;
  const items = limit ? deduped.slice(0, limit) : deduped;
  const size = props.num('tileSize', 80, 400) || 176;
  const subtitle = props.enum('subtitle', ['none', 'year', 'byline', 'release', 'playlist'] as const);
  if (!items.length) return null;
  return (
    <Shelf title={props.text('title')} detail={props.text('detail') || undefined}>
      {items.map(card => <MusicTile key={card.id} card={card} size={size} subtitle={shelfSubtitle(card, subtitle)} />)}
    </Shelf>
  );
}

/** A wrapping grid of music tiles over a list source, reading its next page (vela.more) as the
 * grid's end comes into reach; "Loading more…" and a retry at its end. The albums grid's tiles by
 * default (200 on TV, 132 on a phone, else 168). */
function TileGridBlock({ props, read, press }: { props: Props; read: RecordReader; press?(p: ScreenPress): void }) {
  const m = useMediaLook();
  const tv = musicTV();
  const list = props.value('items');
  const items = cardsOf(list, read);
  const more = !!(list && typeof list === 'object' && (list as { more?: unknown }).more === true);
  const source = props.text('source');
  const size = props.num('tileSize', 0, 400) || (tv ? 200 : m.small ? 132 : 168);
  const subtitle = props.enum('subtitle', ['yearByline', 'none', 'year', 'byline', 'release', 'playlist'] as const);
  const loadMore = () => { if (source) press?.({ action: 'plugin', arg: '', args: { name: 'vela.more', source }, control: `more-${source}` }); };
  return (
    <>
      <FocusScope.Provider value={`grid:${source}`}>
        <FocusGroup style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: m.small ? -8 : -12 }}>
          {items.map((card, index) => (
            <MusicTile key={card.id} card={card} size={size} preferred={index === 0} testID={`music-albums-${card.id}`}
              subtitle={subtitle === 'yearByline' ? [card.yearLabel, card.media?.byline].filter(Boolean).join(' · ') || undefined : shelfSubtitle(card, subtitle)} />
          ))}
        </FocusGroup>
      </FocusScope.Provider>
      <PageEnd more={more} loading={props.bool('pending')} failed={!!props.text('failed')} onMore={loadMore} testID="music-albums-end" />
    </>
  );
}

/** Continue listening over a row (a vela.rows row: {name, items}). */
function ContinueBlock({ props, read }: { props: Props; read: RecordReader }) {
  const raw = props.value('row');
  const items = cardsOf(raw, read);
  const name = raw && typeof raw === 'object' ? String((raw as { name?: unknown }).name ?? '') : '';
  return items.length ? <ContinueListening row={{ name: props.text('title') || name, items }} /> : null;
}

/** The import page's line under its title: the job's description, else what can be imported
 * (the advertised sources, which are not a vela.* source). */
function ImportSubtitle() {
  const m = useMediaLook();
  const { job, sources } = usePlaylistImport({ poll: false });
  return <Text style={m.text({ 'font-size': '15px', color: '$ui.inkSecondary', 'max-width': '680px' })}>{job?.description || importSubtitle(sources)}</Text>;
}
