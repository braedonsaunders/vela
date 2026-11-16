// The open query's search, until packages/core's search generations replace it: each query is
// a new generation, and an answer for an older one is dropped. The fast lane brings titles by
// name and live hits; the descriptive lane (when the server offers it) asks again while the
// server is still working and allows it, and keeps what a failed answer found. Discovery (AI
// search) reads `off` here: the spike's client does not run its jobs.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { SearchResponse, Title } from '../../../protocol/v0/types';
import { card, liveSearch, type Images } from '@vela/core';
import type { DescriptiveLane, SearchView } from '../../../packages/skin/src/widgets/search/model';

/** Where answers come from: the server's search, by mode. */
export interface SearchSource {
  search(query: string, generation: number, mode: 'fast' | 'descriptive'): Promise<SearchResponse>;
}

export interface SearchOptions {
  /** The server offers descriptive search (its capabilities). */
  descriptive: boolean;
  images: Images;
  artWidth: number;
}

/** Typing settles this long before a query is asked. */
const SETTLE_MS = 120;

export class SearchGenerations {
  private generation = 0;
  private view: SearchView | undefined;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();

  constructor(private source: SearchSource, private options: SearchOptions) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.view;

  /** Open a query (a new generation), or close search with an empty one. */
  ask(query: string): void {
    this.cancel();
    const generation = ++this.generation;
    if (query.trim() === '') {
      this.publish(undefined);
      return;
    }
    const descriptive: DescriptiveLane['state'] = this.options.descriptive ? 'loading' : 'off';
    this.publish({
      query,
      titles: { state: 'loading', items: [], channels: [], programmes: [] },
      descriptive: { state: descriptive, items: [], canRetry: false },
      ai: { state: 'off', items: [] },
    });
    this.later(SETTLE_MS, () => {
      this.fast(query, generation);
      if (this.options.descriptive) this.describe(query, generation);
    });
  }

  /** Ask the descriptive lane again, when the server has allowed it. */
  retryDescriptive(): void {
    const view = this.view;
    if (!view || !view.descriptive.canRetry) return;
    this.update(this.generation, { descriptive: { ...view.descriptive, state: 'loading', canRetry: false } });
    this.describe(view.query, this.generation);
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
  }

  private fast(query: string, generation: number): void {
    const { images } = this.options;
    this.source.search(query, generation, 'fast').then(
      answer => {
        const live = liveSearch(answer.live, images, Date.now());
        const titles = this.cards(answer.items);
        this.update(generation, {
          titles: { state: 'ready', items: titles, channels: live.liveChannels, programmes: live.liveProgrammes },
        });
      },
      () => this.update(generation, { titles: { state: 'failed', items: [], channels: [], programmes: [] } }),
    );
  }

  private describe(query: string, generation: number): void {
    this.source.search(query, generation, 'descriptive').then(
      answer => this.described(query, generation, answer),
      () => {
        const found = this.view?.descriptive.items ?? [];
        this.update(generation, { descriptive: { state: 'failed', items: found, canRetry: false } });
      },
    );
  }

  /** The descriptive lane's honest state for an answer, asking again when the server allows it. */
  private described(query: string, generation: number, answer: SearchResponse): void {
    const status = answer.descriptive?.state ?? 'ready';
    const retry = answer.descriptive?.retry;
    const allowed = retry?.allowed === true;
    const wait = Math.max(1, Math.ceil(retry?.afterSeconds ?? 1)) * 1000;
    const items = this.cards(answer.items);
    const still = status === 'pending' || status === 'busy';
    if (status === 'failed' || (still && !allowed)) {
      this.update(generation, { descriptive: { state: 'failed', items, canRetry: false } });
      if (allowed) this.later(wait, () => this.allowRetry(generation));
      return;
    }
    this.update(generation, { descriptive: { state: still ? 'loading' : 'ready', items, canRetry: false } });
    // A partial answer shows while the server keeps working; a pending one waits for it.
    if ((still || status === 'partial') && allowed) this.later(wait, () => this.describe(query, generation));
  }

  private allowRetry(generation: number): void {
    const lane = this.view?.descriptive;
    if (lane) this.update(generation, { descriptive: { ...lane, canRetry: true } });
  }

  private cards(items: Title[]) {
    return items.map(title => card(title, '', this.options.images, this.options.artWidth));
  }

  /** Apply an answer to the view, only while its generation is still the open one. */
  private update(generation: number, change: Partial<SearchView>): void {
    if (generation !== this.generation || !this.view) return;
    this.publish({ ...this.view, ...change });
  }

  private publish(view: SearchView | undefined): void {
    this.view = view;
    this.listeners.forEach(listener => listener());
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      run();
    }, ms);
    this.timers.add(timer);
  }

  private cancel(): void {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}

/** The search view for the query, from a session's generations; none while no query is open. */
export function useSearch(source: SearchSource | null, query: string, options: SearchOptions) {
  const { descriptive, images, artWidth } = options;
  const generations = useMemo(
    () => (source ? new SearchGenerations(source, { descriptive, images, artWidth }) : null),
    [source, descriptive, images, artWidth],
  );
  useEffect(() => () => generations?.dispose(), [generations]);
  useEffect(() => generations?.ask(query), [generations, query]);
  const view = useSyncExternalStore(generations?.subscribe ?? noSubscription, generations?.snapshot ?? nothing);
  const retryDescriptive = useCallback(() => generations?.retryDescriptive(), [generations]);
  return useMemo(() => ({ view, retryDescriptive }), [view, retryDescriptive]);
}

const noSubscription = () => () => undefined;
const nothing = () => undefined;
