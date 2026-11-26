// Search: lanes for one query, shown as one list (search-list.ts). The fast lane (titles by name,
// plus live channels and programmes) answers every keystroke; the descriptive lane ("films about a
// heist in Lisbon") is a fallback: it starts once typing pauses, only on a server that offers it,
// and only when the list will show it (the fast lane found no titles, or the query reads as a
// description that names none), and shows its answer once final. Each query is a new generation:
// answers for an older one are dropped. The AI discovery lane is not run and stays idle.
// A server offering unified search (features.unifiedSearch) ranks the one list itself: the fast
// lane asks it in `auto` mode, asks again while it reports slower lookups pending, and the list is
// its answer as-is; the descriptive lane is then not run by Vela.
import type * as V from '../wire';
import { capabilitiesOf } from '../adapter/advertise';
import { hasDescriptiveSearch, hasUnifiedSearch } from '../adapter/capabilities';
import type { Connection } from '../adapter/connection';
import type { ServerAdapter } from '../adapter';
import { card } from '../discovery/models';
import { liveSearch } from '../live/search';
import { randomId } from '../protocol/id';
import type { Card } from '../models';
import { resultKey, resultViewer, searchDeadline, searchServer, searchServers, SearchTimeout, type SearchSection } from './multi-search';
import { searchList, wantsDescription } from './search-list';
import type { Session } from './session';
import { message, type Load, type StateBox } from './state';
import type { VelaState } from './index';

type LiveResults = ReturnType<typeof liveSearch>;
export type LiveChannelResult = LiveResults['liveChannels'][number];
export type LiveProgrammeResult = LiveResults['liveProgrammes'][number];

export interface SearchLane {
  /** `unavailable` when the server does not offer this lane. The AI lane reports its job's own
   * states (`queued`, `running`, `partial`, `complete`, `cancelled`, `failed`). */
  status: Load | 'unavailable' | V.AISearchJob['status'];
  items: Card[];
  nextCursor?: string;
  loadingMore?: boolean;
  error: string;
}

export interface SearchState extends V.SearchOptions {
  searchSorts?: V.ServerCapabilities['searchSorts'];
  searchKinds?: V.SearchKindCapability[];
  searchLibraries?: boolean;
  query: string;
  sections?: SearchSection[];
  generation: number;
  fast: SearchLane & { liveChannels: LiveChannelResult[]; liveProgrammes: LiveProgrammeResult[] };
  /** While the server is still working, it is asked again on its terms; after a failure it
   * allows retrying, `canRetry` turns true once its backoff has passed. */
  descriptive: SearchLane & { canRetry: boolean };
  ai: SearchLane;
  /** Set only by a unified-search server's answer: its one ranked list (the fast lane) and what it
   * matched. The descriptive lane then reports the server's description matching, items-less. */
  match?: NonNullable<V.SearchResponse['match']>;
}

/** The state slices a search answers in: the app's search, and the audio app's own (musicSearch),
 * which runs beside it without touching the query the app's field and address show. */
export type SearchSlice = 'search' | 'musicSearch';

const emptyLane: SearchLane = { status: 'idle', items: [], error: '' };

export const initialSearch: SearchState = {
  query: '',
  generation: 0,
  fast: { ...emptyLane, liveChannels: [], liveProgrammes: [] },
  descriptive: { ...emptyLane, canRetry: false },
  ai: emptyLane,
};

/** How long typing must pause before the slower lanes start. */
const PAUSE_MS = 600;
/** How long after the last keystroke the title search is sent: one request per pause in typing,
 * not one per key. A superseded request is still cancelled. */
export const TYPING_MS = 180;
/** A unified server that keeps reporting slower lookups pending is asked again at most this often
 * per query; its last answer then stands. */
const MAX_REASKS = 20;

