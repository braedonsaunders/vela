// Home: the server's heroes and rows, more rows as the viewer scrolls, more items as a row pages,
// and the libraries the shell lists as destinations. A failed home is retried on the server's
// terms (its retry policy and Retry-After), at most twice, then left for the viewer to retry.
import type * as V from '../wire';
import { libraryExperience } from '../library-presentation';
import { mediaClass } from '../media';
import { advertise } from '../adapter/advertise';
import { VelaError } from '../adapter/errors';
import { artworkURL } from '../discovery/artwork';
import { card, entry, feedRow, homeModel } from '../discovery/models';
import { homeCard, homeWatched, laterProgressRows, reconcileHomeProgress, recorded, type Watched } from '../discovery/progress';
import type { Destination, HomeModel, Row } from '../models';
import type { Session } from './session';
import { failed, idle, loading, ready, type Load, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';

export interface HomeRetry {
  allowed: boolean;
  delaySeconds: number;
  attempt: number;
}

export interface HomeState extends Loadable<HomeModel> {
  retry: HomeRetry | null;
  /** The first Home answer has taken long enough that the viewer needs choices, not only a skeleton. */
  slow: boolean;
  /** Rows whose next items are being read. */
  rowsLoading: string[];
  /** The next page of rows: being read, failed, or none left. */
  moreRows: Load | 'end';
  /** Advances after a stop is reconciled so mounted library progress rows can refresh. */
  progressRevision: number;
}

export const initialHome: HomeState = { ...idle<HomeModel>(), retry: null, slow: false, rowsLoading: [], moreRows: 'idle', progressRevision: 0 };

const PAGE_ITEMS = 20;
const LIBRARY_PAGES = 100;
const RECONCILE_RETRIES = 2;
const RECONCILE_DELAY_MS = 500;
export const HOME_SLOW_MS = 7_000;
/** A reconcile that takes the server's answer as it is. */
const ANY_PROGRESS: Watched = { titleId: '', positionSeconds: 0, finished: false };

export type HomePresentation = 'skeleton' | 'slow' | 'ready' | 'failed';

/** Home's time/state transition is pure so behaviour tests do not need to wait seven seconds. */
export function homePresentation(load: Load, hasValue: boolean, elapsedMs: number): HomePresentation {
  if (hasValue || load === 'ready') return 'ready';
  if (load === 'failed') return 'failed';
  return elapsedMs >= HOME_SLOW_MS ? 'slow' : 'skeleton';
}

export class Home {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private reading: Promise<void> | undefined;
  private controller: AbortController | undefined;
  private reconcilePending: Watched | undefined;
  private reconcileReading: Promise<void> | undefined;
  private reconcileController: AbortController | undefined;
  private reconcileGeneration = 0;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
    private readonly slowDelayMs = HOME_SLOW_MS,
    private readonly reconcileDelayMs = RECONCILE_DELAY_MS,
  ) {
    session.onReset(() => {
      if (this.timer) clearTimeout(this.timer);
      if (this.slowTimer) clearTimeout(this.slowTimer);
      this.controller?.abort();
      this.reading = undefined;
      this.controller = undefined;
      this.artworkRead = undefined;
      this.reconcilePending = undefined;
      this.reconcileGeneration++;
      this.reconcileController?.abort();
      this.reconcileController = undefined;
      this.box.update('home', () => initialHome);
      this.box.update('libraries', () => idle());
    });
  }

  /** Read home unless it is already read or being read. */
  ensure(): Promise<void> {
    if (this.box.get().home.load === 'idle') return this.load();
    return this.reading ?? Promise.resolve();
  }

  /** Read home again: the viewer asked, or a retry is due. */
  load(attempt = 0): Promise<void> {
    if (this.reading) return this.reading;
    if (this.timer) clearTimeout(this.timer);
    const controller = new AbortController();
    this.controller = controller;
    const reading = this.read(attempt, controller.signal).finally(() => {
      if (this.reading !== reading) return;
      this.reading = undefined;
      this.controller = undefined;
    });
    this.reading = reading;
    return reading;
  }

  /** The viewer explicitly asked to try again. Stop this read, then start one replacement. */
  async retry(): Promise<void> {
    const reading = this.reading;
    if (reading) {
      this.controller?.abort();
      await reading;
    }
    await this.load();
  }

  private async read(attempt: number, signal: AbortSignal): Promise<void> {
    const epoch = this.session.epoch;
    if (this.slowTimer) clearTimeout(this.slowTimer);
    this.box.update('home', home => ({ ...home, ...loading(home), retry: null, slow: false }));
    const slowTimer = setTimeout(() => {
      if (epoch !== this.session.epoch) return;
      this.box.update('home', home => homePresentation(home.load, home.value !== undefined, HOME_SLOW_MS) === 'slow'
        ? { ...home, slow: true }
        : home);
    }, this.slowDelayMs);
    this.slowTimer = slowTimer;
    try {
      const connection = await this.session.ready();
      const api = connection.adapter;
      await this.session.negotiate(api);
      const home = await api.home(false, signal);
      const bootstrap: V.Bootstrap = { ...home, capabilities: advertise(api, home.capabilities) };
      this.session.check(epoch, 'home');
      this.session.features = bootstrap.capabilities.features;
      this.session.searchCapabilities = bootstrap.capabilities;
      this.settleExperiences();
      const images = await connection.images();
      const model = homeModel(bootstrap, images, this.artWidth());
      this.box.update('home', home => ({ ...home, ...ready(model), slow: false, rowsLoading: [], moreRows: 'idle' }));
    } catch (error) {
      if (signal.aborted) return;
      if (epoch !== this.session.epoch) return;
      const retry = retryPolicy(error, attempt);
      this.box.update('home', home => ({ ...home, ...failed(error, home), retry, slow: false }));
      if (retry.allowed && attempt < retry.limit) {
        this.timer = setTimeout(() => void this.load(attempt + 1), retry.delaySeconds * 1000);
      }
    } finally {
      clearTimeout(slowTimer);
      if (this.slowTimer === slowTimer) this.slowTimer = undefined;
    }
  }

  private artworkRead: Promise<HomeModel> | undefined;

  /** Refresh signed hero art without replacing the carousel, progress or paged rows. */
  async refreshArtwork(id: string): Promise<{ backdrop: string; poster: string } | undefined> {
    if (!this.artworkRead) {
      const epoch = this.session.epoch;
      const read = (async () => {
        const connection = await this.session.ready();
        const bootstrap = await connection.adapter.home(true);
        const images = await connection.images();
        this.session.check(epoch, 'hero artwork');
        return homeModel({ ...bootstrap, capabilities: advertise(connection.adapter, bootstrap.capabilities) }, images, this.artWidth());
      })();
      this.artworkRead = read;
      void read.finally(() => { if (this.artworkRead === read) this.artworkRead = undefined; }).catch(() => {});
    }
    const epoch = this.session.epoch;
    const model = await this.artworkRead;
    let fresh = model.hero.find(hero => hero.id === id);
    if (!fresh) {
      const connection = await this.session.ready();
      const detail = await connection.adapter.detail(id, true);
      fresh = card(detail.title, '', await connection.images(), this.artWidth());
    }
    this.session.check(epoch, 'hero artwork');
    this.box.update('home', home => !home.value ? home : ({ ...home, value: {
      ...home.value, hero: home.value.hero.map(hero => {
        const art = hero.id === id ? fresh : model.hero.find(item => item.id === hero.id);
        return art ? { ...hero, backdrop: art.backdrop, poster: art.poster, logo: art.logo } : hero;
      }),
    } }));
    return fresh;
  }

  /** Where the viewer left a title, applied at once to Continue Watching and the hero. */
  watched(watched: Watched): void {
    this.box.update('home', home => (home.value ? { ...home, value: homeWatched(home.value, watched) } : home));
  }

  /**
   * Re-read the progress shelves once, with no position to wait for: reading progress (a book's
   * place is a locator, not seconds) changes Continue rows the way a playback stop does.
   */
  refreshProgress(): Promise<void> {
    return this.reconcile(ANY_PROGRESS);
  }

  /** Re-read only the server-owned progress presentation after a confirmed playback stop. */
  reconcile(watched: Watched): Promise<void> {
    this.reconcilePending = watched;
    this.reconcileGeneration++;
    this.reconcileController?.abort();
    if (!this.reconcileReading) {
      const reading = this.drainReconciles().finally(() => {
        if (this.reconcileReading === reading) this.reconcileReading = undefined;
      });
      this.reconcileReading = reading;
    }
    return this.reconcileReading;
  }

  private async drainReconciles(): Promise<void> {
    while (this.reconcilePending) {
      const watched = this.reconcilePending;
      this.reconcilePending = undefined;
      const generation = this.reconcileGeneration;
      const controller = new AbortController();
      this.reconcileController = controller;
      await this.reconcileOne(watched, generation, controller.signal);
      if (this.reconcileController === controller) this.reconcileController = undefined;
    }
  }

  private async reconcileOne(watched: Watched, generation: number, signal: AbortSignal): Promise<void> {
    const epoch = this.session.epoch;
    for (let attempt = 0; attempt <= RECONCILE_RETRIES; attempt++) {
      try {
        const connection = await this.session.ready();
        const bootstrap = await connection.adapter.home(true, signal);
        const images = await connection.images();
        this.session.check(epoch, 'home progress');
        if (signal.aborted || generation !== this.reconcileGeneration) return;
        const fresh = homeModel({ ...bootstrap, capabilities: advertise(connection.adapter, bootstrap.capabilities) }, images, this.artWidth());
        const value = homeCard(fresh, watched.titleId);
        const serverRecorded = watched === ANY_PROGRESS || (watched.finished || value !== undefined) && recorded(value, watched);
        if (!serverRecorded && attempt < RECONCILE_RETRIES) {
          await wait(this.reconcileDelayMs * (attempt + 1), signal);
          continue;
        }
        if (!serverRecorded) return;
        // Progress shelves that came with a later page (not in the fresh first page) are read
        // again one by one; one that cannot be read keeps what it shows.
        const shown = this.box.get().home.value;
        const later = shown ? (await Promise.all(laterProgressRows(shown, fresh).map(row => connection.adapter.row(row.id, undefined, PAGE_ITEMS)
          .then(value => feedRow(value, images, this.artWidth()), () => undefined)))).filter((row): row is Row => !!row) : [];
        this.session.check(epoch, 'home progress');
        if (signal.aborted || generation !== this.reconcileGeneration) return;
        this.box.update('home', home => ({
          ...home,
          value: home.value ? reconcileHomeProgress(home.value, fresh, later) : home.value,
          progressRevision: home.progressRevision + 1,
        }));
        return;
      } catch {
        if (signal.aborted || epoch !== this.session.epoch) return;
        // A background correction never replaces the Home page with an error.
        return;
      }
    }
  }

  /** The next page of rows, without the heroes' titles and without rows already shown. */
  async moreRows(): Promise<void> {
    const state = this.box.get().home;
    const model = state.value;
    if (!model || !model.nextCursor || state.moreRows === 'loading' || state.moreRows === 'end') return;
    const epoch = this.session.epoch;
    const cursor = model.nextCursor;
    this.box.update('home', home => ({ ...home, moreRows: 'loading' }));
    try {
      const connection = await this.session.ready();
      const data = await connection.adapter.rows({ cursor, placement: 'home' });
      if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) {
        throw new Error('Invalid home row continuation');
      }
      const images = await connection.images();
      this.session.check(epoch, 'home rows');
      const featured = new Set(model.hero.map(card => card.id));
      const known = new Set(model.rows.map(row => row.id));
      const rows = data.items
        .filter(row => !known.has(row.id) && !!known.add(row.id))
        .map(row => {
          const items = row.items.filter(item => item.kind !== 'title' || !featured.has(item.title.id));
          return feedRow({ ...row, items }, images, this.artWidth());
        })
        .filter(row => row.items.length > 0);
      this.box.update('home', home => {
        if (!home.value || home.value.nextCursor !== cursor) return home;
        const value = { ...home.value, rows: [...home.value.rows, ...rows], nextCursor: data.nextCursor ?? '' };
        return { ...home, value, moreRows: data.continuation === 'more' ? 'idle' : 'end' };
      });
    } catch {
      if (epoch === this.session.epoch) this.box.update('home', home => ({ ...home, moreRows: 'failed' }));
    }
  }

  /** The next items of one row, appended in the server's order. */
  async rowItems(rowId: string): Promise<void> {
    const state = this.box.get().home;
    const row = state.value?.rows.find(r => r.id === rowId);
    if (!state.value || !row || !row.nextCursor || row.continuation !== 'more' || state.rowsLoading.includes(rowId)) return;
    const epoch = this.session.epoch;
    const cursor = row.nextCursor;
    const featured = new Set(state.value.hero.map(card => card.id));
    this.setRowLoading(rowId, true);
    try {
      const connection = await this.session.ready();
      const data = await connection.adapter.row(rowId, cursor, PAGE_ITEMS);
      if (data.id !== rowId) throw new Error('Wrong row returned');
      if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) {
        throw new Error('Invalid home item continuation');
      }
      const images = await connection.images();
      this.session.check(epoch, 'home row');
      this.box.update('home', home => {
        const current = home.value?.rows.find(r => r.id === rowId);
        if (!home.value || !current || current.nextCursor !== cursor) return home;
        const seen = new Set(current.items.map(item => item.id));
        const items = data.items
          .filter(item => item.kind !== 'title' || !featured.has(item.title.id))
          .map(item => entry(item, images, this.artWidth()))
          .filter(item => !seen.has(item.id) && !!seen.add(item.id));
        const next: Row = {
          ...current,
          items: [...current.items, ...items],
          nextCursor: data.nextCursor ?? '',
          continuation: data.continuation,
        };
        const rows = home.value.rows.map(r => (r.id === rowId ? next : r));
        return { ...home, value: { ...home.value, rows } };
      });
    } catch {
      // The row keeps its cursor; the viewer can page again.
    } finally {
      if (epoch === this.session.epoch) this.setRowLoading(rowId, false);
    }
  }

  private setRowLoading(rowId: string, on: boolean): void {
    this.box.update('home', home => {
      const rowsLoading = home.rowsLoading.filter(id => id !== rowId);
      if (on) rowsLoading.push(rowId);
      return { ...home, rowsLoading };
    });
  }

  /** Every library, as shell destinations; a list the server cannot finish is a failure, not a partial list. */
  async libraries(): Promise<void> {
    const epoch = this.session.epoch;
    this.box.update('libraries', libraries => loading(libraries));
    try {
      const connection = await this.session.ready();
      const images = await connection.images();
      const items: Destination[] = [];
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let n = 0; n < LIBRARY_PAGES; n++) {
        const page = await connection.adapter.libraries({ cursor, limit: 100 });
        for (const { id, name, kind, artwork, dateDisplay = 'year', media, presentation } of page.items) {
          const image = artwork.find(a => a.kind === 'backdrop');
          items.push({ id, name, kind, dateDisplay, ...(media ? { media: mediaClass(media) } : {}), ...(presentation ? { presentation } : {}),
            experience: libraryExperience({ media, presentation }, this.session.features?.libraryExperiences), backdrop: image ? artworkURL(image, 960, 540, images) ?? '' : '' });
        }
        if (page.continuation === 'exhausted') {
          this.session.check(epoch, 'libraries');
          this.box.update('libraries', () => ready(items));
          // A server that does not declare its library tabs is probed for library views, which
          // reads a collections route some servers answer in tens of seconds: the shell never
          // waits on it. The list is published again once the probe answers, so library pages
          // drawn meanwhile learn whether they can recommend.
          const first = items.find(item => item.kind !== 'live');
          const adapter = connection.adapter;
          if (first && 'probeLibraryViews' in adapter && typeof adapter.probeLibraryViews === 'function') {
            void (adapter.probeLibraryViews(first.id) as Promise<void>).then(() => {
              if (epoch === this.session.epoch && this.box.get().libraries.value === items) this.box.update('libraries', () => ready([...items]));
            }, () => { /* Library browsing remains usable if probing fails. */ });
          }
          return;
        }
        if (page.continuation !== 'more' || !page.nextCursor || seen.has(page.nextCursor)) {
          throw new Error('Library list is incomplete');
        }
        cursor = page.nextCursor;
        seen.add(cursor);
      }
      throw new Error('Library list exceeds page limit');
    } catch (error) {
      if (epoch === this.session.epoch) this.box.update('libraries', libraries => failed(error, libraries));
    }
  }

  /** Libraries listed before the server's features were known chose by class alone: choose again. */
  private settleExperiences(): void {
    const libraries = this.box.get().libraries;
    const feature = this.session.features?.libraryExperiences;
    if (!libraries.value?.some(item => item.experience !== libraryExperience(item, feature))) return;
    this.box.update('libraries', current => current.value
      ? { ...current, value: current.value.map(item => ({ ...item, experience: libraryExperience(item, feature) })) }
      : current);
  }

  ensureLibraries(): void {
    if (this.box.get().libraries.load === 'idle') void this.libraries();
  }
}

/** When to read home again: the server's retry policy and Retry-After, backing off, at most a minute. */
function retryPolicy(error: unknown, attempt: number): HomeRetry & { limit: number } {
  const retry = error instanceof VelaError ? error.detail.retry : undefined;
  const header = error instanceof VelaError ? Number(error.retryAfter) : 0;
  const hint = Number.isFinite(retry?.afterSeconds) ? Math.max(0, retry!.afterSeconds!) : 0;
  const delaySeconds = Math.max(1, 2 ** Math.min(attempt, 5), hint, Number.isFinite(header) ? header : 0);
  const maxAttempts = Number.isFinite(retry?.maxAttempts) ? Math.floor(retry!.maxAttempts!) : 3;
  const limit = Math.max(0, Math.min(2, maxAttempts - 1));
  return { allowed: retry?.allowed === true && delaySeconds <= 60, delaySeconds, attempt, limit };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() { signal.removeEventListener('abort', aborted); resolve(); }
    function aborted() { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason); }
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

