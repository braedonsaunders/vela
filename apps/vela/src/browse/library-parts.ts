// A library view's extras in parts: its recommendations, its collections (or a people tab) and
// its genres. Each part is read only when the view on show needs it and never waits on the
// others, so a slow collections answer can neither hold back nor fail Recommended.
import type { Choice, CollectionPage, LibraryExtras, Load, Row } from '@vela/core';

/** One part as a library page holds it. */
export interface Part<T> {
  key: string; load: Load; attempt: number; value?: T;
  /** The progress revision recommendations were read at. */
  progressRevision?: number;
  moreLoading?: boolean; moreFailed?: boolean;
}
export const noPart: Part<never> = { key: '', load: 'idle', attempt: 0 };

/** The part a library view shows: Recommended its rows, Collections or a people tab its collections, Genres its genres. */
export function viewPart(view: string, rows?: Part<Row[]>, collections?: Part<CollectionPage>, genres?: Part<Choice[]>): Part<unknown> | undefined {
  return view === 'recommended' ? rows : view === 'collections' || view === 'people' ? collections : view === 'genres' ? genres : undefined;
}

/** A library's extras as skins read them, assembled from its parts; `failed` is the shown part's alone. */
export function libraryExtras(view: string, rows?: Part<Row[]>, collections?: Part<CollectionPage>, genres?: Part<Choice[]>): LibraryExtras {
  return {
    recommendationsAvailable: true,
    collectionsAvailable: true,
    rows: rows?.value ?? [],
    rowsLoad: rows?.load ?? 'idle',
    collections: collections?.value?.items ?? [],
    collectionCursor: collections?.value?.cursor ?? '',
    collectionsLoad: collections?.load ?? 'idle',
    genres: genres?.value ?? [],
    genresLoad: genres?.load ?? 'idle',
    failed: viewPart(view, rows, collections, genres)?.load === 'failed',
  };
}
