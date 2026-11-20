// The models the app and skin documents read: the wire data projected for display, with every
// label already formatted for the current locale and every image URL sized and validated for the
// selected server. They replace the shapes Exact generated from app.contract (app.contract.d.ts),
// field for field, so the projections in discovery/, live/ and appearance/ did not change.
import type * as V from './wire';

/** A labelled piece of a title's parent context and its select action, when known. */
export interface ContextPart { label: string; select: string }

/** A card: a title, or a row entry that is not one (a collection, channel, playlist or directory). */
export interface Card {
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
}

/** A row of cards, in the server's order. */
export interface Row {
  id: string;
  name: string;
  receipt: string;
  items: Card[];
  nextCursor: string;
  continuation: V.Row['continuation'];
  previewOnFocus: boolean;
  cardStyle?: 'poster' | 'landscape' | 'square';
  presentation: string;
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
}

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
}

/** A library as a destination in the shell. */
export interface Destination {
  id: string;
  name: string;
  kind: string;
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

/** One library, browsed with a sort and filters. */
export interface LibraryModel {
  canSearch?: boolean;
  presentation?: V.Library["presentation"];
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
  name: string;
  items: Card[];
  more: boolean;
  /** True only when the server says the list is exhausted. */
  complete: boolean;
}
