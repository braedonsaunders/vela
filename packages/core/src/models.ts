// The models the app and skin documents read: the wire data projected for display, with every
// label already formatted for the current locale and every image URL sized and validated for the
// selected server. They replace the shapes Exact generated from app.contract (app.contract.d.ts),
// field for field, so the projections in discovery/, live/ and appearance/ did not change.
import type * as V from './wire';
import type { CardMedia, CardShape } from './media';
import type { PluginLevels } from './plugin-levels';
import type { VelaExperience } from './library-presentation';

/** A labelled piece of a title's parent context and its select action, when known. */
export interface ContextPart { label: string; select: string }

/** A card: a title, or a row entry that is not one (a collection, channel, playlist or directory). */
export interface Card {
  /** Titles that belong to a directory entry when the server knows their count. */
  itemCount?: number;
  thumbnail?: string;
  id: string;
  /** A title kind (`movie`, `show`, `season`, `episode`) or the entry's kind (`collection`, `channel`, …). */
  kind: string;
  name: string;
  summary: string;
  airDate: string;
  year: number;
  rating: string;
  durationSeconds: number;
  progressSeconds: number;
  played: boolean;
  favorite?: boolean;
  watchlisted?: boolean;
  notInterested?: boolean;
  thumbsUp?: boolean;
  lastViewedAt?: string;
  showId: string;
  showName: string;
  episodeContext: string;
  contextParts: ContextPart[];
  seasonId: string;
  seasonNumber: number;
  episodeNumber: number;
  genres: string[];
  durationLabel: string;
  yearLabel: string;
  progressLabel: string;
  seasonNumberLabel: string;
  episodeNumberLabel: string;
  /** Year, rating and duration, joined with " · ". */
  facts: string;
  poster: string;
  backdrop: string;
  logo: string;
  accent: string;
  /** The ranking receipt the server issued with this card ('' when none). */
  receipt: string;
  /** Stable playlist member identity; absent outside playlist contents. */
  entryId?: string;
  /** Music, book and audiobook facts (docs/media-kinds.md); absent for video. */
  media?: CardMedia;
  /** The card's own cover shape ('' or absent: the row's or library's). */
  shape?: CardShape;
  /** A plugin's video child's own role (a concert; features.pluginLevels); absent for other titles. */
  videoRole?: string;
}

/** A row of cards, in the server's order. */
export interface Row {
  /** The server's id for the row as read: it opens the row (/rows/{id}) and may change between
   * reads (Ether re-mints row ids when the feed recomputes after playback). */
  id: string;
  /** The server's opaque key for the row, the same across reads, when it sends one. */
  key?: string;
  /** What the row was drawn as when a later read re-minted its id, so it is not drawn again from
   * scratch (drawnAs in discovery/progress). Absent: its key, else its id. */
  drawnAs?: string;
  name: string;
  /** Why the server placed this row; progress reconciliation uses this instead of its label. */
  purpose: V.Row['purpose'];
  receipt: string;
  items: Card[];
  nextCursor: string;
  continuation: V.Row['continuation'];
  previewOnFocus: boolean;
  /** A row a plugin surface draws (its id in `HomeModel.surfaces`) and that plugin; the row has no items of its own. */
  surface?: string;
  plugin?: string;
  /** `ranked` (Top 10), else ''. */
  presentation: string;
  /** How the row draws: `standard` when the server said nothing or something unknown. */
  layout: V.RowLayout;
  /** The items' card, when the server chose one (library pages: the library's). */
  card?: V.RowCard;
  /** The items' media role (album, track, movie, …), when known. */
  role?: string;
  /** The titles differ per viewer. */
  personal: boolean;
  /** The library a one-row-per-library row (or a library's surface row) belongs to. */
  library?: string;
  experience?: V.RowExperience;
}

/** What a hero's button does, and how it is labelled. */
export interface HeroAction {
  heroId: string;
  reason: V.HeroReason;
  reasonLabel: string;
  action: V.HeroAction['kind'];
  targetId: string;
  /** The target's kind when it is the hero's own title, `episode` for a next episode, else ''. */
  targetKind: string;
  actionLabel: string;
  actionDetail: string;
  /** Resume progress, 0 to 1. */
  progress: number;
}

export interface PreviewGrant {
  id: string;
  url: string;
  expiresAt: number;
}

export interface HomeModel {
  viewer: string;
  /** The signed-in viewer's picture (a Plex or Jellyfin avatar) on the server's own origin; '' for none. */
  viewerAvatar: string;
  defaultSkinId: string;
  skins: string[];
  hero: Card[];
  heroActions: HeroAction[];
  heroPreviewIds: string[];
  previews: PreviewGrant[];
  rows: Row[];
  nextCursor: string;
  liveAvailable: boolean;
  libraryLiveAvailable: boolean;
  aiAvailable: boolean;
  descriptiveAvailable: boolean;
  trailerPreviewAvailable: boolean;
  playlistsAvailable: boolean;
  /** Plugin screens from bootstrap navigation (Sports), as top-level sections after Live TV. */
  screens: ScreenNav[];
  /** Plugin surfaces this client may show (player overlays, toasts, Home rows, title panels). */
  surfaces: V.SurfaceContribution[];
  /** What the server answers for plugin levels (features.pluginLevels), known once bootstrap is: pages
   * that depend on it (a recommended tab's own rows, an artist's sections) wait for it or follow it. */
  pluginLevels?: PluginLevels;
}

