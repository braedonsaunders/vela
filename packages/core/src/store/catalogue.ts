// The catalogue beyond home: a title's details and related rows, a library browsed with a sort
// and filters, and a collection read page by page. Each is kept by key for the current session
// and dropped when the session or server changes.
import type * as V from '../wire';
import { libraryCardArtwork } from '../library-presentation';
import { hasTitleManagement } from '../adapter/capabilities';
import { capabilitiesOf } from '../adapter/advertise';
import { hasLibraryFacets, supportsLibraryBrowse, hasLibraryLive, hasLibraryRecommendations, hasPersonFilmography } from '../adapter/capabilities';
import { personDates } from '../discovery/person-date';
import { artworkURL, type Images } from '../discovery/artwork';
import { detailModel, entry, feedRow, libraryLiveCard, withDateDisplay } from '../discovery/models';
import { detailCard, detailWatched, recorded, type Watched } from '../discovery/progress';
import type { Card, CollectionModel, DetailModel, LibraryExtras, LibraryLiveModel, LibraryModel, Row } from '../models';
import type { Connection } from '../adapter/connection';
import { msg } from '../i18n';
import { PendingTitles } from './pending';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';
import { optimisticWatchState } from './watch-state';

/** A library view: sort, direction and filters; absent fields are the server's defaults. */
export interface LibraryQuery {
  tab?: string;
  query?: string;
  facets?: Record<string, string[]>;
  collectionId?: string;
  sort?: V.LibrarySort;
  direction?: V.SortDirection;
  kind?: V.TitleKind;
  genre?: string;
  year?: number;
  played?: boolean;
  favorite?: boolean;
}

/** The key a library view is kept under in state (`state.library`). */
export function libraryKey(id: string, query: LibraryQuery): string {
  const { tab, sort, direction, kind, genre, year, played, favorite, collectionId } = query;
  const facets = Object.entries(query.facets ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, values]) => [field, [...new Set(values)].sort()]);
  return JSON.stringify([id, tab, sort, direction, kind, genre, year, played, favorite, collectionId, query.query, facets]);
}

const PAGE = 100;
/** Reads of a title page after watching, before the server's answer stands as it is. */
const RECONCILE_ATTEMPTS = 3;

export class Catalogue {
  async titleActions(id: string) {
    const api = (await this.session.ready()).adapter;
    return hasTitleManagement(api) ? api.titleActions(id) : null;
  }
  async setTitleWatch(id: string, change: { played?: boolean; favorite?: boolean; watchlisted?: boolean; continueWatching?: false }) {
    const api = (await this.session.ready()).adapter;
    if (!hasTitleManagement(api)) throw new Error('Title actions are unavailable');
    const before = this.box.get();
    this.box.replace(optimisticWatchState(before, id, change));
    try {
      await api.setTitleWatch(id, { ...change, idempotencyKey: this.session.key() });
      void this.title(id, true);
    } catch (error) {
      // A removal has no card left to map back into the row, so restore the captured immutable
      // snapshot rather than trying to synthesize an inverse mutation.
      this.box.replace(before);
      throw new Error(msg('cardMenu.actionFailed'), { cause: error });
    }
  }

