// A library view's sort and filters as the library route's URL parameters, so a reload, a shared
// link and Back keep the view. A parameter that is absent, or not a value the protocol knows,
// leaves that part to the server's default. The document's sort and filter actions are applied
// here to give the next view.
import type { LibraryModel, LibraryQuery } from '@vela/core';

/** The route's search parameters, as expo-router hands them over. */
export type LibraryParams = {
  view?: string;
  facetTitle?: string;
  query?: string;
  facets?: string;
  sort?: string;
  dir?: string;
  kind?: string;
  genre?: string;
  year?: string;
  played?: string;
  fav?: string;
  collectionId?: string;
  start?: string;
};

type Sort = NonNullable<LibraryQuery['sort']>;
type Direction = NonNullable<LibraryQuery['direction']>;
type Kind = NonNullable<LibraryQuery['kind']>;

const SORTS: Record<Sort, true> = {
  index: true,
  server: true,
  title: true,
  added: true,
  released: true,
  year: true,
  rating: true,
  duration: true,
  popularity: true,
  updated: true,
  lastViewed: true,
};
const KINDS: Record<Kind, true> = { movie: true, show: true, season: true, episode: true };

const isSort = (value: string | undefined): value is Sort => !!value && value in SORTS;
const isKind = (value: string | undefined): value is Kind => !!value && value in KINDS;
const isDirection = (value: string | undefined): value is Direction => value === 'asc' || value === 'desc';

