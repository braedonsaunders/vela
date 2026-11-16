// Search: three independent lanes for one query. The fast lane (titles by name, plus live
// channels and programmes) answers every keystroke; the descriptive lane ("films about a heist
// in Lisbon") and the AI lane start once typing pauses, and only on a server that offers them.
// Each query is a new generation: answers for an older one are dropped, and an AI job for an
// older query is cancelled.
import type * as V from '../wire';
import { hasAiSearch, hasDescriptiveSearch, type AiSearch } from '../adapter/capabilities';
import { card } from '../discovery/models';
import { liveSearch } from '../live/search';
import type { Card } from '../models';
import type { Session } from './session';
import { message, type Load, type StateBox } from './state';
import type { VelaState } from './index';

type LiveResults = ReturnType<typeof liveSearch>;
export type LiveChannelResult = LiveResults['liveChannels'][number];
export type LiveProgrammeResult = LiveResults['liveProgrammes'][number];

export interface SearchLane {
  /** `unavailable` when the server does not offer this lane. Descriptive and AI lanes also
   * report the server's own states (`indexing`, `queued`, `running`, `partial`, …). */
  status: Load | 'unavailable' | string;
  items: Card[];
  error: string;
}

export interface SearchState {
  query: string;
  generation: number;
  fast: SearchLane & { liveChannels: LiveChannelResult[]; liveProgrammes: LiveProgrammeResult[] };
  descriptive: SearchLane & { retryAllowed: boolean; retryAfterSeconds: number };
  ai: SearchLane;
}

const emptyLane: SearchLane = { status: 'idle', items: [], error: '' };

export const initialSearch: SearchState = {
  query: '',
  generation: 0,
  fast: { ...emptyLane, liveChannels: [], liveProgrammes: [] },
  descriptive: { ...emptyLane, retryAllowed: false, retryAfterSeconds: 0 },
  ai: emptyLane,
};

/** How long typing must pause before the slower lanes start. */
const PAUSE_MS = 600;
const AI_POLL_MS = 1500;
const ACTIVE_JOB = ['queued', 'running', 'partial'];

