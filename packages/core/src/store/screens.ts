// Plugin screens and surfaces (docs/plugin-screens.md: Data, records and live updates): documents
// by href (read once), pages by canonical key (one data read per param set, re-read by
// `deps`), the shared record pool, plugin actions with optimistic patches, and ONE /live/stream
// connection following the topics of the pages on show. Hosts open a page while they show it; a
// page released stays a little while (a param change seeds the next one from it, a quick re-show
// draws at once) and is then forgotten with the records nobody else reads.
import type * as V from '../wire';
import { hasPluginScreens, type PluginScreens } from '../adapter/capabilities';
import { localeContext } from '../i18n';
import { backoffMs } from '../live/events';
import { eagerSources, isLazy, sourcesToReread } from '../screens/deps';
import { changedParams, cleanParams, pageKey, sameTarget, serverContext, type PageRequest, type ScreenTarget } from '../screens/keys';
import { linkHrefs, recordRefs, RecordStore, sameJSON, setPath } from '../screens/records';
import { chooseTopics, connectionKey, emptyQuery, readScreenMessage, streamQuery, type ScreenStreamQuery } from '../screens/stream';
import type { ScreenPageState } from '../screens/types';
import type { Session } from './session';
import { failed, loading, message, previewExpired, ready, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export type LiveStreamPhase = 'idle' | 'connecting' | 'open' | 'retrying';

export interface ScreensState {
  /** Documents by href, read once (immutable for their `v`). */
  documents: Record<string, Loadable<V.ScreenDocument>>;
  /** Pages and surfaces by `pageKey`. */
  pages: Record<string, ScreenPageState>;
  /** Controls whose plugin action is in flight, by `busyKey(page, control)`. */
  busy: Record<string, true>;
  /** Alerts not yet dismissed, oldest first (toast surfaces draw them). */
  alerts: V.AlertFrame[];
  stream: LiveStreamPhase;
  /** Surface switches changed here (surface id → enabled), until bootstrap says the same. */
  settings: Record<string, boolean>;
  /** Ether Studio's live preview while this tab previews drafts: `expired` once Ether refuses the
   *  token ("Preview expired, reload from Studio"). */
  preview: { token: string; expired: boolean } | null;
}

export const initialScreens: ScreensState = { documents: {}, pages: {}, busy: {}, alerts: [], stream: 'idle', settings: {}, preview: null };
export const busyKey = (page: string, control: string) => `${page}#${control}`;

/** One client-only patch while a plugin action is in flight: a record's or a source's value at `path`. */
export interface OptimisticPatch { record?: string; source?: string; path: string; value: unknown }
/** `args` go to Ether as given: pass each in its declared type (a plugin action's `bool` must be
 * true/false, an `int` a number; Ether's built-ins also take "true"/"false"). */
export interface ScreenActionCall { name: string; args?: Record<string, V.ScreenActionArg>; optimistic?: OptimisticPatch; control?: string }
export interface PageHandle { key: string; release(): void }

/** A page released this recently and opened again is not read again (a remount, StrictMode). */
const RESHOW_GRACE_MS = 2000;
/** Pages released and kept for a quick return or a param change. */
const KEEP_HIDDEN = 6;
const SETTLE_MS = 120;
const MAX_ALERTS = 5;
const MIN_REFRESH_S = 60;
const MAX_SOURCES = 16;
/** The open pages are read again for fresh topics at most this often after the stream ends or is refused. */
const RENEW_MIN_MS = 60_000;
/** A source that timed out (Ether: retry allowed) is read again after these waits, then keeps its error. */
export const TIMEOUT_RETRY_MS = [1500, 3000, 6000];

interface Entry {
  request: Required<Pick<PageRequest, 'target' | 'href'>> & { params: Record<string, string>; context?: V.SurfaceContext };
  opened: number;
  /** Order of the last show and hide (a counter: two in one millisecond still order), and the
   *  time of the last hide (the re-show grace). */
  shownAt: number;
  hiddenOrder: number;
  hiddenAt: number;
  /** Per-source sequence of the latest read asking for it; `whole` for reads that named none. */
  seq: Map<string, number>;
  whole: number;
  /** Lazy sources asked for (they join refreshes). */
  lazy: Set<string>;
  /** Source revs as read or pushed: a frame for an older rev is dropped. */
  revs: Map<string, number>;
  /** Record keys the page's sources reach (through records too). */
  refs: Set<string>;
  timer?: ReturnType<typeof setInterval>;
  /** Timed-out sources being read again: attempts so far, and the pending timers. */
  timeouts: Map<string, number>;
  retryTimers: Set<ReturnType<typeof setTimeout>>;
}

export class Screens {
  readonly records = new RecordStore();
  private readonly entries = new Map<string, Entry>();
  private readonly documentReads = new Map<string, Promise<void>>();
  private seq = 0;
  private order = 0;
  private alertFollowers = 0;
  private controller: AbortController | undefined;
  private connected = '';
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  private renewedAt = 0;
  private gcQueued = false;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    /** The renderer this client draws: a document needing more is refused whole. */
    private readonly rendererVersion = Number.POSITIVE_INFINITY,
    /** Seam for tests: the reconnection delay after consecutive failures. */
    private readonly backoff: (failures: number) => number = backoffMs,
    /** Seam for tests: the waits before a timed-out source is read again. */
    private readonly timeoutRetryMs: readonly number[] = TIMEOUT_RETRY_MS,
  ) {
    session.onReset(() => this.reset());
  }

  // Availability

  available(): boolean {
    return this.session.hasServer() && hasPluginScreens(this.session.selected().adapter);
  }

  private async api(): Promise<PluginScreens> {
    const adapter = (await this.session.ready()).adapter;
    if (!hasPluginScreens(adapter)) throw new Error('Plugin screens are not offered by this server');
    return adapter;
  }

  private set<K extends keyof ScreensState>(key: K, change: (value: ScreensState[K]) => ScreensState[K]): void {
    this.box.update('screens', state => {
      const value = change(state[key]);
      return value === state[key] ? state : { ...state, [key]: value };
    });
  }

  private page(key: string): ScreenPageState | undefined {
    return this.box.get().screens.pages[key];
  }

  private setPage(key: string, change: (page: ScreenPageState) => ScreenPageState): void {
    this.set('pages', pages => {
      const page = pages[key];
      if (!page) return pages;
      const next = change(page);
      return next === page ? pages : { ...pages, [key]: next };
    });
  }

  // Documents

  /** Read a document once. A document needing a newer renderer than this client's is refused whole. */
  loadDocument(href: string): Promise<void> {
    const known = this.box.get().screens.documents[href];
    if (known?.load === 'ready') return Promise.resolve();
    const pending = this.documentReads.get(href);
    if (pending) return pending;
    const read = this.readDocument(href).finally(() => this.documentReads.delete(href));
    this.documentReads.set(href, read);
    return read;
  }

  private async readDocument(href: string): Promise<void> {
    const epoch = this.session.epoch;
    const previous = this.box.get().screens.documents[href];
    this.set('documents', documents => ({ ...documents, [href]: loading(previous) }));
    try {
      const document = await (await this.api()).screenDocument(href);
      if (epoch !== this.session.epoch) return;
      const problem = documentProblem(document, this.rendererVersion);
      if (problem) throw new Error(problem);
      this.set('documents', documents => ({ ...documents, [href]: ready(document) }));
      // Pages opened before their document arrived start their refresh now.
      for (const [key, entry] of this.entries) if (entry.request.href === href && entry.opened) this.startRefresh(key, entry);
    } catch (error) {
      if (previewExpired(error)) this.expirePreview();
      if (epoch === this.session.epoch) this.set('documents', documents => ({ ...documents, [href]: failed(error, previous) }));
    }
  }

  // Studio live preview

  /**
   * Preview drafts from Ether Studio with this token (X-Vela-Screen-Preview on every screen call),
   * or stop with null/''. Documents and the pages on show are read again under the new mode.
   */
  setPreview(token: string | null | undefined): Promise<void> {
    const next = token || undefined;
    if (next === this.session.screenPreview && !this.box.get().screens.preview?.expired) return Promise.resolve();
    this.session.screenPreview = next;
    this.set('preview', () => next ? { token: next, expired: false } : null);
    this.connected = '';
    this.schedule();
    return this.reload();
  }

  /**
   * Studio's reload: read the documents of a screen (and page), or every document, past every
   * cache, then the data of the pages showing them. A document that now fails (refused, or not
   * compiling) keeps the last good one, with the failure in its `error`; params, the page state
   * and the records stay, so the host keeps scroll and focus.
   */
  async reload(screen?: string, page?: string): Promise<void> {
    if (this.box.get().screens.preview?.expired) this.set('preview', preview => preview ? { ...preview, expired: false } : preview);
    const documents = this.box.get().screens.documents;
    const hrefs = Object.keys(documents).filter(href => documentMatches(href, screen, page));
    const epoch = this.session.epoch;
    await Promise.all(hrefs.map(async href => {
      const previous = this.box.get().screens.documents[href];
      try {
        const document = await (await this.api()).screenDocument(href, undefined, true);
        if (epoch !== this.session.epoch) return;
        const problem = documentProblem(document, this.rendererVersion);
        if (problem) throw new Error(problem);
        this.set('documents', all => ({ ...all, [href]: ready(document) }));
      } catch (error) {
        if (previewExpired(error)) this.expirePreview();
        if (epoch !== this.session.epoch) return;
        const failure = failed<V.ScreenDocument>(error, previous);
        // The last good document keeps drawing; the failure is told beside it.
        this.set('documents', all => ({ ...all, [href]: previous?.value ? { ...failure, load: 'ready' } : failure }));
      }
    }));
    if (epoch !== this.session.epoch) return;
    const changed = new Set(hrefs);
    for (const [key, entry] of this.entries) {
      if (!entry.opened || !(changed.has(entry.request.href) || documentMatches(entry.request.href, screen, page))) continue;
      if (entry.timer) { clearInterval(entry.timer); entry.timer = undefined; }
      this.startRefresh(key, entry);
      this.refresh(key);
    }
  }

  /** The preview token this tab previews with, if any. */
  preview(): string | undefined {
    return this.session.screenPreview;
  }

  /** The connected Ether server's origin (Studio's reload messages must come from it). */
  origin(): string | undefined {
    try { return this.session.hasServer() ? this.session.selected().record.origin : undefined; } catch { return undefined; }
  }

  /** Ether refused the preview token: say so, and stop following the stream until a new one or a reload. */
  private expirePreview(): void {
    if (!this.session.screenPreview || this.box.get().screens.preview?.expired) return;
    this.set('preview', preview => preview ? { ...preview, expired: true } : preview);
    this.disconnect();
  }

  private documentOf(entry: Entry): V.ScreenDocument | undefined {
    return this.box.get().screens.documents[entry.request.href]?.value;
  }

  // Pages

  /**
   * Show a page or surface until `release`. A new page reads its document and every source that is
   * not lazy; one shown before draws what it had and reads again; `from` (the page this replaces
   * after a param change, same target) seeds it, so only the sources whose deps name a changed
   * param are read again while the rest stay as they are.
   */
  open(request: PageRequest, from?: string): PageHandle {
    const params = cleanParams(request.params);
    const key = pageKey(request.target, params, request.context);
    let entry = this.entries.get(key);
    const now = Date.now();
    if (!entry) {
      entry = { request: { target: request.target, href: request.href, params, ...(request.context ? { context: request.context } : {}) },
        opened: 0, shownAt: 0, hiddenOrder: 0, hiddenAt: 0, seq: new Map(), whole: 0, lazy: new Set(), revs: new Map(), refs: new Set(), timeouts: new Map(), retryTimers: new Set() };
      this.entries.set(key, entry);
      const seed = from && from !== key ? this.entries.get(from) : undefined;
      const seeded = seed && sameTarget(seed.request.target, request.target) && this.page(from!)?.load === 'ready';
      if (seeded) this.seed(key, entry, from!, seed);
      else this.fresh(key, entry);
    } else {
      // A surface's client-only context (chrome, pictureTime) moves without a new key.
      if (request.context) entry.request.context = request.context;
      if (!entry.opened && entry.hiddenAt && now - entry.hiddenAt > RESHOW_GRACE_MS && this.page(key)?.load !== 'loading') this.refresh(key);
    }
    entry.opened++;
    entry.shownAt = ++this.order;
    entry.hiddenAt = 0;
    void this.loadDocument(request.href);
    this.startRefresh(key, entry);
    this.schedule();
    let released = false;
    return { key, release: () => { if (!released) { released = true; this.close(key); } } };
  }

  private fresh(key: string, entry: Entry): void {
    const { request } = entry;
    this.set('pages', pages => ({ ...pages, [key]: {
      href: request.href, key, params: request.params, sources: {}, pending: {}, errors: {}, load: 'loading', rev: 0,
      ...(request.context ? { context: request.context } : {}),
    } }));
    void this.read(key);
  }

  private seed(key: string, entry: Entry, from: string, seed: Entry): void {
    const previous = this.page(from)!;
    for (const name of seed.lazy) entry.lazy.add(name);
    for (const [name, rev] of seed.revs) entry.revs.set(name, rev);
    const changed = changedParams(previous.params, entry.request.params);
    const document = this.documentOf(seed);
    const reread = sourcesToReread(document, changed, [...Object.keys(previous.sources), ...Object.keys(previous.errors)], entry.lazy);
    this.set('pages', pages => ({ ...pages, [key]: { ...previous, key, params: entry.request.params, pending: {}, ...(entry.request.context ? { context: entry.request.context } : {}) } }));
    // The topic is sealed for the old params; a param no source reads keeps it (same data).
    if (reread.length) void this.read(key, reread);
    this.track(key);
  }

  private close(key: string): void {
    const entry = this.entries.get(key);
    if (!entry || entry.opened <= 0) return;
    entry.opened--;
    if (entry.opened) return;
    entry.hiddenAt = Date.now();
    entry.hiddenOrder = ++this.order;
    if (entry.timer) { clearInterval(entry.timer); entry.timer = undefined; }
    this.evict();
    this.schedule();
  }

  /** Keep the most recently hidden pages; forget older ones and the records only they read. */
  private evict(): void {
    const hidden = [...this.entries].filter(([, entry]) => !entry.opened).sort(([, a], [, b]) => b.hiddenOrder - a.hiddenOrder);
    const gone = hidden.slice(KEEP_HIDDEN).map(([key]) => key);
    if (!gone.length) return;
    for (const key of gone) { for (const timer of this.entries.get(key)!.retryTimers) clearTimeout(timer); this.entries.delete(key); }
    this.set('pages', pages => {
      const next = { ...pages };
      for (const key of gone) delete next[key];
      return next;
    });
    this.gcSoon();
  }

  private startRefresh(key: string, entry: Entry): void {
    if (entry.timer || !entry.opened) return;
    const seconds = this.documentOf(entry)?.refresh;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return;
    entry.timer = setInterval(() => this.refresh(key), Math.max(MIN_REFRESH_S, seconds) * 1000);
  }

  /** Read again what the page shows: its eager sources and the lazy ones it asked for. */
  refresh(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    const document = this.documentOf(entry);
    const page = this.page(key);
    if (page?.load === 'failed') { void this.retry(key); return; }
    void this.read(key, document ? eagerSources(document, entry.lazy) : undefined);
    if (!document && entry.lazy.size) void this.read(key, [...entry.lazy]);
  }

  /** Lazy sources a block is about to draw (`needs`): read once, then followed like the rest. */
  need(key: string, sources: readonly string[]): Promise<void> {
    const entry = this.entries.get(key);
    const page = this.page(key);
    if (!entry || !page) return Promise.resolve();
    const wanted = [...new Set(sources)].filter(name => name && !entry.lazy.has(name));
    if (!wanted.length) return Promise.resolve();
    for (const name of wanted) entry.lazy.add(name);
    return this.read(key, wanted);
  }

  /** Read again what failed: the whole page when its first read did, else the given sources or every failed one. */
  retry(key: string, sources?: readonly string[]): Promise<void> {
    const page = this.page(key);
    const entry = this.entries.get(key);
    if (!page || !entry) return Promise.resolve();
    if (page.load === 'failed') {
      this.setPage(key, current => ({ ...current, load: 'loading' }));
      return this.read(key);
    }
    const names = sources?.length ? [...sources] : Object.keys(page.errors);
    return names.length ? this.read(key, names) : Promise.resolve();
  }

  /**
   * One data read: the named sources, or every one that is not lazy. Sources being read keep their
   * value with `pending`; an answer overtaken by a later read of the same source is dropped.
   */
  private async read(key: string, sources?: readonly string[]): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    // Ether reads at most 16 sources at once.
    if (sources && sources.length > MAX_SOURCES) {
      const names = [...new Set(sources)];
      const reads: Promise<void>[] = [];
      for (let at = 0; at < names.length; at += MAX_SOURCES) reads.push(this.read(key, names.slice(at, at + MAX_SOURCES)));
      await Promise.all(reads);
      return;
    }
    const epoch = this.session.epoch;
    const seq = ++this.seq;
    const named = sources ? [...new Set(sources)] : undefined;
    if (named) for (const name of named) entry.seq.set(name, seq); else entry.whole = seq;
    const marked = named ?? Object.keys(this.page(key)?.sources ?? {}).filter(name => !isLazy(this.documentOf(entry), name));
    if (marked.length) this.setPage(key, page => ({ ...page, pending: { ...page.pending, ...Object.fromEntries(marked.map(name => [name, true])) } }));
    // An answer for a source is current unless a later read asked for it (by name, or as a whole
    // read covering every source that is not lazy).
    const current = (name: string) => Math.max(entry.seq.get(name) ?? 0, isLazy(this.documentOf(entry), name) ? 0 : entry.whole) <= seq;
    try {
      const data = await (await this.api()).screenData(entry.request.target, {
        ...(named ? { sources: named } : {}), params: entry.request.params, context: serverContext(entry.request.context), tz: localeContext().timeZone,
      });
      if (epoch !== this.session.epoch || this.entries.get(key) !== entry) return;
      this.records.merge(data?.records);
      const answered = data?.sources && typeof data.sources === 'object' ? data.sources : {};
      const errors = data?.errors && typeof data.errors === 'object' ? data.errors : {};
      const rev = typeof data?.rev === 'number' && Number.isFinite(data.rev) ? data.rev : 0;
      // A source that timed out with retry allowed is read again shortly (Ether keeps its late
      // answer), up to three times; it stays pending meanwhile and keeps what it drew.
      const retrying = new Set<string>();
      for (const [name, error] of Object.entries(errors)) {
        if (!current(name)) continue;
        const attempts = entry.timeouts.get(name) ?? 0;
        if (error?.code === 'timeout' && error.retry === true && attempts < this.timeoutRetryMs.length) {
          entry.timeouts.set(name, attempts + 1);
          retrying.add(name);
        } else entry.timeouts.delete(name);
      }
      for (const name of Object.keys(answered)) if (current(name)) entry.timeouts.delete(name);
      this.setPage(key, page => {
        const values = { ...page.sources }, pending = { ...page.pending }, failures = { ...page.errors };
        for (const [name, value] of Object.entries(answered)) {
          if (!current(name)) continue;
          // An unchanged answer keeps the value's identity, so nothing reading it draws again.
          if (!sameJSON(values[name], value)) values[name] = value;
          delete failures[name];
          entry.revs.set(name, Math.max(entry.revs.get(name) ?? 0, rev));
        }
        for (const [name, error] of Object.entries(errors)) {
          if (!current(name) || retrying.has(name)) continue;
          failures[name] = typeof error?.code === 'string' && error.code ? error.code : 'unavailable';
        }
        for (const name of [...marked, ...Object.keys(answered), ...Object.keys(errors)]) if (current(name)) delete pending[name];
        for (const name of retrying) pending[name] = true;
        const topic = typeof data?.live?.topic === 'string' && data.live.topic ? data.live.topic : page.topic;
        return { ...page, sources: values, pending, errors: failures, load: 'ready', rev: Math.max(page.rev, rev), ...(topic ? { topic } : {}) };
      });
      this.track(key);
      this.schedule();
      if (retrying.size) this.retrySoon(key, entry, [...retrying]);
    } catch (error) {
      if (previewExpired(error)) this.expirePreview();
      if (epoch !== this.session.epoch || this.entries.get(key) !== entry) return;
      const code = failureCode(error);
      this.setPage(key, page => {
        const pending = { ...page.pending }, failures = { ...page.errors };
        for (const name of marked) if (current(name)) { delete pending[name]; failures[name] = code; }
        // The first read failing fails the page (its `failure` node draws); later ones fail their
        // sources. A 404 (the page no longer visible to the viewer, or no variant for this
        // renderer) fails the page whenever it comes.
        if ((page.load !== 'ready' && !named) || code === 'not_found' || code === 'update_required' || code === 'preview_expired') return { ...page, pending, load: 'failed', error: message(error), failure: code };
        return { ...page, pending, errors: failures };
      });
    }
  }

  /** Read timed-out sources again after the backoff for their attempt (one timer per batch). */
  private retrySoon(key: string, entry: Entry, names: string[]): void {
    const attempt = Math.max(...names.map(name => entry.timeouts.get(name) ?? 1));
    const timer = setTimeout(() => {
      entry.retryTimers.delete(timer);
      if (this.entries.get(key) !== entry) return;
      // Only those still waiting: a read in between may have answered them.
      const still = names.filter(name => entry.timeouts.has(name));
      if (still.length) void this.read(key, still);
    }, this.timeoutRetryMs[attempt - 1]);
    entry.retryTimers.add(timer);
  }

  /** The record keys a page reaches, kept for the stream's revs and for releasing records. */
  private track(key: string): void {
    const entry = this.entries.get(key);
    const page = this.page(key);
    if (!entry || !page) return;
    entry.refs = recordRefs(page.sources, this.records.get);
    this.gcSoon();
  }

  /** Every https href that reached this page inside a `$link` envelope: the only ones openLink opens. */
  links(key: string): ReadonlySet<string> {
    const page = this.page(key);
    return page ? linkHrefs(page.sources, this.records.get) : new Set();
  }

  private gcSoon(): void {
    if (this.gcQueued) return;
    this.gcQueued = true;
    queueMicrotask(() => {
      this.gcQueued = false;
      const keep = new Set<string>();
      for (const [key, entry] of this.entries) {
        if (!this.page(key)) continue;
        for (const ref of entry.refs) keep.add(ref);
      }
      this.records.release(keep);
    });
  }

  // Actions

  /**
   * A plugin action (`plugin` press): POST with an idempotency key; the optimistic patch shows at
   * once and is dropped when the answer lands or fails. The answer's records and sources patch the
   * store and its `refresh` sources are read again; the answer is returned for the caller to show
   * its `toast` and follow its `navigate`. Throws when the action fails.
   */
  async action(key: string, call: ScreenActionCall): Promise<V.ScreenActionAnswer> {
    const entry = this.entries.get(key);
    const page = this.page(key);
    if (!entry || !page) throw new Error('This page is not open');
    const epoch = this.session.epoch;
    const control = call.control ? busyKey(key, call.control) : '';
    if (control) this.set('busy', busy => ({ ...busy, [control]: true }));
    const undo = call.optimistic ? this.patch(key, call.optimistic) : undefined;
    try {
      const target = entry.request.target;
      const context = serverContext(entry.request.context);
      const answer = await (await this.api()).screenAction(target, call.name, {
        page: target.kind === 'screen' ? target.page : 'main', params: entry.request.params, args: call.args ?? {},
        ...(Object.keys(context).length ? { context } : {}), tz: localeContext().timeZone,
      }, { idempotencyKey: this.session.key() });
      undo?.();
      if (epoch !== this.session.epoch) return answer ?? {};
      this.apply(key, answer ?? {});
      return answer ?? {};
    } catch (error) {
      undo?.();
      if (previewExpired(error)) this.expirePreview();
      throw error;
    } finally {
      if (control) this.set('busy', busy => { const { [control]: _gone, ...rest } = busy; return rest; });
    }
  }

  /** Apply an optimistic patch; the returned function undoes it unless something newer replaced it. */
  private patch(key: string, patch: OptimisticPatch): (() => void) | undefined {
    const value = typeof patch.value === 'string' && (patch.value === 'true' || patch.value === 'false') ? patch.value === 'true' : patch.value;
    if (patch.record) {
      const recordKey = patch.record;
      const before = this.records.get(recordKey);
      if (!before) return undefined;
      const patched = { rev: before.rev, value: patch.path ? setPath(before.value, patch.path, value) : value };
      this.records.put(recordKey, patched);
      return () => { if (this.records.get(recordKey) === patched) this.records.put(recordKey, before); };
    }
    if (patch.source) {
      const name = patch.source;
      const before = this.page(key)?.sources[name];
      if (before === undefined) return undefined;
      const patched = patch.path ? setPath(before, patch.path, value) : value;
      this.setPage(key, page => ({ ...page, sources: { ...page.sources, [name]: patched } }));
      return () => this.setPage(key, page => page.sources[name] === patched ? { ...page, sources: { ...page.sources, [name]: before } } : page);
    }
    return undefined;
  }

  private apply(key: string, answer: V.ScreenActionAnswer): void {
    this.records.merge(answer.records);
    const sources = answer.sources && typeof answer.sources === 'object' ? answer.sources : {};
    if (Object.keys(sources).length) {
      // Ether answers every source of the page, lazy ones too: those are now read and followed.
      const entry = this.entries.get(key);
      if (entry) for (const name of Object.keys(sources)) entry.lazy.add(name);
      this.setPage(key, page => ({ ...page, sources: { ...page.sources, ...sources } }));
      this.track(key);
    }
    const refresh = Array.isArray(answer.refresh) ? answer.refresh.filter((name): name is string => typeof name === 'string' && !!name) : [];
    if (refresh.length) void this.read(key, refresh);
  }

  /** A surface's player-menu switch, remembered per viewer by Ether. */
  async setSurfaceEnabled(id: string, enabled: boolean): Promise<void> {
    const epoch = this.session.epoch;
    const before = this.box.get().screens.settings[id];
    this.set('settings', settings => ({ ...settings, [id]: enabled }));
    try {
      await (await this.api()).setSurfaceSetting(id, enabled, { idempotencyKey: this.session.key() });
    } catch (error) {
      if (epoch === this.session.epoch) this.set('settings', settings => {
        const { [id]: _gone, ...rest } = settings;
        return before === undefined ? rest : { ...rest, [id]: before };
      });
      throw error;
    }
  }

  // Alerts

  /** A toast host is mounted: the stream carries alerts until the returned function is called. */
  followAlerts(): () => void {
    this.alertFollowers++;
    this.schedule();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.alertFollowers--;
      this.schedule();
    };
  }

  dismissAlert(id: string): void {
    this.set('alerts', alerts => alerts.some(alert => alert.id === id) ? alerts.filter(alert => alert.id !== id) : alerts);
  }

  // The stream

  /** The query the connection follows now: the topics of the most recently shown open pages (at
   * most 4), since the lowest of their revs, and alerts while a toast host follows them. */
  query(): ScreenStreamQuery {
    const interests = [...this.entries].flatMap(([key, entry]) => {
      const page = this.page(key);
      return entry.opened && page?.topic ? [{ topic: page.topic, rev: page.rev, shownAt: entry.shownAt }] : [];
    });
    return streamQuery(chooseTopics(interests), this.alertFollowers > 0);
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
    const key = connectionKey(query);
    if (key === this.connected && this.controller) return;
    this.disconnect();
    if (emptyQuery(query) || !this.available() || this.box.get().screens.preview?.expired) return;
    this.connected = key;
    const controller = new AbortController();
    this.controller = controller;
    // Failures carry over: a new topic after a refusal waits its backoff (Ether issues a fresh
    // topic token on every read, so a refused stream must never reconnect at once).
    void this.run(controller);
  }

  private disconnect(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.connected = '';
    if (this.box.get().screens.stream !== 'idle') this.set('stream', () => 'idle');
  }

  /** One connection, reopened with backoff (since = the pages' revs then) until its topics change. */
  private async run(controller: AbortController): Promise<void> {
    const epoch = this.session.epoch;
    while (!controller.signal.aborted && epoch === this.session.epoch) {
      if (this.failures) {
        this.set('stream', () => 'retrying');
        await sleep(this.backoff(this.failures), controller.signal);
        if (controller.signal.aborted || epoch !== this.session.epoch) return;
      }
      this.set('stream', () => this.failures ? 'retrying' : 'connecting');
      try {
        const api = await this.api();
        const query = this.query();
        if (emptyQuery(query)) return;
        await api.streamScreens(query, event => {
          if (controller.signal.aborted) return;
          if (this.box.get().screens.stream !== 'open') this.set('stream', () => 'open');
          this.failures = 0;
          this.receive(event.event, event.data);
        }, controller.signal);
        // Ether ends the stream when a topic's page is no longer visible to the viewer: read the
        // open pages again (fresh topics, or their failure) and reopen.
        if (controller.signal.aborted) return;
        this.renewPages();
        this.failures = Math.max(this.failures, 1);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (previewExpired(error)) { this.expirePreview(); return; }
        this.failures++;
        // A topic Ether no longer honours (expired, the page gone): read the pages again for fresh ones.
        const status = (error as { status?: number })?.status;
        if (status === 400 || status === 404 || status === 410) this.renewPages();
      }
    }
  }

  /** Read the open pages again for fresh topics after the stream ended or was refused: at most once
   * a minute, so a stream Ether keeps refusing never turns into a loop of data reads. */
  private renewPages(): void {
    const now = Date.now();
    if (now - this.renewedAt < RENEW_MIN_MS) return;
    this.renewedAt = now;
    for (const [key, entry] of this.entries) if (entry.opened) this.refresh(key);
  }

  /** One frame: records into the pool (the pages reaching them move their rev), a source into
   * the open page it belongs to (newer rev only), an alert into the stack. */
  receive(name: string, data: string): void {
    const message = readScreenMessage(name, data);
    if (message.kind === 'records') {
      const changed = this.records.merge(message.records);
      if (!changed.length) return;
      // A pushed record no page reaches is not kept.
      this.gcSoon();
      const highest = Math.max(...changed.map(key => this.records.get(key)?.rev ?? 0));
      for (const [key, entry] of this.entries) {
        if (!changed.some(changedKey => entry.refs.has(changedKey))) continue;
        this.setPage(key, page => highest > page.rev ? { ...page, rev: highest } : page);
        // A record that now reaches others (a row's new entity) is kept for this page.
        this.track(key);
      }
    } else if (message.kind === 'source') {
      const frame = message.frame;
      const owner = ([key, entry]: [string, Entry]) => {
        const target = entry.request.target;
        return entry.opened > 0 && !!this.page(key) && (frame.surface !== undefined
          ? target.kind === 'surface' && target.id === frame.surface
          : target.kind === 'screen' && target.id === frame.screen && target.page === frame.page);
      };
      // Two open pages of one target (rare): the frame is for the one shown last.
      const match = [...this.entries].filter(owner).sort(([, a], [, b]) => b.shownAt - a.shownAt)[0];
      if (!match) return;
      const [key, entry] = match;
      if (frame.rev <= (entry.revs.get(frame.source) ?? 0)) return;
      entry.revs.set(frame.source, frame.rev);
      this.setPage(key, page => ({ ...page, sources: sameJSON(page.sources[frame.source], frame.value) ? page.sources : { ...page.sources, [frame.source]: frame.value }, rev: Math.max(page.rev, frame.rev) }));
      this.track(key);
    } else if (message.kind === 'alert') {
      const alert = message.alert;
      this.set('alerts', alerts => alerts.some(known => known.id === alert.id) ? alerts : [...alerts, alert].slice(-MAX_ALERTS));
    }
  }

  // Session

  /** Another viewer or server: nothing read stays. Pages still on show read again under the new session. */
  private reset(): void {
    this.disconnect();
    for (const entry of this.entries.values()) {
      if (entry.timer) clearInterval(entry.timer);
      for (const timer of entry.retryTimers) clearTimeout(timer);
    }
    const open = [...this.entries].filter(([, entry]) => entry.opened > 0);
    this.entries.clear();
    this.documentReads.clear();
    this.records.clear();
    const preview = this.box.get().screens.preview;
    this.box.update('screens', () => ({ ...initialScreens, preview }));
    for (const [key, entry] of open) {
      const fresh: Entry = { ...entry, seq: new Map(), whole: 0, lazy: new Set(), revs: new Map(), refs: new Set(), timer: undefined, timeouts: new Map(), retryTimers: new Set() };
      this.entries.set(key, fresh);
      this.fresh(key, fresh);
      void this.loadDocument(entry.request.href);
    }
    this.schedule();
  }
}