function year(text: string | undefined): number | undefined {
  const value = Number(text);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function played(text: string | undefined): boolean | undefined {
  if (text === 'true') return true;
  if (text === 'false') return false;
  return undefined;
}

function startOffset(text: string | undefined): number | undefined {
  if (!text || !/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function hasAnyFilter(query: Pick<LibraryQuery, 'query' | 'facets' | 'kind' | 'genre' | 'year' | 'played' | 'favorite' | 'collectionId' | 'tab'>): boolean {
  return !!(
    query.query
    || query.kind
    || query.genre
    || query.year !== undefined
    || query.played !== undefined
    || query.favorite
    || query.collectionId
    || query.tab
    || (query.facets && Object.keys(query.facets).length > 0)
  );
}

/** Whether a library view is eligible for first-character letter jumping: an unfiltered
 * title-ascending grid of a video movie or show section. */
export function jumpIndexEligible(
  model: Pick<LibraryModel, 'kind' | 'media' | 'sort' | 'direction'> | undefined,
  query: LibraryQuery,
  options: { view: string; layout: string; facetTitle?: string },
): boolean {
  if (!model) return false;
  if (options.view !== 'library' || options.layout !== 'grid' || options.facetTitle) return false;
  if ((model.media ?? 'video') !== 'video') return false;
  if (model.kind !== 'movies' && model.kind !== 'shows') return false;
  const sort = query.sort ?? model.sort;
  const direction = query.direction ?? model.direction;
  if (sort !== 'title' || direction !== 'asc') return false;
  return !hasAnyFilter(query);
}

export function queryOf(params: LibraryParams): LibraryQuery {
  const query: LibraryQuery = {
    query: params.query || undefined,
    facets: parseFacets(params.facets),
    sort: isSort(params.sort) ? params.sort : undefined,
    direction: isDirection(params.dir) ? params.dir : undefined,
    kind: isKind(params.kind) ? params.kind : undefined,
    genre: params.genre || undefined,
    year: year(params.year),
    played: played(params.played),
    favorite: params.fav === 'true' ? true : undefined,
    collectionId: params.collectionId || undefined,
  };
  const start = startOffset(params.start);
  const titleAsc = (!query.sort || query.sort === 'title') && (!query.direction || query.direction === 'asc');
  return start !== undefined && titleAsc && !hasAnyFilter(query) ? { ...query, start } : query;
}

/** Every parameter, an absent part as undefined so setting them clears it from the URL. */
export function paramsOf(query: LibraryQuery): Record<Exclude<keyof LibraryParams, 'view' | 'facetTitle'>, string | undefined> {
  return {
    query: query.query,
    facets: query.facets && Object.keys(query.facets).length ? JSON.stringify(query.facets) : undefined,
    sort: query.sort,
    dir: query.direction,
    kind: query.kind,
    genre: query.genre,
    year: query.year === undefined ? undefined : String(query.year),
    played: query.played === undefined ? undefined : String(query.played),
    fav: query.favorite ? 'true' : undefined,
    collectionId: query.collectionId,
    start: query.start !== undefined && Number.isSafeInteger(query.start) && query.start > 0 ? String(query.start) : undefined,
  };
}

/** A collection URL carries the label/count shown by its entry and the tab it returns to. */
export function collectionRoute(
  id: string,
  query: LibraryQuery,
  target: string,
  view: string,
  card?: { name: string; facts: string },
) {
  return {
    pathname: '/library/[id]' as const,
    params: {
      id,
      ...paramsOf(query),
      view,
      facetTitle: [card?.name ?? target, card?.facts].filter(Boolean).join(' · '),
    },
  };
}

export function collectionHref(
  id: string,
  query: LibraryQuery,
  target: string,
  view: string,
  card?: { name: string; facts: string },
): string {
  const route = collectionRoute(id, query, target, view, card);
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(route.params)) if (name !== 'id' && value) params.set(name, value);
  const suffix = params.toString();
  return `/library/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ''}`;
}

/** `librarySort {opt.id}`: that sort, keeping the direction when the sort offers it. */
export function sortedBy(query: LibraryQuery, model: LibraryModel | undefined, id: string): LibraryQuery {
  if (!isSort(id)) return query;
  const option = model?.sorts.find(o => o.id === id);
  const kept = option && model && option.directions.includes(model.direction) ? model.direction : undefined;
  return { ...query, sort: id, direction: kept ?? option?.directions[0], start: undefined };
}

/** `librarySortFlip`: the sort in force, the other way round. */
export function flipped(query: LibraryQuery, model: LibraryModel | undefined): LibraryQuery {
  if (!model) return query;
  return { ...query, sort: model.sort, direction: model.direction === 'asc' ? 'desc' : 'asc', start: undefined };
}

/** `libraryFilter name|value`: kind, genre, year, played, favorite or start; an empty value clears it; `clear|facets` clears them all. */
export function filteredBy(query: LibraryQuery, arg: string): LibraryQuery {
  const [name = '', ...rest] = arg.split('|');
  const value = rest.join('|');
  switch (name) {
    case 'start':
      return { ...query, start: startOffset(value) };
    case 'query': return { ...query, query: value || undefined, start: undefined };
    case 'facets': return { ...query, facets: parseFacets(value), start: undefined };
    case 'kind':
      return { ...query, kind: isKind(value) ? value : undefined, start: undefined };
    case 'genre':
      return { ...query, genre: value || undefined, start: undefined };
    case 'year':
      return { ...query, year: year(value), start: undefined };
    case 'played':
      return { ...query, played: played(value), start: undefined };
    case 'favorite':
      return { ...query, favorite: value === 'true' ? true : undefined, start: undefined };
    // Every filter at once (the Filters panel's Clear all); the facets given are kept (an opened
    // facet collection's own). Search and sort stay.
    case 'clear':
      return { ...query, facets: parseFacets(value), kind: undefined, genre: undefined, year: undefined, played: undefined, favorite: undefined, start: undefined };
    default:
      return query;
  }
}

/** A model read for another view, shown while this one is read, with this view's sort and
 * filters in force, so the controls answer at once. */
export function asQueried(model: LibraryModel, query: LibraryQuery): LibraryModel {
  return {
    ...model,
    query: query.query,
    facetFilters: query.facets,
    sort: query.sort ?? model.sort,
    direction: query.direction ?? model.direction,
    kindFilter: query.kind ?? '',
    genreFilter: query.genre ?? '',
    playedFilter: query.played === undefined ? '' : String(query.played),
    favoriteFilter: query.favorite === true,
    yearFilter: query.year ?? 0,
  };
}

function parseFacets(text?: string): Record<string, string[]> | undefined {
  try {
    const value = JSON.parse(text ?? 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return Object.fromEntries(Object.entries(value).filter((pair): pair is [string, string[]] => Array.isArray(pair[1]) && pair[1].every(v => typeof v === 'string')));
  } catch { return undefined; }
}