export class Search {
  private pause: ReturnType<typeof setTimeout> | undefined;
  private aiPoll: ReturnType<typeof setTimeout> | undefined;
  private job: { generation: number; query: string; id?: string; status?: string } | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
  ) {
    session.onReset(() => {
      this.stopTimers();
      this.job = undefined;
      this.box.update('search', () => initialSearch);
    });
  }

  /** A new query: a new generation, with every lane started again. An empty query clears search. */
  setQuery(query: string): void {
    const generation = this.box.get().search.generation + 1;
    this.stopTimers();
    void this.cancelAi();
    const text = query.trim();
    if (!text) {
      this.box.update('search', () => ({ ...initialSearch, query, generation }));
      return;
    }
    this.box.update('search', search => ({
      query,
      generation,
      fast: { ...search.fast, status: 'loading', error: '' },
      descriptive: { ...initialSearch.descriptive },
      ai: { ...emptyLane },
    }));
    void this.fast(text, generation);
    this.pause = setTimeout(() => {
      void this.descriptive(text, generation);
      void this.ai(text, generation);
    }, PAUSE_MS);
  }

  clear(): void {
    this.setQuery('');
  }

  private current(generation: number): boolean {
    return this.box.get().search.generation === generation;
  }

  private async fast(query: string, generation: number): Promise<void> {
    try {
      const connection = await this.session.ready();
      const result = await connection.adapter.search({ query, generation, idempotencyKey: `search-${this.session.epoch}-${generation}` });
      const images = await connection.images();
      if (!this.current(generation) || result.generation !== generation) return;
      const live = liveSearch(result.live, images, Date.now());
      const items = result.items.map(title => card(title, '', images, this.artWidth()));
      this.patch('fast', { status: 'ready', items, error: '', ...live });
    } catch (error) {
      if (this.current(generation)) this.patch('fast', { status: 'failed', error: message(error) });
    }
  }

  private async descriptive(query: string, generation: number): Promise<void> {
    try {
      const connection = await this.session.ready();
      const api = connection.adapter;
      if (!this.session.features?.descriptiveSearch.available || !hasDescriptiveSearch(api)) {
        this.patch('descriptive', { status: 'unavailable' });
        return;
      }
      this.patch('descriptive', { status: 'loading' });
      const result = await api.searchByDescription({ query, generation, idempotencyKey: this.session.key() });
      const images = await connection.images();
      if (!this.current(generation) || result.generation !== generation) return;
      const retry = result.descriptive?.retry;
      const after = Number.isFinite(retry?.afterSeconds) ? Math.max(1, Math.ceil(retry!.afterSeconds!)) : 1;
      this.patch('descriptive', {
        status: result.descriptive?.state ?? 'ready',
        items: result.items.map(title => card(title, '', images, this.artWidth())),
        error: '',
        retryAllowed: retry?.allowed === true,
        retryAfterSeconds: after,
      });
    } catch (error) {
      if (this.current(generation)) this.patch('descriptive', { status: 'failed', error: message(error) });
    }
  }

  /** Ask the descriptive lane again (it was indexing, or failed). */
  retryDescriptive(): void {
    const { query, generation } = this.box.get().search;
    if (query.trim()) void this.descriptive(query.trim(), generation);
  }

  private async ai(query: string, generation: number): Promise<void> {
    try {
      const connection = await this.session.ready();
      const api = connection.adapter;
      if (!this.session.features?.aiSearch.available || !hasAiSearch(api)) {
        this.patch('ai', { status: 'unavailable' });
        return;
      }
      const current: NonNullable<Search['job']> = { generation, query };
      this.job = current;
      this.patch('ai', { status: 'loading' });
      const job = await api.startAiSearch({ query, generation, idempotencyKey: `ai-${this.session.epoch}-${generation}` });
      current.id = job.id;
      current.status = job.status;
      if (this.job !== current) {
        await api.cancelAiSearch(job.id, { generation, idempotencyKey: `cancel-${this.session.epoch}-${generation}` });
        return;
      }
      await this.showJob(job, current, api);
    } catch (error) {
      if (this.current(generation)) this.patch('ai', { status: 'failed', error: message(error) });
    }
  }

  /** Show a job's results so far, and read it again while it is still working. */
  private async showJob(job: V.AISearchJob, current: NonNullable<Search['job']>, api: AiSearch): Promise<void> {
    if (this.job !== current || !this.current(current.generation) || job.generation !== current.generation) return;
    if (job.results && (job.results.query !== current.query || job.results.generation !== current.generation)) return;
    const connection = await this.session.ready();
    const images = await connection.images();
    const items = (job.results?.items ?? []).map(title => card(title, '', images, this.artWidth()));
    this.patch('ai', { status: job.status, items, error: '' });
    if (!ACTIVE_JOB.includes(job.status)) return;
    this.aiPoll = setTimeout(async () => {
      try {
        const next = await api.aiSearchJob(job.id);
        current.status = next.status;
        await this.showJob(next, current, api);
      } catch (error) {
        if (this.job === current) this.patch('ai', { status: 'failed', error: message(error) });
      }
    }, AI_POLL_MS);
  }

  /** A job still working for an older query is cancelled at the server. */
  private async cancelAi(): Promise<void> {
    const previous = this.job;
    this.job = undefined;
    if (!previous?.id || !ACTIVE_JOB.includes(previous.status ?? '')) return;
    try {
      const api = (await this.session.ready()).adapter;
      const idempotencyKey = `cancel-${this.session.epoch}-${previous.generation}`;
      if (hasAiSearch(api)) await api.cancelAiSearch(previous.id, { generation: previous.generation, idempotencyKey });
    } catch {
      // The job ends on its own; nothing waits on the cancellation.
    }
  }

  private stopTimers(): void {
    if (this.pause) clearTimeout(this.pause);
    if (this.aiPoll) clearTimeout(this.aiPoll);
    this.pause = undefined;
    this.aiPoll = undefined;
  }

  private patch<K extends 'fast' | 'descriptive' | 'ai'>(lane: K, change: Partial<SearchState[K]>): void {
    this.box.update('search', search => ({ ...search, [lane]: { ...search[lane], ...change } }));
  }
}