export class Search {
  private controller = new AbortController();
  private pause: ReturnType<typeof setTimeout> | undefined;
  /** The title search waiting for typing to pause. */
  private typing: ReturnType<typeof setTimeout> | undefined;
  /** Typing has paused on this generation: a description search may start. */
  private paused = 0;
  /** The generation a unified-search server answers (its pages and re-asks stay in `auto` mode). */
  private unifiedFor = 0;
  /** Re-asks of a pending unified answer for the current generation. */
  private reasks = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Makes each generation's idempotency keys unique to this run and session. Generations restart
   * at 1 after a launch or sign-in, and a key the server has already seen with another query is
   * refused as reused ("heat" collided with an earlier launch's "inception" at generation 2).
   */
  private scope = randomId();
  /** The library every query is kept to (scopeTo), where the server can restrict search to one. */
  private all = false;
  private openReturn?: { query: string; epoch: number; focus: string };
  private scoped: string | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
    /** The typing pause before a title search is sent (0 sends at once). */
    private readonly typingMs = TYPING_MS,
    /** The state slice it answers in: the app's search, or the audio app's (kept to one library). */
    private readonly slice: SearchSlice = 'search',
  ) {
    session.onReset(() => {
      this.controller.abort();
      this.all = false;
      this.openReturn = undefined;
      this.stopTimers();
      this.scope = randomId();
      this.box.update(this.slice, () => initialSearch);
    });
    if (slice === 'search') session.onServerSessionChange?.(id => {
      this.box.update('search', state => {
        const sections = state.sections?.filter(section => section.id !== id);
        return sections?.length !== state.sections?.length ? { ...state, sections } : state;
      });
    });
  }

  setAll(all: boolean): void {
    if (this.all === all) return;
    this.all = all;
    this.setQuery(this.box.get()[this.slice].query, true);
  }

  /** Validate the press against the live query and both stored identities before changing server. */
  async openResult(ref: string, open: (card: Card) => void): Promise<void> {
    const state = this.box.get().search;
    const section = state.sections?.find(group => group.results.some(result => result.ref === ref));
    const result = section?.results.find(result => result.ref === ref);
    if (!section || !result) return;
    try {
      const epoch = this.session.epoch;
      const source = this.session.selected();
      const target = this.session.connection(section.id);
      const [sourceTokens, targetTokens] = await Promise.all([this.session.tokens(source), this.session.tokens(target)]);
      const now = this.box.get();
      if (epoch !== this.session.epoch || source !== this.session.selected() || target !== this.session.connection(section.id)
        || now.auth.revision !== epoch || sourceTokens?.viewer.id !== now.auth.viewerId
        || !searchServers(now).some(server => server.id === section.id) || !resultViewer(result, targetTokens?.viewer)
        || !now.search.sections?.some(group => group.results.includes(result))) return;
      if (source !== target) {
        this.session.select(section.id);
        this.openReturn = { query: state.query, epoch: this.session.epoch, focus: resultKey(section.id, result) };
      }
      open(result.card);
    } catch { /* A server or session was removed while opening. */ }
  }

  /** The search screen calls this when it is visible again after opening a title. */
  returnToResults(): string | undefined {
    const saved = this.openReturn;
    const state = this.box.get();
    if (!saved || saved.epoch !== this.session.epoch || state.auth.revision !== saved.epoch || state.auth.phase !== 'signed-in') return;
    this.openReturn = undefined;
    this.all = true;
    this.setQuery(saved.query, true);
    return this.box.get().search.sections ? saved.focus : undefined;
  }

  serverPage(id: string): void {
    const state = this.box.get().search;
    const section = state.sections?.find(group => group.id === id);
    if (!section || section.status === 'loading' || (section.status === 'ready' && !section.nextCursor)) return;
    void this.searchSection(section, state.query.trim(), state.generation);
  }