/** Whether a document href is the given screen's (and page's) or surface's; any document when no screen is named. */
export function documentMatches(href: string, screen?: string, page?: string): boolean {
  if (!screen) return true;
  const path = href.split('?')[0]!;
  const id = encodeURIComponent(screen);
  if (path.includes(`/surfaces/${id}/document`)) return true;
  return path.includes(`/screens/${id}/pages/`) && (!page || path.includes(`/screens/${id}/pages/${encodeURIComponent(page)}/document`));
}

/** Why a served document cannot be drawn here, or '' when it can. */
export function documentProblem(document: unknown, rendererVersion: number): string {
  const doc = document as Partial<V.ScreenDocument> | null;
  if (!doc || typeof doc !== 'object') return 'The server sent an unreadable screen document.';
  if (doc.schema !== 1 || doc.kind !== 'screen' || !doc.tree || typeof doc.tree !== 'object' || !doc.sources || typeof doc.sources !== 'object')
    return 'The server sent an unreadable screen document.';
  if (typeof doc.renderer !== 'number' || !Number.isFinite(doc.renderer)) return 'The screen document names no renderer.';
  if (doc.renderer > rendererVersion) return `This screen needs renderer ${doc.renderer}; this app draws ${rendererVersion}. Update the app.`;
  return '';
}

/** Ether's code for a failed read: `update_required` (no variant for this renderer: "update the
 * app"), `not_found` for any other 404 (a surface the viewer may not see), else its code. */
function failureCode(error: unknown): string {
  const status = (error as { status?: number })?.status;
  const code = (error as { detail?: { code?: string } })?.detail?.code;
  if (code === 'update_required') return code;
  if (status === 404) return 'not_found';
  return typeof code === 'string' && code ? code : 'unavailable';
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
  });
}

export type { ScreenTarget, PageRequest };
