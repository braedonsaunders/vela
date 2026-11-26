// The catalogue beyond home: a title's details and related rows, a library browsed with a sort
// and filters, and a collection read page by page. Each is kept by key for the current session
// and dropped when the session or server changes.
import type * as V from '../wire';
import { mediaClass } from '../media';
import { libraryCardArtwork } from '../library-presentation';
import { pluginLevelsOf, type PluginLevels } from '../plugin-levels';
import { VelaError } from '../adapter/errors';
import { hasTitleManagement } from '../adapter/capabilities';
import { capabilitiesOf } from '../adapter/advertise';
import { hasLibraryFacets, hasLibraryJumpIndex, supportsLibraryBrowse, hasLibraryLive, hasLibraryRecommendations, hasPersonFilmography, hasVersions } from '../adapter/capabilities';
import { personDates } from '../discovery/person-date';
import { artworkURL, type Images } from '../discovery/artwork';
import { detailModel, entry, feedRow, libraryLiveCard, withDateDisplay } from '../discovery/models';
import { detailCard, detailWatched, recorded, type Watched } from '../discovery/progress';
import type { Card, Choice, CollectionModel, DetailModel, LibraryJumpBucket, LibraryLiveModel, LibraryModel, Row } from '../models';
import type { Connection } from '../adapter/connection';
import { msg } from '../i18n';
import { Lane } from './lane';
import { PendingTitles } from './pending';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';
import { optimisticWatchState, watchRow } from './watch-state';
import { readRetryDelay, withReadRetry, type ReadRetryOptions } from './read-retry';

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
  /** Zero-based starting offset for a letter-jumped library window (absent or 0 from the start). */
  start?: number;
  /** Titles per page, when the view asks other than 100 (the music app's albums asks 50). */
  limit?: number;
}

function normalizedStart(start: number | undefined): number | undefined {
  return typeof start === 'number' && Number.isSafeInteger(start) && start > 0 ? start : undefined;
}

/** The key a library view is kept under in state (`state.library`). */
export function libraryKey(id: string, query: LibraryQuery): string {
  const { tab, sort, direction, kind, genre, year, played, favorite, collectionId, limit } = query;
  const start = normalizedStart(query.start);
  const facets = Object.entries(query.facets ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([field, values]) => [field, [...new Set(values)].sort()]);
  const key = [id, tab, sort, direction, kind, genre, year, played, favorite, collectionId, query.query, facets];
  if (limit !== undefined || start !== undefined) key.push(limit);
  if (start !== undefined) key.push(start);
  return JSON.stringify(key);
}

const PAGE = 100;
/** Reads of a title page after watching, before the server's answer stands as it is. */
const RECONCILE_ATTEMPTS = 3;

