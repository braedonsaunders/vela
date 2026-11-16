// The models the app and skin documents read: the wire data projected for display, with every
// label already formatted for the current locale and every image URL sized and validated for the
// selected server. They replace the shapes Exact generated from app.contract (app.contract.d.ts),
// field for field, so the projections in discovery/, live/ and appearance/ did not change.
import type * as V from './wire';

/** A card: a title, or a row entry that is not one (a collection, channel, playlist or directory). */
export interface Card {
  id: string;
  /** A title kind (`movie`, `show`, `season`, `episode`) or the entry's kind (`collection`, `channel`, …). */
  kind: string;
  name: string;
  summary: string;
  year: number;
  rating: string;
  durationSeconds: number;
  progressSeconds: number;
  played: boolean;
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
  extras: Extra[];
  cast: string[];
  castPeople: Person[];
}

/** A library as a destination in the shell. */
export interface Destination {
  id: string;
  name: string;
  kind: string;
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
  id: string;
  name: string;
  kind: string;
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

export interface CollectionModel {
  name: string;
  items: Card[];
  more: boolean;
  /** True only when the server says the list is exhausted. */
  complete: boolean;
}