  async libraryFacets(id: string, field: string, query = '', cursor?: string): Promise<V.Page<V.FacetValue>> {
    const adapter = (await this.session.ready()).adapter;
    if (!hasLibraryFacets(adapter)) throw new Error('Library facets are unavailable');
    return adapter.libraryFacets(id, field, query, cursor);
  }
  async personDetails(id: string): Promise<{ name: string; portrait: string; knownFor: string; biography: string; birthday: string } | undefined> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!('personDetails' in adapter) || typeof adapter.personDetails !== 'function') return undefined;
    const person = await adapter.personDetails(id) as V.PersonDetail;
    const images = await connection.images();
    return { name: person.name, portrait: person.photo ? artworkURL(person.photo, 480, 480, images) ?? '' : '', knownFor: person.knownFor || person.roles?.[0] || '', biography: person.biography ?? '', birthday: personDates(person.birthday, person.deathday ?? person.deathDate) };
  }
  async personTitles(id: string | undefined, libraryId?: string, cursor?: string): Promise<{ items: Card[]; cursor?: string }> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!id || !hasPersonFilmography(adapter)) throw new Error('Person filmography is unavailable');
    const result = await adapter.personTitles(id, libraryId, cursor);
    const images = await connection.images();
    const display = this.dateDisplay(libraryId);
    const items = result.items.map(item => withDateDisplay(entry(item, images, this.artWidth()), display));
    return { items, cursor: result.nextCursor };
  }
  private dateDisplay(id?: string): 'year' | 'date' {
    if (!id) return 'year';
    const state = this.box.get();
    return Object.values(state.library ?? {}).find(view => view.value?.id === id)?.value?.dateDisplay
      ?? state.libraries?.value?.find(library => library.id === id)?.dateDisplay ?? 'year';
  }

  async libraryLive(id: string, tab: string, search = '', filter = '', cursor?: string): Promise<LibraryLiveModel> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    const available = this.session.features?.libraryLive?.available === true;
    if (!available || !hasLibraryLive(adapter)) throw new Error('Library live is unavailable');
    const result = await adapter.libraryLive(id, { tab, query: search || undefined, filter: filter || undefined, cursor, limit: 50 });
    const images = await connection.images();
    return { items: result.items.map(item => libraryLiveCard(item, images, this.artWidth())), filters: result.filters,
      cursor: result.nextCursor ?? '', continuation: result.continuation };
  }
  /** Available before a library's asynchronous rows arrive. */
  get libraryRecommendationsAvailable(): boolean {
    try { return hasLibraryRecommendations(this.session.selected().adapter); }
    catch { return false; }
  }
  private readonly libraryReads = new Map<string, { pages: number; promise: Promise<void> }>();
  /** What each collection has read so far, and where the server said to continue. */
  private readonly collectionReads = new Map<string, { items: V.RowEntry[]; cursor?: string; continuation: string }>();
  /** Titles on screen whose answer was partial, read again until complete. */
  private readonly pending = new PendingTitles(id => void this.refreshTitle(id));

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
  ) {
    session.onReset(() => {
      this.libraryReads.clear();
      this.collectionReads.clear();
      this.pending.clear();
      this.box.update('titles', () => ({}));
      this.box.update('related', () => ({}));
      this.box.update('library', () => ({}));
      this.box.update('collections', () => ({}));
    });
  }

  /** A title's details, read once per session unless `refresh` asks again (after playback, say). */
  async title(id: string, refresh = false): Promise<void> {
    const known = this.box.get().titles[id];
    if (known && known.load !== 'failed' && !refresh) return;
    await this.read('titles', id, async connection => (await this.detail(connection, id)).model);
  }

  /**
   * A title page is on screen: its details are read, and a partial answer (parts the server is
   * still making) is read again in place until complete. Call the returned function when it leaves.
   */
  view(id: string): () => void {
    const release = this.pending.view(id);
    const known = this.box.get().titles[id];
    if (known?.load === 'ready') void this.refreshTitle(id);
    else void this.title(id);
    return release;
  }

  /** Read a title again in place: no loading state, and a failure keeps the page as drawn. */
  private async refreshTitle(id: string): Promise<void> {
    const epoch = this.session.epoch;
    try {
      const connection = await this.session.ready();
      const { model } = await this.detail(connection, id);
      if (epoch === this.session.epoch) this.box.update('titles', titles => ({ ...titles, [id]: ready(model) }));
    } catch {
      // The page keeps what it shows; a later read brings it up to date.
    }
  }

  /** One read of a title's details; a partial answer is followed while the title is on screen. */
  private async detail(connection: Connection, id: string): Promise<{ model: DetailModel; answer: V.TitleDetail }> {
    const [answer, capabilities] = await Promise.all([connection.adapter.detail(id), capabilitiesOf(connection.adapter)]);
    const images = await connection.images();
    const features = capabilities.features;
    const model = detailModel(
      answer,
      images,
      this.artWidth(),
      features.extraPlayback?.available === true,
      features.themeMusic?.available === true,
      hasPersonFilmography(connection.adapter),
    );
    this.pending.answered(id, answer);
    return { model, answer };
  }

  /** Where the viewer left a title, applied at once to every title page drawn that shows it. */
  watched(watched: Watched): void {
    this.box.update('titles', titles => {
      let changed = false;
      const next: typeof titles = {};
      for (const [id, known] of Object.entries(titles)) {
        const value = known.value;
        const shows = !!value && (id === watched.titleId || value.episodes.some(card => card.id === watched.titleId));
        next[id] = shows ? { ...known, value: detailWatched(value!, watched) } : known;
        changed ||= shows;
      }
      return changed ? next : titles;
    });
  }

  /**
   * Read every title page that shows the watched title again, in place. An answer that does not
   * yet record where the viewer left it keeps the page as drawn and is asked again (after 2, 4
   * and 8 seconds); after that the server's answer stands.
   */
  reconcile(watched: Watched, attempt = 0): void {
    for (const [id, known] of Object.entries(this.box.get().titles)) {
      const value = known.value;
      if (!value || !detailCard(value, watched.titleId)) continue;
      void this.reconcileTitle(id, watched, attempt);
    }
  }

  private async reconcileTitle(id: string, watched: Watched, attempt: number): Promise<void> {
    const epoch = this.session.epoch;
    try {
      const connection = await this.session.ready();
      const { model } = await this.detail(connection, id);
      if (epoch !== this.session.epoch) return;
      if (!recorded(detailCard(model, watched.titleId), watched) && attempt < RECONCILE_ATTEMPTS) {
        setTimeout(() => void this.reconcileTitle(id, watched, attempt + 1), 2000 * 2 ** attempt);
        return;
      }
      this.box.update('titles', titles => ({ ...titles, [id]: ready(model) }));
    } catch {
      // The page keeps what it shows; the next read brings it up to date.
    }
  }

  /** The rows the server relates to a title. */
  async related(id: string): Promise<void> {
    const known = this.box.get().related[id];
    if (known && known.load !== 'failed') return;
    await this.read('related', id, async connection => {
      const data = await connection.adapter.rows({ placement: 'detail', titleId: id });
      const images = await connection.images();
      return data.items.map(row => feedRow(row, images, this.artWidth()));
    });
  }

  /** Library-specific native server views. Ether v0 does not identify a library in RowsQuery. */
  /** A library's recommendations, collections and genres, read together. `onRows` has the
   * recommendations as soon as they arrive, so they show while the others are still read. */
  async libraryExtras(id: string, kind: V.Library['kind'], onRows?: (rows: LibraryExtras) => void, tab?: string, search?: string, freshRows = false): Promise<LibraryExtras | undefined> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!hasLibraryRecommendations(adapter)) return undefined;
    const images = connection.images();
    const reading = adapter.libraryRows(id, kind, freshRows);
    const display = this.dateDisplay(id);
    const row = (value: V.Row, sized: Images) => { const model = feedRow(value, sized, this.artWidth()); return { ...model, items: model.items.map(item => withDateDisplay(item, display)) }; };
    if (onRows) void Promise.all([reading, images]).then(([value, sized]) => onRows({
      recommendationsAvailable: true, collectionsAvailable: true, rows: value.map(value => row(value, sized)),
      rowsLoad: 'ready', collectionsLoad: 'loading', genresLoad: 'loading',
      collections: [], collectionCursor: '', genres: [], failed: false,
    }), () => {});
    const [rows, collections, genres] = await Promise.allSettled([reading, adapter.libraryCollections(id, undefined, tab, search), adapter.libraryGenres(id)]);
    return this.extras(rows, collections, genres, await images, display);
  }

  private extras(rows: PromiseSettledResult<V.Row[]>, collections: PromiseSettledResult<V.Page<V.RowEntry>>, genres: PromiseSettledResult<{ id: string; label: string }[]>, images: Images, display: 'year' | 'date'): LibraryExtras {
    return {
      rowsLoad: rows.status === 'fulfilled' ? 'ready' : 'failed',
      collectionsLoad: collections.status === 'fulfilled' ? 'ready' : 'failed',
      genresLoad: genres.status === 'fulfilled' ? 'ready' : 'failed',
      recommendationsAvailable: true,
      collectionsAvailable: true,
      rows: rows.status === 'fulfilled' ? rows.value.map(row => { const model = feedRow(row, images, this.artWidth()); return { ...model, items: model.items.map(item => withDateDisplay(item, display)) }; }) : [],
      collections: collections.status === 'fulfilled' ? collections.value.items.map(item => withDateDisplay(entry(item, images, this.artWidth()), display)) : [],
      collectionCursor: collections.status === 'fulfilled' ? collections.value.nextCursor ?? '' : '',
      genres: genres.status === 'fulfilled' ? genres.value : [],
      failed: [rows, collections, genres].some(result => result.status === 'rejected'),
    };
  }

  async moreLibraryCollections(id: string, cursor: string, tab?: string, search?: string): Promise<{ items: Card[]; cursor: string }> {
    const connection = await this.session.ready();
    if (!hasLibraryRecommendations(connection.adapter)) return { items: [], cursor: '' };
    const [page, images] = await Promise.all([connection.adapter.libraryCollections(id, cursor, tab, search), connection.images()]);
    return { items: page.items.map(item => withDateDisplay(entry(item, images, this.artWidth()), this.dateDisplay(id))), cursor: page.nextCursor ?? '' };
  }

  async moreLibraryRow(id: string, cursor: string, libraryId?: string): Promise<Row> {
    const connection = await this.session.ready();
    const data = await connection.adapter.row(id, cursor);
    const row = feedRow(data, await connection.images(), this.artWidth());
    const display = this.dateDisplay(libraryId);
    return { ...row, items: row.items.map(item => withDateDisplay(item, display)) };
  }

  /** One library view, `pages` pages deep (100 items a page). A background revisit
   * keeps a cached view ready, including if the refresh fails. Concurrent reads share work. */
  library(id: string, query: LibraryQuery = {}, pages = 1, background = false): Promise<void> {
    const key = libraryKey(id, query);
    const active = this.libraryReads.get(key);
    if (active) {
      if (pages <= active.pages) return active.promise;
      const epoch = this.session.epoch;
      return active.promise.then(() => epoch === this.session.epoch ? this.library(id, query, pages, background) : undefined);
    }
    const reading = this.read('library', key, async connection => {
      const api = connection.adapter;
      const browse: V.LibraryBrowseQuery = { ...query, limit: PAGE };
      let result = await api.library(id, browse);
      const items = [...result.items];
      const seen = new Set<string>();
      let read = 1;
      for (; read < Math.max(1, Math.floor(pages)) && result.continuation === 'more'; read++) {
        const cursor = result.nextCursor;
        if (!cursor || seen.has(cursor)) throw new Error('Invalid library continuation');
        seen.add(cursor);
        result = await api.library(id, { ...browse, cursor });
        items.push(...result.items);
      }
      if (result.continuation === 'more' && !result.nextCursor) throw new Error('Invalid library continuation');
      const images = await connection.images();
      const unique = [...new Map(items.map(item => [item.id, item])).values()];
      return { ...libraryModel(result, unique, read, query, images, this.artWidth()), canSearch: supportsLibraryBrowse(api, result.library) };
    }, background);
    this.libraryReads.set(key, { pages, promise: reading });
    void reading.finally(() => {
      if (this.libraryReads.get(key)?.promise === reading) this.libraryReads.delete(key);
    });
    return reading;
  }

  /** A collection's first page, or with `more` its next one, continued from the server's cursor. */
  async collection(id: string, more = false): Promise<void> {
    const known = this.box.get().collections[id];
    if (known?.load === 'loading' || (known?.load === 'ready' && !more)) return;
    const previous = more ? this.collectionReads.get(id) : undefined;
    if (more && previous?.continuation !== 'more') return;
    await this.read('collections', id, async connection => {
      const cursor = previous?.cursor;
      const data = await connection.adapter.collection(id, cursor, PAGE);
      if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) {
        throw new Error('Invalid collection continuation');
      }
      const items = [...(previous?.items ?? []), ...data.items];
      this.collectionReads.set(id, { items, cursor: data.nextCursor, continuation: data.continuation });
      const images = await connection.images();
      const seen = new Set<string>();
      const unique = items.filter(item => !seen.has(item.id) && !!seen.add(item.id));
      // Only an exhausted collection is complete; an unknown end is never presented as the whole.
      return {
        name: data.collection.name,
        items: unique.map(item => entry(item, images, this.artWidth())),
        more: data.continuation === 'more',
        complete: data.continuation === 'exhausted',
      };
    });
  }

  /** Read one keyed value into its slice, dropping the answer if the session moved on meanwhile. */
  private async read<K extends 'titles' | 'related' | 'library' | 'collections'>(
    slice: K,
    key: string,
    work: (connection: Connection) => Promise<SliceValue<K>>,
    background = false,
  ): Promise<void> {
    const epoch = this.session.epoch;
    const set = (value: Loadable<SliceValue<K>>) => {
      this.box.update(slice, map => ({ ...map, [key]: value }) as VelaState[K]);
    };
    const previous = this.box.get()[slice][key] as Loadable<SliceValue<K>> | undefined;
    const quiet = background && !!previous?.value;
    if (!quiet) set(loading(previous));
    try {
      const connection = await this.session.ready();
      const value = await work(connection);
      if (epoch === this.session.epoch) set(ready(value));
    } catch (error) {
      if (epoch === this.session.epoch && !quiet) set(failed(error, previous));
    }
  }
}