  private async searchSection(section: SearchSection, query: string, generation: number): Promise<void> {
    const signal = this.controller.signal;
    const epoch = this.session.epoch;
    const patch = (change: Partial<SearchSection>) => {
      if (signal.aborted || this.session.epoch !== epoch || !this.current(generation)) return;
      this.box.update('search', state => ({ ...state, sections: state.sections?.map(group =>
        group.id === section.id ? { ...group, ...change } : group) }));
    };
    patch({ status: 'loading' });
    try {
      const connection = this.session.connection(section.id);
      const { page, images, viewer, policy } = await searchDeadline(signal, 5000, request =>
        searchServer(connection, query, generation, this.session.key(), section.nextCursor, request));
      if (this.session.connection(section.id) !== connection) return;
      if (section.results.some(result => result.viewer !== viewer || result.policy !== policy)) {
        patch({ status: 'failed', results: [], nextCursor: undefined });
        return;
      }
      const seen = new Set(section.results.map(result => resultKey(section.id, result)));
      const results = [...section.results];
      for (const title of page.items) {
        const result = { ref: randomId(), card: card(title, '', images, this.artWidth()), viewer, policy };
        const key = resultKey(section.id, result);
        if (!seen.has(key)) results.push(result);
        seen.add(key);
      }
      patch({ status: 'ready', results, nextCursor: page.nextCursor });
    } catch (error) {
      patch({ status: error instanceof SearchTimeout ? 'timed-out' : 'failed' });
    }
  }

  /** A new query: a new generation, with every lane started again. An empty query clears search.
   * Typed queries wait `typingMs` after the last keystroke; `immediate` (a changed filter) does not. */
  setQuery(query: string, immediate = false): void {
    const previous = this.box.get()[this.slice];
    const generation = previous.generation + 1;
    this.controller.abort();
    this.controller = new AbortController();
    const caps = this.session.searchCapabilities;
    const options = this.options(previous, caps);
    this.stopTimers();
    const text = query.trim();
    if (!text) {
      this.box.update(this.slice, () => ({ ...initialSearch, ...options, library: undefined, ...caps, query, generation }));
      return;
    }
    const current = this.box.get();
    const servers = this.slice === 'search' && this.all && !options.library
      && current.auth.revision === this.session.epoch ? searchServers(current) : [];
    if (servers.length >= 2) {
      const sections: SearchSection[] = servers.map(({ id, name, origin }) => ({
        id,
        name: servers.some(other => other.id !== id && other.name === name) ? `${name} · ${new URL(origin).host}` : name,
        status: 'loading',
        results: [],
      }));
      this.box.update('search', () => ({ ...initialSearch, ...options, ...caps, query, generation, sections }));
      const send = () => {
        this.typing = undefined;
        for (const section of sections) void this.searchSection(section, text, generation);
      };
      if (immediate || this.typingMs <= 0) send();
      else this.typing = setTimeout(send, this.typingMs);
      return;
    }
    this.all = false;
    // A lane the server does not offer says so at once; one it offers waits for typing to pause
    // and for the list to need it.
    const unified = this.offersUnified();
    const descriptive = !unified && this.offersDescriptive();
    this.box.update(this.slice, () => ({
      ...options,
      ...caps,
      query,
      generation,
      fast: { ...initialSearch.fast, status: 'loading', error: '' },
      descriptive: { ...initialSearch.descriptive, status: descriptive ? 'idle' : 'unavailable' },
      ai: emptyLane,
    }));
    if (immediate || this.typingMs <= 0) void this.fast(text, generation);
    else this.typing = setTimeout(() => { this.typing = undefined; void this.fast(text, generation); }, this.typingMs);
    this.reasks = 0;
    // Armed even when no description search is offered yet: the server's features may only be
    // known once the first page is asked (a search opened before home has loaded).
    this.pause = setTimeout(() => {
      this.pause = undefined;
      this.paused = generation;
      this.describeIfWanted(text, generation);
    }, PAUSE_MS + (immediate ? 0 : this.typingMs));
  }

  /** Start the description search once typing has paused, if the list will show it. */
  private describeIfWanted(query: string, generation: number): void {
    const state = this.box.get()[this.slice];
    if (this.paused !== generation || !this.current(generation) || state.descriptive.status !== 'idle') return;
    if (wantsDescription(query, state.fast)) void this.descriptive(query, generation);
  }

  /** Accept only advertised options, including a direction valid for the selected sort. */
  private options(value: V.SearchOptions, caps = this.session.searchCapabilities): V.SearchOptions {
    const library = this.scoped ?? value.library;
    const sort = caps?.searchSorts?.find(s => s.id === value.sort) ?? caps?.searchSorts?.[0];
    return {
      ...(caps?.searchLibraries && this.box.get().libraries.value?.some(l => l.id === library) ? { library } : {}),
      ...(sort ? { sort: sort.id, ...(sort.directions.length ? { direction: sort.directions.includes(value.direction!) ? value.direction : sort.directions[0] } : {}) } : {}),
      ...(caps?.searchKinds?.some(k => (typeof k === 'string' ? k : k.id) === value.kind) ? { kind: value.kind } : {}),
    };
  }