/** A plugin screen the viewer may open (bootstrap `navigation`): its landing page's document. */
export interface ScreenNav { id: string; title: string; icon: string; page: string; document: { href: string; renderer: number } }

export interface Rating {
  /** `rt-critics`, `rt-audience`, or the wire source (`imdb`, `tmdb`, …). */
  source: string;
  label: string;
  value: string;
  /** The rating on a 0–100 scale. */
  score: number;
  state: string;
}

export interface Person {
  id?: string;
  canOpen?: boolean;
  name: string;
  role: string;
  portrait: string;
}

export interface Extra {
  id: string;
  name: string;
  kind: string;
  ready: boolean;
}

export interface DetailModel {
  /** The title's own card (one item, so documents can repeat over it). */
  title: Card[];
  ratings: Rating[];
  trailerId: string;
  trailerReady: boolean;
  themeMusicUrl: string;
  themeMusicExpiresAt: number;
  related: Row[];
  mediaFacts: string[];
  resumePosition: string;
  crew: string[];
  crewPeople: Person[];
  canPlay: boolean;
  resumeSeconds: number;
  seasons: Card[];
  episodes: Card[];
  nextUp?: Card[];
  extras: Extra[];
  cast: string[];
  castPeople: Person[];
  /** Parts the server is still making (`seasons`, `episodes`, `extras`, `trailer`): not yet there, not absent. */
  pending: V.PendingPart[];
  /** Chapters of a playable title (an audiobook's), in order. */
  chapters?: V.Chapter[];
}

/** A library as a destination in the shell. */
export interface Destination {
  id: string;
  name: string;
  kind: string;
  /** What the library holds; 'video' for servers without media classes. */
  media?: V.MediaClass;
  /** The library's declared card shape (a landscape library's thumbnails). */
  presentation?: V.Library['presentation'];
  /** How it opens (libraryExperience): watch, listen, read, gallery or live; absent reads as watch. */
  experience?: VelaExperience;
  /** The experience the server named, as sent (chosen again once the server's features are known). */
  declaredExperience?: string;
  /** The library's declared tabs (absent from a server that declares none). */
  tabs?: V.LibraryTab[];
  dateDisplay: 'year' | 'date';
  backdrop: string;
}

export interface Choice {
  id: string;
  label: string;
}

export interface SortChoice extends Choice {
  directions: V.SortDirection[];
}

/** One entry in a library's jump index (A–Z, `#`, …), in the server's title-sort order. */
export interface LibraryJumpBucket {
  key: string;
  label: string;
  count: number;
  /** Zero-based item offset where this bucket starts in ascending title sort. */
  startOffset: number;
}

/** One library, browsed with a sort and filters. */
export interface LibraryModel {
  canSearch?: boolean;
  presentation?: V.Library["presentation"];
  /** What the library holds; 'video' for servers without media classes. */
  media?: V.MediaClass;
  tabs?: V.LibraryTab[];
  facets?: V.LibraryFacet[];
  query?: string;
  facetFilters?: Record<string, string[]>;
  canCollectionId?: boolean;
  id: string;
  name: string;
  kind: V.Library['kind'];
  dateDisplay: 'year' | 'date';
  backdrop: string;
  sorts: SortChoice[];
  sort: V.LibrarySort;
  direction: V.SortDirection;
  kinds: Choice[];
  genres: Choice[];
  kindFilter: string;
  genreFilter: string;
  /** 'true', 'false', or '' for either. */
  playedFilter: string;
  favoriteFilter: boolean;
  yearFilter: number;
  canYear: boolean;
  canPlayed: boolean;
  canFavorite: boolean;
  items: Card[];
  more: boolean;
  /** Titles matching the whole view when the server counts them. */
  total?: number;
  /** Zero-based item offset this window began at (absent or 0 from the start of the library). */
  startOffset?: number;
  /** How many pages the items fill (the next read asks for one more). */
  pages: number;
}

export interface LibraryLiveModel {
  items: Card[];
  filters: V.LibraryLiveFilter[];
  cursor: string;
  continuation: V.LibraryLiveContents['continuation'];
}

/** Server-specific library sections, absent when the server has no scoped operations. */
export interface LibraryExtras {
  /** Independent answers: rows may arrive before collections. */
  rowsLoad?: import('./store/state').Load;
  collectionsLoad?: import('./store/state').Load;
  genresLoad?: import('./store/state').Load;
  recommendationsAvailable: boolean;
  collectionsAvailable: boolean;
  rows: Row[];
  collections: Card[];
  collectionCursor: string;
  genres: Choice[];
  failed: boolean;
}

export interface CollectionModel {
  id?: string;
  kind?: string;
  name: string;
  items: Card[];
  more: boolean;
  smart?: boolean;
  entryCount?: number;
  /** A playlist's description. */
  summary?: string;
  /** True only when the server says the list is exhausted. */
  complete: boolean;
}

export interface PlaylistModel {
  id: string;
  name: string;
  poster: string;
  backdrop: string;
  itemCount: number;
  smart: boolean;
  updatedAt: string;
}
