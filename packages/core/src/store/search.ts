// Search: independent lanes for one query. The fast lane (titles by name, plus live channels and
// programmes) answers every keystroke; the descriptive lane ("films about a heist in Lisbon")
// starts once typing pauses, only on a server that offers it, and shows its answer once final.
// Each query is a new generation: answers for an older one are dropped. The AI discovery lane
// ("a little further afield") is not run: no surface shows it, and it stays idle.
import type * as V from '../wire';
import { hasDescriptiveSearch } from '../adapter/capabilities';
import { card } from '../discovery/models';
import { liveSearch } from '../live/search';
import { randomId } from '../protocol/id';
import type { Card } from '../models';
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
  generation: number;
  fast: SearchLane & { liveChannels: LiveChannelResult[]; liveProgrammes: LiveProgrammeResult[] };
  /** While the server is still working, it is asked again on its terms; after a failure it
   * allows retrying, `canRetry` turns true once its backoff has passed. */
  descriptive: SearchLane & { canRetry: boolean };
  ai: SearchLane;
}

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

export class Search {
  private controller = new AbortController();
  private pause: ReturnType<typeof setTimeout> | undefined;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  /**
   * Makes each generation's idempotency keys unique to this run and session. Generations restart
   * at 1 after a launch or sign-in, and a key the server has already seen with another query is
   * refused as reused ("heat" collided with an earlier launch's "inception" at generation 2).
   */
  private scope = randomId();

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
  ) {
    session.onReset(() => {
      this.controller.abort();
      this.stopTimers();
      this.scope = randomId();
      this.box.update('search', () => initialSearch);
    });
  }

  /** A new query: a new generation, with every lane started again. An empty query clears search. */
  setQuery(query: string): void {
    const previous = this.box.get().search;
    const generation = previous.generation + 1;
    this.controller.abort();
    this.controller = new AbortController();
    const caps = this.session.searchCapabilities;
    const options = this.options(previous, caps);
    this.stopTimers();
    const text = query.trim();
    if (!text) {
      this.box.update('search', () => ({ ...initialSearch, ...options, library: undefined, ...caps, query, generation }));
      return;
    }
    // A lane the server does not offer says so at once; one it offers is loading until typing pauses.
    const descriptive = this.offersDescriptive();
    this.box.update('search', () => ({
      ...options,
      ...caps,
      query,
      generation,
      fast: { ...initialSearch.fast, status: 'loading', error: '' },
      descriptive: { ...initialSearch.descriptive, status: descriptive ? 'loading' : 'unavailable' },
      ai: emptyLane,
    }));
    void this.fast(text, generation);
    if (!descriptive) return;
    this.pause = setTimeout(() => void this.descriptive(text, generation), PAUSE_MS);
  }

  /** Accept only advertised options, including a direction valid for the selected sort. */
  private options(value: V.SearchOptions, caps = this.session.searchCapabilities): V.SearchOptions {
    const sort = caps?.searchSorts?.find(s => s.id === value.sort) ?? caps?.searchSorts?.[0];
    return {
      ...(caps?.searchLibraries && this.box.get().libraries.value?.some(l => l.id === value.library) ? { library: value.library } : {}),
      ...(sort ? { sort: sort.id, ...(sort.directions.length ? { direction: sort.directions.includes(value.direction!) ? value.direction : sort.directions[0] } : {}) } : {}),
      ...(caps?.searchKinds?.some(k => (typeof k === 'string' ? k : k.id) === value.kind) ? { kind: value.kind } : {}),
    };
  }

  setOptions(change: V.SearchOptions): void {
    const state = this.box.get().search;
    const options = this.options({ ...state, ...change });
    if (state.sort === options.sort && state.direction === options.direction && state.kind === options.kind && state.library === options.library) return;
    this.box.update('search', s => ({ ...s, sort: undefined, direction: undefined, kind: undefined, library: undefined, ...options }));
    this.setQuery(state.query);
  }

  /** Each cursor belongs to its lane and generation. */
  more(lane: 'fast' | 'descriptive' = 'fast'): void {
    const state = this.box.get().search;
    if (!state[lane].nextCursor || state[lane].loadingMore) return;
    this.patch(lane, { loadingMore: true });
    if (lane === 'fast') void this.fast(state.query.trim(), state.generation, state.fast.nextCursor);
    else void this.descriptive(state.query.trim(), state.generation, state.descriptive.nextCursor);
  }

  /** The selected server offers descriptive search: stated in its features and implemented by its adapter. */
  private offersDescriptive(): boolean {
    return !!this.session.features?.descriptiveSearch.available && hasDescriptiveSearch(this.session.selected().adapter);
  }

  clear(): void {
    this.setQuery('');
  }

  private current(generation: number): boolean {
    return this.box.get().search.generation === generation;
  }

  private async fast(query: string, generation: number, cursor?: string): Promise<void> {
    try {
      const signal = this.controller.signal;
      const options = this.options(this.box.get().search);
      const connection = await this.session.ready();
      if (!this.current(generation) || signal.aborted) return;
      const result = await connection.adapter.search({ ...options, query, generation, cursor, idempotencyKey: cursor ? this.session.key() : `search-${this.scope}-${generation}` }, signal);
      const images = await connection.images();
      if (signal.aborted || !this.current(generation) || result.generation !== generation) return;
      const live = liveSearch(result.live, images, Date.now());
      const items = result.items.map(title => card(title, '', images, this.artWidth()));
      this.patch('fast', { status: 'ready', items: cursor ? [...this.box.get().search.fast.items, ...items] : items, nextCursor: result.nextCursor, loadingMore: false, error: '', ...live });
    } catch (error) {
      if (this.current(generation)) this.patch('fast', { loadingMore: false, status: 'failed', error: message(error) });
    }
  }

  private async descriptive(query: string, generation: number, cursor?: string): Promise<void> {
    try {
      const signal = this.controller.signal;
      const options = this.options(this.box.get().search);
      const connection = await this.session.ready();
      if (!this.current(generation) || signal.aborted) return;
      const api = connection.adapter;
      if (!this.session.features?.descriptiveSearch.available || !hasDescriptiveSearch(api)) {
        this.patch('descriptive', { status: 'unavailable' });
        return;
      }
      if (!cursor) this.patch('descriptive', { status: 'loading', canRetry: false });
      const result = await api.searchByDescription({ ...options, query, generation, cursor, idempotencyKey: this.session.key() }, signal);
      const images = await connection.images();
      if (signal.aborted || !this.current(generation) || result.generation !== generation) return;
      const items = result.items.map(title => card(title, '', images, this.artWidth()));
      this.patch('descriptive', { nextCursor: result.nextCursor, loadingMore: false });
      this.described(query, generation, result.descriptive, cursor ? [...this.box.get().search.descriptive.items, ...items] : items, cursor);
    } catch (error) {
      if (this.current(generation)) this.patch('descriptive', { loadingMore: false, status: 'failed', error: message(error), canRetry: false });
    }
  }

  /** The lane's honest state for an answer, asking again while the server keeps working and allows it. */
  private described(query: string, generation: number, state: V.DescriptiveSearchState | undefined, items: Card[], cursor?: string): void {
    const status = state?.state ?? 'ready';
    const allowed = state?.retry?.allowed === true;
    const wait = Math.max(1, Math.ceil(state?.retry?.afterSeconds ?? 1)) * 1000;
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

  /** Ask the descriptive lane again, once the server has allowed it. */
  retryDescriptive(): void {
    const { query, generation, descriptive } = this.box.get().search;
    if (query.trim() && descriptive.canRetry) void this.descriptive(query.trim(), generation);
  }

  private later(ms: number, generation: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.current(generation)) run();
    }, ms);
    this.timers.add(timer);
  }

  private stopTimers(): void {
    if (this.pause) clearTimeout(this.pause);
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.pause = undefined;
  }

  private patch<K extends 'fast' | 'descriptive'>(lane: K, change: Partial<SearchState[K]>): void {
    this.box.update('search', search => ({ ...search, [lane]: { ...search[lane], ...change } }));
  }
}