  setOptions(change: V.SearchOptions): void {
    const state = this.box.get()[this.slice];
    const options = this.options({ ...state, ...change });
    if (state.sort === options.sort && state.direction === options.direction && state.kind === options.kind && state.library === options.library) return;
    this.box.update(this.slice, s => ({ ...s, sort: undefined, direction: undefined, kind: undefined, library: undefined, ...options }));
    this.setQuery(state.query, true);
  }

  /** The list's next page, from the lane the list shows. Each cursor belongs to its lane and generation. */
  more(): void {
    const state = this.box.get()[this.slice];
    const lane = searchList(state).more;
    if (!lane) return;
    if (!state[lane].nextCursor || state[lane].loadingMore) return;
    this.patch(lane, { loadingMore: true });
    if (lane === 'fast') void this.fast(state.query.trim(), state.generation, state.fast.nextCursor);
    else void this.descriptive(state.query.trim(), state.generation, state.descriptive.nextCursor);
  }

  /**
   * Which lanes this generation runs, decided once its first page is asked, from the server's
   * features (asked for here when home has not loaded them yet): a unified server's one list, or
   * the fast lane with a description fallback where it is offered. Undefined when the query moved on.
   */
  private async lanes(api: ServerAdapter, generation: number, signal: AbortSignal): Promise<boolean | undefined> {
    const known = this.session.features;
    const fetched = known ? undefined : await capabilitiesOf(api).catch(() => undefined);
    const features = known ?? fetched?.features;
    if (signal.aborted || !this.current(generation)) return undefined;
    // The controls too, when home has not brought them yet (the request itself went without).
    if (fetched && !this.session.searchCapabilities) {
      const { searchSorts, searchKinds, searchLibraries } = fetched;
      this.box.update(this.slice, search => ({ ...search, searchSorts, searchKinds, searchLibraries }));
    }
    const unified = !!features?.unifiedSearch?.available && hasUnifiedSearch(api);
    const describes = !unified && !!features?.descriptiveSearch.available && hasDescriptiveSearch(api);
    this.unifiedFor = unified ? generation : 0;
    const status = this.box.get()[this.slice].descriptive.status;
    if (status === 'idle' || status === 'unavailable') this.patch('descriptive', { status: describes ? 'idle' : 'unavailable' });
    return unified;
  }

  /** The selected server ranks one list itself: stated in its features and implemented by its adapter. */
  private offersUnified(): boolean {
    return !!this.session.features?.unifiedSearch?.available && hasUnifiedSearch(this.session.selected().adapter);
  }

  /** The selected server offers descriptive search: stated in its features and implemented by its adapter. */
  private offersDescriptive(): boolean {
    return !!this.session.features?.descriptiveSearch.available && hasDescriptiveSearch(this.session.selected().adapter);
  }

  clear(): void {
    this.openReturn = undefined;
    this.setQuery('');
  }

  /**
   * Keep every query to one library (the audio app's search); `undefined` lets go. The scope is
   * asked for only where the server can restrict search (searchLibraries) to a library it lists;
   * elsewhere queries go unscoped and the state's `library` stays unset, so the view can tell and
   * keep to the library's own kinds itself. A changed scope starts the open query again.
   */
  scopeTo(library: string | undefined): void {
    if (this.scoped === library) return;
    this.scoped = library;
    const { query } = this.box.get()[this.slice];
    if (query.trim()) this.setQuery(query, true);
  }

  private current(generation: number): boolean {
    return this.box.get()[this.slice].generation === generation;
  }