export class Catalogue {
  async titleVersions(id: string): Promise<V.TitleVersions | null> {
    const connection = await this.session.ready();
    const capabilities = await capabilitiesOf(connection.adapter);
    return capabilities.features.versions?.available === true && hasVersions(connection.adapter)
      ? connection.adapter.titleVersions(id) : null;
  }
  async clearVersionChoice(id: string, scope: 'all' | 'title' | 'show' = 'all'): Promise<V.ClearVersionChoiceResponse> {
    const api = (await this.session.ready()).adapter;
    if (!hasVersions(api)) throw new Error('Versions are unavailable');
    return api.clearVersionChoice(id, { scope, idempotencyKey: this.session.key() });
  }
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
      // A library's recommended rows (a plugin library's Continue watching, say) live outside the
      // store: patch the held answers at once, and let any library on show read its rows again.
      if (change.played !== undefined || change.continueWatching === false) {
        for (const [key, held] of this.partsHeld) {
          if (!key.startsWith('rows') || !Array.isArray(held.value)) continue;
          this.partsHeld.set(key, { ...held, value: (held.value as Row[]).map(item => watchRow(item, id, change)) });
        }
        this.box.update('home', home => ({ ...home, progressRevision: home.progressRevision + 1 }));
      }
    } catch (error) {
      // A removal has no card left to map back into the row, so restore the captured immutable
      // snapshot rather than trying to synthesize an inverse mutation.
      this.box.replace(before);
      throw new Error(msg('cardMenu.actionFailed'), { cause: error });
    }
  }

  async libraryFacets(id: string, field: string, query = '', cursor?: string, signal?: AbortSignal): Promise<V.Page<V.FacetValue>> {
    const adapter = (await this.session.ready()).adapter;
    if (!hasLibraryFacets(adapter)) throw new Error('Library facets are unavailable');
    return this.retrying(() => adapter.libraryFacets(id, field, query, cursor), signal);
  }
  async personDetails(id: string): Promise<{ name: string; portrait: string; knownFor: string; biography: string; birthday: string } | undefined> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!('personDetails' in adapter) || typeof adapter.personDetails !== 'function') return undefined;
    const person = await adapter.personDetails(id) as V.PersonDetail;
    const images = await connection.images();
    return { name: person.name, portrait: person.photo ? artworkURL(person.photo, 480, 480, images) ?? '' : '', knownFor: person.knownFor || person.roles?.[0] || '', biography: person.biography ?? '', birthday: personDates(person.birthday, person.deathday ?? person.deathDate) };
  }
  /** A person's titles, in a library's scope when `libraryId` names one: that library's dates and
   * card shape (a landscape library's thumbnails), as its own pages draw them. */
  async personTitles(id: string | undefined, libraryId?: string, cursor?: string, signal?: AbortSignal): Promise<{ items: Card[]; cursor?: string }> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    if (!id || !hasPersonFilmography(adapter)) throw new Error('Person filmography is unavailable');
    const result = await this.retrying(() => adapter.personTitles(id, libraryId, cursor), signal);
    const images = await connection.images();
    const display = this.dateDisplay(libraryId);
    const card = this.libraryPresentation(libraryId)?.card;
    const items = result.items.map(item => libraryCardArtwork(withDateDisplay(entry(item, images, this.artWidth()), display), card));
    return { items, cursor: result.nextCursor };
  }
  private dateDisplay(id?: string): 'year' | 'date' {
    if (!id) return 'year';
    const state = this.box.get();
    return Object.values(state.library ?? {}).find(view => view.value?.id === id)?.value?.dateDisplay
      ?? state.libraries?.value?.find(library => library.id === id)?.dateDisplay ?? 'year';
  }
  /** What the session knows of a library (its kind, media and declared card shape), from a view
   * of it already read or the server's library list. */
  libraryScope(id?: string): LibraryScope | undefined {
    if (!id) return undefined;
    const state = this.box.get();
    const known = Object.values(state.library ?? {}).find(view => view.value?.id === id)?.value
      ?? state.libraries?.value?.find(library => library.id === id);
    return known ? { kind: known.kind, media: known.media, presentation: known.presentation } : undefined;
  }
  private libraryPresentation(id?: string): V.Library['presentation'] | undefined {
    return this.libraryScope(id)?.presentation;
  }
  /** A read asked again while the server calls its refusal temporary (read-retry.ts), never
   * after the session moved on or the reader aborted. */
  private retrying<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const epoch = this.session.epoch;
    return withReadRetry(read, { ...this.retryOptions, signal, wanted: () => epoch === this.session.epoch });
  }

  async libraryLive(id: string, tab: string, search = '', filter = '', cursor?: string, signal?: AbortSignal): Promise<LibraryLiveModel> {
    const connection = await this.session.ready();
    const adapter = connection.adapter;
    const available = this.session.features?.libraryLive?.available === true;
    if (!available || !hasLibraryLive(adapter)) throw new Error('Library live is unavailable');
    const result = await this.retrying(() => adapter.libraryLive(id, { tab, query: search || undefined, filter: filter || undefined, cursor, limit: 50 }), signal);
    const images = await connection.images();
    return { items: result.items.map(item => libraryLiveCard(item, images, this.artWidth())), filters: result.filters,
      cursor: result.nextCursor ?? '', continuation: result.continuation };
  }
  /** Available before a library's asynchronous rows arrive. */
  get libraryRecommendationsAvailable(): boolean {
    try { return hasLibraryRecommendations(this.session.selected().adapter); }
    catch { return false; }
  }
  /** Whether the selected adapter can supply first-character jump buckets for a title-sorted library. */
  get libraryJumpIndexAvailable(): boolean {
    try { return hasLibraryJumpIndex(this.session.selected().adapter); }
    catch { return false; }
  }
  private readonly libraryReads = new Map<string, { pages: number; promise: Promise<void> }>();
  /** Each library part's last answer in this session (a few dozen at most), so a section drawn
   * again or prefetched shows it at once. Recommendations carry the progress revision they were
   * read at; collections, genres and jump indices stand for the session unless the viewer asks again. */
  private readonly partsHeld = new Map<string, { epoch: number; progressRevision: number; value: unknown }>();
  /** Part reads in flight, shared by a prefetch and the page that then opens. A shared read stops
   * retrying only once every reader that joined it has left (`join`). */
  private readonly partReads = new Map<string, { epoch: number; progressRevision: number; promise: Promise<unknown>; join(signal?: AbortSignal): boolean }>();
  /** Collections are a side read some servers answer in tens of seconds: they wait in a lane of
   * their own, so they never hold every connection to the server (lane.ts). */
  private readonly sideLane = new Lane(SIDE_READS);

  /** The server answers a recommended tab's own rows (features.pluginLevels.tabRows). */
  get libraryTabRowsAvailable(): boolean {
    return pluginLevelsOf(this.session.features).tabRows;
  }
  /** A tab's own card shapes its rows and items (features.pluginLevels). */
  get libraryTabCardsAvailable(): boolean {
    return pluginLevelsOf(this.session.features).tabCards;
  }
  /** Every plugin-level flag as the session knows it now (pages follow bootstrap's: settledPluginLevels). */
  pluginLevels(): PluginLevels {
    return pluginLevelsOf(this.session.features);
  }
  /** The session's last recommendations for a library (or one recommended tab, recommendationTab()),
   * with the progress revision they were read at. */
  cachedLibraryRecommendations(id: string, tab?: string): { progressRevision: number; value: Row[] } | undefined {
    return this.heldPart<Row[]>(partKey('rows', id, this.rowsTab(tab)));
  }
  /** A tab is sent, and keys the rows, only when the server answers tab rows. */
  private rowsTab(tab: string | undefined): string | undefined {
    return tab && this.libraryTabRowsAvailable ? tab : undefined;
  }
  /** The session's first page of a library's collections (or people) for a tab and search. */
  cachedLibraryCollections(id: string, tab?: string, search?: string): CollectionPage | undefined {
    return this.heldPart<CollectionPage>(partKey('collections', id, tab, search))?.value;
  }
  /** The session's genres for a library. */
  cachedLibraryGenres(id: string): Choice[] | undefined {
    return this.heldPart<Choice[]>(partKey('genres', id))?.value;
  }
  /** The session's first-character jump buckets for a library. */
  cachedLibraryJumpIndex(id: string): LibraryJumpBucket[] | undefined {
    return this.heldPart<LibraryJumpBucket[]>(partKey('jump', id))?.value;
  }
  private heldPart<T>(key: string): { progressRevision: number; value: T } | undefined {
    const held = this.partsHeld.get(key);
    return held && held.epoch === this.session.epoch ? held as { progressRevision: number; value: T } : undefined;
  }
  private readonly librarySnapshots = new Map<string, { cursor?: string; seen: Set<string>; indices: Map<string, number> }>();
  /** What each collection has read so far, and where the server said to continue. */
  private readonly collectionReads = new Map<string, { items: V.RowEntry[]; cursor?: string; continuation: string }>();
  /** Titles on screen whose answer was partial, read again until complete. */
  private readonly pending = new PendingTitles(id => void this.refreshTitle(id));

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
    private readonly retryOptions: Pick<ReadRetryOptions, 'sleep'> = {},
  ) {
    session.onReset(() => {
      this.libraryReads.clear();
      this.librarySnapshots.clear();
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
    const answer = await this.titleDetail(connection, id);
    // Capability decoration is secondary metadata. A temporary describe failure must not discard
    // a complete title answer that is already available.
    const capabilities = await capabilitiesOf(connection.adapter).catch(() => ({ features: this.session.features ?? {} } as V.ServerCapabilities));
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

  private titleDetail(connection: Connection, id: string): Promise<V.TitleDetail> {
    return this.retrying(() => connection.adapter.detail(id));
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
      const data = await this.retrying(() => connection.adapter.rows({ placement: 'detail', titleId: id }));
      const images = await connection.images();
      return data.items.map(row => feedRow(row, images, this.artWidth()));
    });
  }

  /**
   * A library's recommended rows on their own: a view shows them as soon as they arrive, never
   * waiting on its collections or genres. Undefined when the server has no library views. One
   * read serves a prefetch and the page that opens; the answer is held for the session at the
   * progress revision it was read at.
   */
  async libraryRecommendations(id: string, kind: V.Library['kind'], freshRows = false, tab?: string, signal?: AbortSignal): Promise<Row[] | undefined> {
    const progressRevision = this.box.get().home?.progressRevision ?? 0;
    const rowsTab = this.rowsTab(tab);
    return this.part('rows', partKey('rows', id, rowsTab), progressRevision, false, signal, async (connection, shared) => {
      const adapter = connection.adapter;
      if (!hasLibraryRecommendations(adapter)) return undefined;
      const [value, images] = await Promise.all([
        this.retrying(() => rowsTab ? adapter.libraryRows(id, kind, freshRows, rowsTab) : adapter.libraryRows(id, kind, freshRows), shared),
        connection.images(),
      ]);
      const display = this.dateDisplay(id);
      return value.map(row => { const model = feedRow(row, images, this.artWidth()); return { ...model, items: model.items.map(item => withDateDisplay(item, display)) }; });
    });
  }

  /**
   * The first page of a library's collections (or a people tab), read only when a view shows
   * them, in the side lane. Held for the session: progress never changes them, so they are read
   * again only when `refresh` asks (the viewer's Try again). A server still preparing the view
   * (503, retry allowed) is asked again on its terms while the view stays loading; the lane's
   * place is given up while waiting.
   */
  async libraryCollectionPage(id: string, tab?: string, search?: string, refresh = false, signal?: AbortSignal): Promise<CollectionPage | undefined> {
    return this.part('collections', partKey('collections', id, tab, search), 0, refresh, signal, async (connection, shared) => {
      const adapter = connection.adapter;
      if (!hasLibraryRecommendations(adapter)) return undefined;
      const [page, images] = await Promise.all([this.retrying(() => this.sideLane.run(() => adapter.libraryCollections(id, undefined, tab, search)), shared), connection.images()]);
      const display = this.dateDisplay(id);
      return { items: page.items.map(item => withDateDisplay(entry(item, images, this.artWidth()), display)), cursor: page.nextCursor ?? '' };
    });
  }

  /** A library's genres, read when a view lists them and held for the session. */
  async libraryGenreChoices(id: string, refresh = false, signal?: AbortSignal): Promise<Choice[] | undefined> {
    return this.part('genres', partKey('genres', id), 0, refresh, signal, async (connection, shared) => {
      const adapter = connection.adapter;
      return hasLibraryRecommendations(adapter) ? this.retrying(() => adapter.libraryGenres(id), shared) : undefined;
    });
  }

  /** A library's first-character jump buckets for title-ascending browsing, held for the session. */
  async libraryJumpIndex(id: string, refresh = false, signal?: AbortSignal): Promise<LibraryJumpBucket[] | undefined> {
    return this.part('jump', partKey('jump', id), 0, refresh, signal, async (connection, shared) => {
      const adapter = connection.adapter;
      return hasLibraryJumpIndex(adapter)
        ? this.retrying(() => adapter.libraryJumpIndex(id, { sort: 'title', direction: 'asc' }), shared)
        : undefined;
    });
  }

  /** One part read, shared while in flight and held once answered. A failure is not held. The
   * read's own signal aborts (no further retry) once every reader's `signal` has; a reader
   * without one keeps it going. */
  private async part<T>(name: 'rows' | 'collections' | 'genres' | 'jump', key: string, progressRevision: number, refresh: boolean, signal: AbortSignal | undefined,
    work: (connection: Connection, signal: AbortSignal) => Promise<T | undefined>): Promise<T | undefined> {
    const epoch = this.session.epoch;
    const held = this.heldPart<T>(key);
    if (held && !refresh && (name !== 'rows' || held.progressRevision === progressRevision)) return held.value;
    const shared = this.partReads.get(key);
    if (shared && shared.epoch === epoch && shared.progressRevision === progressRevision && shared.join(signal)) return shared.promise as Promise<T | undefined>;
    const controller = new AbortController();
    let readers = 0;
    const join = (reader?: AbortSignal) => {
      if (controller.signal.aborted || reader?.aborted) return false;
      if (!reader) { readers = Infinity; return true; }
      readers++;
      reader.addEventListener('abort', () => { if (--readers <= 0) controller.abort(reader.reason); }, { once: true });
      return true;
    };
    signal?.throwIfAborted();
    join(signal);
    const promise = (async () => work(await this.session.ready(), controller.signal))();
    this.partReads.set(key, { epoch, progressRevision, promise, join });
    try {
      const value = await promise;
      if (value !== undefined && epoch === this.session.epoch) {
        this.partsHeld.delete(key);
        this.partsHeld.set(key, { epoch, progressRevision, value });
        for (const old of this.partsHeld.keys()) { if (this.partsHeld.size <= PARTS_HELD) break; this.partsHeld.delete(old); }
      }
      return value;
    } finally {
      if (this.partReads.get(key)?.promise === promise) this.partReads.delete(key);
    }
  }

  async moreLibraryCollections(id: string, cursor: string, tab?: string, search?: string, signal?: AbortSignal): Promise<{ items: Card[]; cursor: string }> {
    const connection = await this.session.ready();
    if (!hasLibraryRecommendations(connection.adapter)) return { items: [], cursor: '' };
    const adapter = connection.adapter;
    const [page, images] = await Promise.all([this.retrying(() => this.sideLane.run(() => adapter.libraryCollections(id, cursor, tab, search)), signal), connection.images()]);
    return { items: page.items.map(item => withDateDisplay(entry(item, images, this.artWidth()), this.dateDisplay(id))), cursor: page.nextCursor ?? '' };
  }

  async moreLibraryRow(id: string, cursor: string, libraryId?: string): Promise<Row> {
    const connection = await this.session.ready();
    const data = await this.retrying(() => connection.adapter.row(id, cursor));
    const row = feedRow(data, await connection.images(), this.artWidth());
    const display = this.dateDisplay(libraryId);
    return { ...row, items: row.items.map(item => withDateDisplay(item, display)) };
  }

  /** One library view, `pages` pages deep (100 items a page, or the query's `limit`). A background revisit
   * keeps a cached view ready, including if the refresh fails. Concurrent reads share work. */
  library(id: string, query: LibraryQuery = {}, pages = 1, background = false): Promise<void> {
    const key = libraryKey(id, query);
    const active = this.libraryReads.get(key);
    if (active) {
      if (pages <= active.pages) return active.promise;
      const epoch = this.session.epoch;
      return active.promise.then(() => epoch === this.session.epoch ? this.library(id, query, pages, background) : undefined);
    }
    const epoch = this.session.epoch;
    const held = this.box.get().library[key]?.value;
    const snapshot = this.librarySnapshots.get(key);
    const extend = !background && held && held.pages < pages && snapshot?.cursor ? { held, snapshot } : undefined;
    const reading = this.read('library', key, async connection => {
      const api = connection.adapter;
      const { start, ...browseQuery } = query;
      const startOffset = normalizedStart(start);
      const browse: V.LibraryBrowseQuery = { ...browseQuery, limit: browseQuery.limit ?? PAGE };
      const load = async (previous: typeof extend, fresh: boolean) => {
        const seen = new Set(previous?.snapshot.seen);
        const entries = new Map<string, V.RowEntry>();
        let cursor = previous?.snapshot.cursor ?? (startOffset !== undefined ? String(startOffset) : undefined);
        let read = previous?.held.pages ?? 0;
        let result: V.LibraryContents;
        do {
          if (cursor && seen.has(cursor)) throw new Error('Invalid library continuation');
          if (cursor) seen.add(cursor);
          const page = cursor;
          result = await this.retrying(() => api.library(id, { ...browse, cursor: page }, { snapshot: true, fresh }));
          for (const item of result.items) entries.set(item.id, item);
          read++;
          cursor = result.continuation === 'more' ? result.nextCursor : undefined;
          if (result.continuation === 'more' && (!cursor || seen.has(cursor))) throw new Error('Invalid library continuation');
        } while (cursor && read < Math.max(1, Math.floor(pages)));

        const images = await connection.images();
        const model = libraryModel(result, [...entries.values()], read, query, images, this.artWidth());
        const cards = [...(previous?.held.items ?? [])];
        const indices = new Map(previous?.snapshot.indices);
        let index = 0;
        for (const id of entries.keys()) {
          const position = indices.get(id) ?? cards.length;
          indices.set(id, position);
          cards[position] = model.items[index++]!;
        }
        if (epoch === this.session.epoch) this.librarySnapshots.set(key, { cursor, seen, indices });
        return { ...model, items: cards, canSearch: supportsLibraryBrowse(api, result.library) };
      };
      try {
        return await load(extend, false);
      } catch (error) {
        if (!(error instanceof VelaError && error.status === 409 && error.detail.code === 'cursor_expired')
          || epoch !== this.session.epoch) throw error;
        return load(undefined, true);
      }
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
      const data = await this.retrying(() => connection.adapter.collection(id, cursor, PAGE));
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

/** Retry only protocol-declared temporary title reads (read-retry.ts). */
export const titleRetryDelay = readRetryDelay;

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
  const media = mediaClass(library.media);
  const startOffset = normalizedStart(query.start);
  return {
    presentation: library.presentation ?? (media === 'music' || media === 'audiobook' || media === 'podcast' ? { card: 'square' } : undefined),
    media,
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
    ...(Number.isSafeInteger(result.total) && result.total! >= 0 ? { total: result.total } : {}),
    ...(startOffset ? { startOffset } : {}),
    pages,
  };
}

/** A library as a page scoped to it (a person opened from it) needs it. */
export interface LibraryScope { kind: string; media?: V.MediaClass; presentation?: V.Library['presentation'] }

/**
 * The i18n keys heading a person's movie-kind and other titles on a page in a library's scope.
 * Only a video library of posters holds movies and TV shows: a landscape (or square) library of
 * movie-kind items holds clips, scenes or home videos, and a book or audio library holds books;
 * their titles are just "Titles". A movies library never calls its titles TV shows, nor a shows
 * library its titles movies. Without a library, "Movies" and "TV Shows".
 */
export function personSectionLabels(scope: LibraryScope | undefined): { movies: string; tv: string } {
  if (!scope) return { movies: 'person.movies', tv: 'person.tvShows' };
  const video = (scope.media ?? 'video') === 'video' && (scope.presentation?.card ?? 'poster') === 'poster';
  return {
    movies: video && scope.kind !== 'shows' ? 'person.movies' : 'person.titles',
    tv: video && scope.kind !== 'movies' ? 'person.tvShows' : 'person.titles',
  };
}

/** A library's collections page: its cards and the server's cursor for the next ('' at the end). */
export interface CollectionPage { items: Card[]; cursor: string }

const PARTS_HELD = 48;
/** Collections reads running at once; more wait in the side lane. */
const SIDE_READS = 2;
function partKey(part: 'rows' | 'collections' | 'genres' | 'jump', id: string, tab?: string, search?: string): string {
  if (part === 'collections') return `${part}\u0000${id}\u0000${tab ?? ''}\u0000${search ?? ''}`;
  // Rows: one key per recommended tab that has its own (recommendationTab()); the library's own otherwise.
  return part === 'rows' && tab ? `${part}\u0000${id}\u0000${tab}` : `${part}\u0000${id}`;
}
