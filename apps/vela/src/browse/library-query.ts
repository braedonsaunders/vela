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

export function queryOf(params: LibraryParams): LibraryQuery {
  return {
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
  };
}

/** `librarySort {opt.id}`: that sort, keeping the direction when the sort offers it. */
export function sortedBy(query: LibraryQuery, model: LibraryModel | undefined, id: string): LibraryQuery {
  if (!isSort(id)) return query;
  const option = model?.sorts.find(o => o.id === id);
  const kept = option && model && option.directions.includes(model.direction) ? model.direction : undefined;
  return { ...query, sort: id, direction: kept ?? option?.directions[0] };
}

/** `librarySortFlip`: the sort in force, the other way round. */
export function flipped(query: LibraryQuery, model: LibraryModel | undefined): LibraryQuery {
  if (!model) return query;
  return { ...query, sort: model.sort, direction: model.direction === 'asc' ? 'desc' : 'asc' };
}

/** `libraryFilter name|value`: kind, genre, year, played or favorite; an empty value clears it. */
export function filteredBy(query: LibraryQuery, arg: string): LibraryQuery {
  const [name = '', ...rest] = arg.split('|');
  const value = rest.join('|');
  switch (name) {
    case 'query': return { ...query, query: value || undefined };
    case 'facets': return { ...query, facets: parseFacets(value) };
    case 'kind':
      return { ...query, kind: isKind(value) ? value : undefined };
    case 'genre':
      return { ...query, genre: value || undefined };
    case 'year':
      return { ...query, year: year(value) };
    case 'played':
      return { ...query, played: played(value) };
    case 'favorite':
      return { ...query, favorite: value === 'true' ? true : undefined };
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