type SliceValue<K extends 'titles' | 'related' | 'library' | 'collections'> = {
  titles: DetailModel;
  related: Row[];
  library: LibraryModel;
  collections: CollectionModel;
}[K];

function libraryModel(
  result: V.LibraryContents,
  items: V.RowEntry[],
  pages: number,
  query: LibraryQuery,
  images: Images,
  artWidth: number,
): LibraryModel {
  const library = result.library;
  const filters = library.browse.filters;
  const image = library.artwork.find(a => a.kind === 'backdrop');
  const cards: Card[] = items.map(item => {
    const card = withDateDisplay(entry(item, images, artWidth), library.dateDisplay);
    return libraryCardArtwork(card, library.presentation?.card);
  });
  return {
    presentation: library.presentation,
    tabs: library.tabs,
    facets: filters.facets,
    query: query.query,
    facetFilters: query.facets,
    id: library.id,
    name: library.name,
    kind: library.kind,
    dateDisplay: library.dateDisplay ?? 'year',
    backdrop: image ? artworkURL(image, artWidth, Math.ceil(artWidth * 9 / 16), images) ?? '' : '',
    sorts: library.browse.sorts.map(s => ({ id: s.id, label: msg(`library.sort.${s.id}`), directions: s.directions })),
    sort: result.sort,
    direction: result.direction,
    kinds: (filters.kind ?? []).map(k => ({ id: k, label: msg(`library.kind.${k}`) })),
    genres: (filters.genre ? filters.genres ?? [] : []).map(g => ({ id: g, label: g })),
    kindFilter: query.kind ?? '',
    genreFilter: query.genre ?? '',
    playedFilter: query.played === undefined ? '' : String(query.played),
    favoriteFilter: query.favorite === true,
    yearFilter: query.year ?? 0,
    canYear: !!filters.year,
    canCollectionId: !!filters.collectionId,
    canPlayed: !!filters.played,
    canFavorite: !!filters.favorite,
    items: cards,
    more: result.continuation === 'more',
    pages,
  };
}
