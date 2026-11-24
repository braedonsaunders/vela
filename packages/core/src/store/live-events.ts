// Live events (Ether Sports): plugin screens, event details, entity favourites, the ticker and
// alerts, kept current by ONE shared `/live/stream` connection. Views say what they show with
// `follow` while they are on screen; the store folds every view's interest into one query and
// reconnects (with backoff) when that query changes or the connection drops. Pushed updates
// merge into `events` only when they are newer, so a quiet update re-renders nothing.
import type * as V from '../wire';
import { hasLiveEvents, type LiveEvents as LiveEventsApi, type LiveStreamQuery } from '../adapter/capabilities';
import { backoffMs, emptyQuery, mergeEvents, queryKey, readLiveMessage, screenEvents, streamQuery, withEvent, type LiveInterest } from '../live/events';
import type { Session } from './session';
import { failed, loading, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export type LiveStreamPhase = 'idle' | 'connecting' | 'open' | 'retrying';

export interface LiveEventsState {
  /** The latest known form of every event read or pushed, by event id. Views read through it. */
  events: Record<string, V.LiveEvent>;
  /** Screens by `screenKey(id, query)`. */
  screens: Record<string, Loadable<V.Screen>>;
  /** Event details by event id; their event fields follow `events`. */
  details: Record<string, Loadable<V.LiveEventDetail>>;
  /** Entity lists by `entitiesKey(query)`. */
  entities: Record<string, Loadable<V.LiveEntity[]>>;
  /** Favourite changes made here, by entity key, until the server's lists say the same. */
  favorites: Record<string, boolean>;
  /** The ticker's event ids, by screen ('' for none). */
  ticker: Record<string, Loadable<string[]>>;
  /** Alerts not yet dismissed, oldest first. */
  alerts: V.LiveAlert[];
  stream: LiveStreamPhase;
  /** The viewer's spoiler-free preference as read or changed here; undefined until known (see `spoilerFreeOf`). */
  spoilerFree?: boolean;
}

export const initialLiveEvents: LiveEventsState = { events: {}, screens: {}, details: {}, entities: {}, favorites: {}, ticker: {}, alerts: [], stream: 'idle' };

export interface ScreenParams { league?: string; date?: string }

/** Whether the viewer hides scores: a change or read here first, else what bootstrap said. */
export const spoilerFreeOf = (state: Pick<VelaState, 'liveEvents' | 'home'>): boolean | undefined => state.liveEvents.spoilerFree ?? state.home.value?.spoilerFree;
export const screenKey = (id: string, params: ScreenParams = {}) => `${id}|${params.league ?? ''}|${params.date ?? ''}`;
export const entitiesKey = (query: { feed?: string; league?: string; q?: string } = {}) => `${query.feed ?? ''}|${query.league ?? ''}|${query.q ?? ''}`;

/** How soon a followed detail is read again after its event changed (plays and tables move with it). */
const DETAIL_REFRESH_MS = 5000;
/** Interest changes within this window share one reconnection. */
const SETTLE_MS = 120;
const MAX_ALERTS = 5;

export class LiveEvents {
  private readonly interests = new Map<number, LiveInterest>();
  private nextInterest = 0;
  private controller: AbortController | undefined;
  private connected = '';
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private readonly detailTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly detailReads = new Map<string, Promise<void>>();

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    /** Seam for tests: the reconnection delay after consecutive failures. */
    private readonly backoff: (failures: number) => number = backoffMs,
  ) {
    session.onReset(() => {
      this.disconnect();
      for (const timer of this.detailTimers.values()) clearTimeout(timer);
      this.detailTimers.clear();
      this.box.update('liveEvents', () => initialLiveEvents);
      // Views still on screen follow again under the new session.
      this.schedule();
    });
  }

  /** Whether the selected server offers live events. */
  available(): boolean {
    if (!this.session.hasServer()) return false;
    return this.session.features?.liveEvents?.available === true && hasLiveEvents(this.session.selected().adapter);
  }

  private async api(): Promise<LiveEventsApi> {
    const adapter = (await this.session.ready()).adapter;
    if (!hasLiveEvents(adapter)) throw new Error('Live events are not offered by this server');
    return adapter;
  }

  private set<K extends keyof LiveEventsState>(key: K, change: (value: LiveEventsState[K]) => LiveEventsState[K]): void {
    this.box.update('liveEvents', state => {
      const value = change(state[key]);
      return value === state[key] ? state : { ...state, [key]: value };
    });
  }

  /** Known events take what is newer; open details keep their tables and plays. */
  private merge(incoming: readonly V.LiveEvent[]): void {
    if (!incoming.length) return;
    this.box.update('liveEvents', state => {
      const events = mergeEvents(state.events, incoming);
      if (events === state.events) return state;
      let details = state.details;
      for (const event of incoming) {
        const detail = details[event.id];
        if (!detail?.value || events[event.id] !== event) continue;
        const value = withEvent(detail.value, event);
        if (value !== detail.value) details = { ...details, [event.id]: { ...detail, value } };
      }
      return { ...state, events, details };
    });
  }

  // Reads

  /** A screen with its sections resolved for the viewer. A read again keeps the shown one until it answers. */
  async loadScreen(id: string, params: ScreenParams = {}): Promise<void> {
    const key = screenKey(id, params);
    const epoch = this.session.epoch;
    const previous = this.box.get().liveEvents.screens[key];
    this.set('screens', screens => ({ ...screens, [key]: loading(previous) }));
    try {
      const screen = await (await this.api()).screen(id, params);
      if (epoch !== this.session.epoch) return;
      this.merge(screenEvents(screen));
      this.set('screens', screens => ({ ...screens, [key]: ready(screen) }));
    } catch (error) {
      if (epoch === this.session.epoch) this.set('screens', screens => ({ ...screens, [key]: failed(error, previous) }));
    }
  }

  /** An event's detail (tables, plays, the probability series). */
  loadDetail(id: string): Promise<void> {
    const pending = this.detailReads.get(id);
    if (pending) return pending;
    const read = this.readDetail(id).finally(() => this.detailReads.delete(id));
    this.detailReads.set(id, read);
    return read;
  }

  private async readDetail(id: string): Promise<void> {
    const epoch = this.session.epoch;
    const previous = this.box.get().liveEvents.details[id];
    this.set('details', details => ({ ...details, [id]: loading(previous) }));
    try {
      const detail = await (await this.api()).liveEvent(id);
      if (epoch !== this.session.epoch) return;
      this.showDetail(detail);
    } catch (error) {
      if (epoch === this.session.epoch) this.set('details', details => ({ ...details, [id]: failed(error, previous) }));
    }
  }

  private showDetail(detail: V.LiveEventDetail): void {
    const { tables: _t, plays: _p, probabilitySeries: _s, links: _l, ...event } = detail;
    this.box.update('liveEvents', state => ({
      ...state,
      // A detail read is the authority for its event, revealed or not.
      events: { ...state.events, [detail.id]: event },
      details: { ...state.details, [detail.id]: ready(detail) },
    }));
  }

  /** A spoiler-free viewer reveals one event: its detail is read again, scores and all. */
  async reveal(id: string): Promise<void> {
    const epoch = this.session.epoch;
    await (await this.api()).revealLiveEvent(id, { idempotencyKey: this.session.key() });
    if (epoch !== this.session.epoch) return;
    await this.readDetail(id);
    // Screens showing it hold the withheld copy; the event map now has the revealed one.
  }

  async loadEntities(query: { feed?: string; league?: string; q?: string } = {}): Promise<void> {
    const key = entitiesKey(query);
    const epoch = this.session.epoch;
    const previous = this.box.get().liveEvents.entities[key];
    this.set('entities', entities => ({ ...entities, [key]: loading(previous) }));
    try {
      const { entities } = await (await this.api()).liveEntities(query);
      if (epoch === this.session.epoch) this.set('entities', all => ({ ...all, [key]: ready(entities) }));
    } catch (error) {
      if (epoch === this.session.epoch) this.set('entities', all => ({ ...all, [key]: failed(error, previous) }));
    }
  }

  /** Whether an entity is a favourite: a change made here first, else what the server listed. */
  isFavorite(entity: V.LiveEntity): boolean {
    const key = entity.key ?? entity.id;
    return this.box.get().liveEvents.favorites[key] ?? entity.favorite === true;
  }

  /** Favourite or unfavourite an entity at once; screens are read again so "your teams" follow. */
  async setFavorite(key: string, favorite: boolean): Promise<void> {
    const epoch = this.session.epoch;
    const before = this.box.get().liveEvents.favorites[key];
    this.set('favorites', favorites => ({ ...favorites, [key]: favorite }));
    try {
      await (await this.api()).setEntityFavorite(key, favorite, { idempotencyKey: this.session.key() });
    } catch (error) {
      if (epoch === this.session.epoch) this.set('favorites', favorites => {
        const { [key]: _gone, ...rest } = favorites;
        return before === undefined ? rest : { ...rest, [key]: before };
      });
      throw error;
    }
    if (epoch !== this.session.epoch) return;
    this.refreshScreens();
  }

  private refreshScreens(): void {
    for (const key of Object.keys(this.box.get().liveEvents.screens)) {
      const [id, league, date] = key.split('|');
      void this.loadScreen(id!, { ...(league ? { league } : {}), ...(date ? { date } : {}) });
    }
  }

  async loadTicker(screen = ''): Promise<void> {
    const epoch = this.session.epoch;
    const previous = this.box.get().liveEvents.ticker[screen];
    this.set('ticker', ticker => ({ ...ticker, [screen]: loading(previous) }));
    try {
      const { events } = await (await this.api()).liveTicker(screen || undefined);
      if (epoch !== this.session.epoch) return;
      this.merge(events);
      this.set('ticker', ticker => ({ ...ticker, [screen]: ready(events.map(event => event.id)) }));
    } catch (error) {
      if (epoch === this.session.epoch) this.set('ticker', ticker => ({ ...ticker, [screen]: failed(error, previous) }));
    }
  }

  /** The spoiler-free preference, read once when bootstrap did not carry it. */
  async loadPreferences(): Promise<void> {
    if (spoilerFreeOf(this.box.get()) !== undefined) return;
    const epoch = this.session.epoch;
    try {
      const api = await this.api();
      if (!api.livePreferences) return;
      const { spoilerFree } = await api.livePreferences();
      if (epoch === this.session.epoch && typeof spoilerFree === 'boolean') this.set('spoilerFree', () => spoilerFree);
    } catch {
      // Unknown stays unknown: the switch waits, scores show as the server sends them.
    }
  }

  /** Whether this server can change the preference. */
  canSetPreferences(): boolean {
    if (!this.available()) return false;
    const adapter = this.session.selected().adapter as Partial<LiveEventsApi>;
    return typeof adapter.setLivePreferences === 'function';
  }

  /** Hide or show scores everywhere at once; the screens and open games are read again, since the
   * server withholds (or restores) their scores, plays and probability. */
  async setSpoilerFree(on: boolean): Promise<void> {
    const epoch = this.session.epoch;
    const before = this.box.get().liveEvents.spoilerFree;
    this.set('spoilerFree', () => on);
    try {
      const api = await this.api();
      if (!api.setLivePreferences) throw new Error('This server cannot hide scores');
      await api.setLivePreferences({ spoilerFree: on }, { idempotencyKey: this.session.key() });
    } catch (error) {
      if (epoch === this.session.epoch) this.set('spoilerFree', () => before);
      throw error;
    }
    if (epoch !== this.session.epoch) return;
    this.refreshAll();
  }

  /** Every screen and every open game read again (after a change that alters what the server sends). */
  private refreshAll(): void {
    this.refreshScreens();
    for (const id of Object.keys(this.box.get().liveEvents.details)) void this.loadDetail(id);
  }

  dismissAlert(id: string): void {
    this.set('alerts', alerts => alerts.some(alert => alert.id === id) ? alerts.filter(alert => alert.id !== id) : alerts);
  }

  // The stream

  /** A view is showing these events or screens (or wants alerts): the stream follows them until
   * the returned function is called. Interest that does not change the query reconnects nothing. */
  follow(interest: LiveInterest): () => void {
    const id = ++this.nextInterest;
    this.interests.set(id, { events: [...interest.events ?? []], screens: [...interest.screens ?? []], alerts: interest.alerts === true });
    this.schedule();
    return () => {
      if (this.interests.delete(id)) this.schedule();
    };
  }

  /** The query the stream follows now (for diagnostics and tests). */
  query(): LiveStreamQuery {
    return streamQuery(this.interests.values());
  }

  private schedule(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.sync();
    }, SETTLE_MS);
  }

  private sync(): void {
    const query = this.query();
    const key = queryKey(query);
    if (key === this.connected && this.controller) return;
    this.disconnect();
    if (emptyQuery(query)) return;
    if (!this.available()) {
      // The server's features arrive with home; a view that mounted first follows once they do.
      if (this.session.hasServer() && this.session.features === undefined) this.settleTimer = setTimeout(() => { this.settleTimer = undefined; this.sync(); }, 1000);
      return;
    }
    this.connected = key;
    const controller = new AbortController();
    this.controller = controller;
    this.failures = 0;
    void this.run(query, controller);
  }

  private disconnect(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.connected = '';
    if (this.box.get().liveEvents.stream !== 'idle') this.set('stream', () => 'idle');
  }

  /** One query's connection, reopened with backoff until the query changes or the session does. */
  private async run(query: LiveStreamQuery, controller: AbortController): Promise<void> {
    const epoch = this.session.epoch;
    let reopened = false;
    while (!controller.signal.aborted && epoch === this.session.epoch) {
      this.set('stream', () => this.failures ? 'retrying' : 'connecting');
      try {
        const api = await this.api();
        // After a drop, events followed by id are read once: what changed while away is not resent.
        if (reopened && query.events.length) void api.liveEvents(query.events).then(({ events }) => {
          if (!controller.signal.aborted && epoch === this.session.epoch) this.merge(events);
        }, () => {});
        await api.streamLive(query, event => {
          if (controller.signal.aborted) return;
          if (this.box.get().liveEvents.stream !== 'open') this.set('stream', () => 'open');
          this.failures = 0;
          this.receive(event.event, event.data);
        }, controller.signal);
        // The server closed the stream; come back promptly.
        this.failures = Math.max(this.failures, 1);
      } catch {
        if (controller.signal.aborted) return;
        this.failures++;
      }
      reopened = true;
      if (controller.signal.aborted) return;
      this.set('stream', () => 'retrying');
      await sleep(this.backoff(this.failures), controller.signal);
    }
  }

  private receive(name: string, data: string): void {
    const message = readLiveMessage(name, data, this.session.selected().record.origin);
    if (message.kind === 'update') {
      this.merge(message.events);
      for (const event of message.events) this.followDetail(event.id);
    } else if (message.kind === 'alert') {
      const alert = message.alert;
      this.set('alerts', alerts => alerts.some(known => known.id === alert.id) ? alerts : [...alerts, alert].slice(-MAX_ALERTS));
    }
  }

  /** An open detail whose event changed is read again soon (once per window), for its plays and tables. */
  private followDetail(id: string): void {
    if (!this.box.get().liveEvents.details[id]?.value || this.detailTimers.has(id)) return;
    if (![...this.interests.values()].some(interest => interest.events?.includes(id))) return;
    this.detailTimers.set(id, setTimeout(() => {
      this.detailTimers.delete(id);
      if ([...this.interests.values()].some(interest => interest.events?.includes(id))) void this.loadDetail(id);
    }, DETAIL_REFRESH_MS));
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
  });
}
