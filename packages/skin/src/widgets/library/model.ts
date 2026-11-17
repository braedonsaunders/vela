// What a library page and a collection page show (routes.library, routes.collection): the model
// on show and whether a read is under way. The app builds these from core's store; documents
// read them through the library vocabulary.
import type { Choice, CollectionModel, LibraryExtras, LibraryModel } from '@vela/core';

export type LibraryView = 'recommended' | 'library' | 'collections' | 'genres';

export interface LibraryPage {
  canRecommend?: boolean;
  view?: LibraryView;
  /** Explicit URL selection; an initially arriving server view is not a tab transition. */
  viewRequest?: string;
  extras?: LibraryExtras;
  extrasLoading?: boolean;
  extrasFailed?: boolean;
  /** The view on show: the current sort and filters' answer, or while it is read, the last one. */
  model?: LibraryModel;
  /** The first page of the current sort and filters is being read. */
  loading: boolean;
  /** A further page of the current view is being read. */
  moreLoading: boolean;
}

export interface CollectionPage {
  model?: CollectionModel;
  moreLoading: boolean;
}

/** Which list a repeated option (`opt.*`) comes from. */
export type OptionOf = 'kind' | 'genre' | 'sort';

/** A kind, genre or sort a library page offers, and which list it is from. */
export interface LibraryOption extends Choice {
  of: OptionOf;
}