  private async fast(query: string, generation: number, cursor?: string, again = false): Promise<void> {
    const epoch = this.session.epoch;
    const signal = this.controller.signal;
    let connection: Connection | undefined;
    try {
      connection = await this.session.ready();
      if (!this.current(generation) || signal.aborted) return;
      const api = connection.adapter;
      const unified = cursor || again ? this.unifiedFor === generation : await this.lanes(api, generation, signal);
      if (unified === undefined) return;
      // Read once the server's controls are known (lanes asks for them when home has not), so a
      // first query still goes scoped; the state says which library it went to.
      const asked = this.box.get()[this.slice];
      const options = this.options(asked, this.session.searchCapabilities ?? asked);
      if (this.box.get()[this.slice].library !== options.library) this.box.update(this.slice, search => ({ ...search, library: options.library }));
      // A first page is asked once per generation; asking again (a pending answer) is a new request.
      const idempotencyKey = cursor || again ? this.session.key() : `search-${this.scope}-${generation}`;
      const request = { ...options, query, generation, cursor, idempotencyKey };
      const result = await (unified && hasUnifiedSearch(api) ? api.searchAuto(request, signal) : api.search(request, signal));
      const images = await connection.images();
      if (signal.aborted || !this.current(generation) || result.generation !== generation) return;
      const live = liveSearch(result.live, images, Date.now());
      const dateDisplay = this.dateDisplay(options.library);
      const items = result.items.map(title => card({ ...title, dateDisplay: title.dateDisplay ?? (dateDisplay === 'date' ? 'date' : undefined) }, '', images, this.artWidth()));
      if (unified && !cursor) return this.ranked(query, generation, result, items, live);
      this.patch('fast', { status: 'ready', items: cursor ? [...this.box.get()[this.slice].fast.items, ...items] : items, nextCursor: result.nextCursor, loadingMore: false, error: '', ...live });
      if (!cursor) this.describeIfWanted(query, generation);
    } catch (error) {
      if (signal.aborted || epoch !== this.session.epoch || !this.current(generation)) return;
      if (connection && await this.session.relocatePlex?.(connection, epoch, error, signal)) return;
      if (!signal.aborted && epoch === this.session.epoch && this.current(generation)) {
        this.patch('fast', { loadingMore: false, status: 'failed', error: message(error) });
      }
    }
  }

  private async descriptive(query: string, generation: number, cursor?: string): Promise<void> {
    const epoch = this.session.epoch;
    const signal = this.controller.signal;
    let connection: Connection | undefined;
    try {
      const options = this.options(this.box.get()[this.slice]);
      connection = await this.session.ready();
      if (!this.current(generation) || signal.aborted) return;
      const api = connection.adapter;
      if (!hasDescriptiveSearch(api)) {
        this.patch('descriptive', { status: 'unavailable' });
        return;
      }
      if (!cursor) this.patch('descriptive', { status: 'loading', canRetry: false });
      const result = await api.searchByDescription({ ...options, query, generation, cursor, idempotencyKey: this.session.key() }, signal);
      const images = await connection.images();
      if (signal.aborted || !this.current(generation) || result.generation !== generation) return;
      const dateDisplay = this.dateDisplay(options.library);
      const items = result.items.map(title => card({ ...title, dateDisplay: title.dateDisplay ?? (dateDisplay === 'date' ? 'date' : undefined) }, '', images, this.artWidth()));
      this.patch('descriptive', { nextCursor: result.nextCursor, loadingMore: false });
      this.described(query, generation, result.descriptive, cursor ? [...this.box.get()[this.slice].descriptive.items, ...items] : items, cursor);
    } catch (error) {
      if (signal.aborted || epoch !== this.session.epoch || !this.current(generation)) return;
      if (connection && await this.session.relocatePlex?.(connection, epoch, error, signal)) return;
      if (!signal.aborted && epoch === this.session.epoch && this.current(generation)) {
        this.patch('descriptive', { loadingMore: false, status: 'failed', error: message(error), canRetry: false });
      }
    }
  }

  /**
   * A unified-search server's first page: the one list as it ranked it. While slower lookups are
   * pending it is asked again on its terms and the list replaced. Meanwhile the list already shows
   * when it has titles and no description matching is still running (remote catalogue items only
   * join its end); otherwise it stays loading, so description matches never replace a list shown.
   */
  private ranked(query: string, generation: number, result: V.SearchResponse, items: Card[], live: Pick<SearchState['fast'], 'liveChannels' | 'liveProgrammes'>): void {
    const retry = result.retry;
    const pending = result.state === 'pending' && retry?.allowed === true && this.reasks < MAX_REASKS;
    const described = result.descriptive?.state;
    const describing = described === 'pending' || described === 'busy' || described === 'partial';
    const hold = pending && (items.length === 0 || describing);
    const shown = this.box.get()[this.slice].fast.status === 'ready';
    if (!hold || !shown) {
      this.box.update(this.slice, search => ({
        ...search,
        match: hold ? search.match : result.match ?? (items.length ? 'title' : 'none'),
        fast: hold
          ? { ...search.fast, status: 'loading', error: '' }
          : { ...search.fast, status: 'ready', items, nextCursor: result.nextCursor, loadingMore: false, error: '', ...live },
      }));
    }
    // The description side, as the list's note and retry read it: no items of its own.
    if (!described) this.patch('descriptive', { status: 'unavailable', canRetry: false });
    else if (pending && describing) this.patch('descriptive', { status: 'loading', canRetry: false });
    else if (described === 'failed' || (describing && !result.descriptive?.retry?.allowed)) {
      this.patch('descriptive', { status: 'failed', canRetry: false });
      if (result.descriptive?.retry?.allowed) this.later(this.wait(result.descriptive.retry), generation, () => this.patch('descriptive', { canRetry: true }));
    } else this.patch('descriptive', { status: 'ready', canRetry: false });
    if (pending) {
      this.reasks++;
      this.later(this.wait(retry), generation, () => void this.fast(query, generation, undefined, true));
    }
  }

  private wait(retry: { afterSeconds?: number } | undefined): number {
    return Math.max(1, Math.ceil(retry?.afterSeconds ?? 1)) * 1000;
  }

  /** The lane's honest state for an answer, asking again while the server keeps working and allows it. */
  private described(query: string, generation: number, state: V.DescriptiveSearchState | undefined, items: Card[], cursor?: string): void {
    const status = state?.state ?? 'ready';
    const allowed = state?.retry?.allowed === true;
    const wait = this.wait(state?.retry);
    const still = status === 'pending' || status === 'busy';
    if (status === 'failed' || (still && !allowed)) {
      this.patch('descriptive', { status: 'failed', items, error: '', canRetry: false });
      if (allowed) this.later(wait, generation, () => this.patch('descriptive', { canRetry: true }));
      return;
    }
    // While the server keeps working and will be asked again, the lane keeps waiting rather than
    // showing each partial answer in turn; the final answer (or the last one allowed) shows once.
    const more = (still || status === 'partial') && allowed;
    if (more) this.patch('descriptive', { status: 'loading', error: '', canRetry: false });
    else this.patch('descriptive', { status: 'ready', items, error: '', canRetry: false });
    if (more) this.later(wait, generation, () => void this.descriptive(query, generation, cursor));
  }

  /** Ask the descriptive lane again, once the server has allowed it (a unified server: the whole list). */
  retryDescriptive(): void {
    const { query, generation, descriptive, match } = this.box.get()[this.slice];
    if (!query.trim() || !descriptive.canRetry) return;
    if (match !== undefined) {
      this.patch('descriptive', { status: 'loading', canRetry: false });
      void this.fast(query.trim(), generation, undefined, true);
    } else void this.descriptive(query.trim(), generation);
  }

  private later(ms: number, generation: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.current(generation)) run();
    }, ms);
    this.timers.add(timer);
  }

  private dateDisplay(library: string | undefined): 'year' | 'date' {
    return this.box.get().libraries.value?.find(item => item.id === library)?.dateDisplay ?? 'year';
  }

  private stopTimers(): void {
    if (this.pause) clearTimeout(this.pause);
    if (this.typing) clearTimeout(this.typing);
    this.typing = undefined;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pause = undefined;
  }

  private patch<K extends 'fast' | 'descriptive'>(lane: K, change: Partial<SearchState[K]>): void {
    this.box.update(this.slice, search => ({ ...search, [lane]: { ...search[lane], ...change } }));
  }
}
