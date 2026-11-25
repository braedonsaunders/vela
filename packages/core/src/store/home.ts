// Home: the server's heroes and rows, more rows as the viewer scrolls, more items as a row pages,
// and the libraries the shell lists as destinations. A failed home is retried on the server's
// terms (its retry policy and Retry-After), at most twice, then left for the viewer to retry.
import type * as V from '../wire';
import { libraryExperience } from '../library-presentation';
import { mediaClass } from '../media';
import { advertise } from '../adapter/advertise';
import { supersededRow, VelaError } from '../adapter/errors';
import { artworkURL } from '../discovery/artwork';
import { card, entry, feedRow, homeModel, isSurfaceRow } from '../discovery/models';
import { adoptHome, homeCard, homeWatched, matchRows, progressRow, reconcileShelves, recorded, type Watched } from '../discovery/progress';
import type { Card, Destination, HomeModel, Row } from '../models';
import type { Connection } from '../adapter/connection';
import type { Session } from './session';
import { failed, idle, loading, ready, type Load, type Loadable, type StateBox } from './state';
import type { VelaState } from './index';
import { withReadRetry, type ReadRetryOptions } from './read-retry';

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
/** A fresh Home read covers at most this many pages of rows (what the viewer scrolled through). */
const HOME_PAGES = 10;
/** A row's next page holding only items already shown reads on, at most this many pages. */
const ROW_SKIP_PAGES = 5;
/**
 * After a Home progress read starts, the next one waits this long. Every read issues the server's
 * ranking receipts for what it returns, so stops in a row (skipping through audiobook parts,
 * zapping between titles) share one read instead of one each; the first after a quiet spell runs
 * at once. The watched position itself is drawn locally at once (`watched`).
 */
export const RECONCILE_SPACING_MS = 30_000;
export const HOME_SLOW_MS = 7_000;
/** A reconcile that takes the server's answer as it is. */
const ANY_PROGRESS: Watched = { titleId: '', positionSeconds: 0, finished: false };

/** Whether a stop of this media class can change Home's progress shelves. Music (a track, a
 * concert's audio) and photos never enter Continue, so their stops leave Home alone; an unknown
 * class (a video title the caller did not describe) does. */
export function reconcilesHome(media?: V.MediaClass): boolean {
  return media !== 'music' && media !== 'photo';
}

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
  /** When the last progress read started, and the wait before the next one (RECONCILE_SPACING_MS). */
  private reconciledAt = Number.NEGATIVE_INFINITY;
  private reconcileSpacing: AbortController | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly artWidth: () => number,
    private readonly slowDelayMs = HOME_SLOW_MS,
    private readonly reconcileDelayMs = RECONCILE_DELAY_MS,
    private readonly reconcileSpacingMs = RECONCILE_SPACING_MS,
    /** Waits between attempts of a refused fresh read (ReadRetryOptions.sleep); injected by tests. */
    private readonly retrySleep?: ReadRetryOptions['sleep'],
  ) {
    session.onReset(() => {
      if (this.timer) clearTimeout(this.timer);
      if (this.slowTimer) clearTimeout(this.slowTimer);
      this.controller?.abort();
      this.reading = undefined;
      this.controller = undefined;
      this.artworkReads.clear();
      this.reconcilePending = undefined;
      this.reconcileGeneration++;
      this.reconcileController?.abort();
      this.reconcileController = undefined;
      this.reconcileSpacing?.abort();
      this.reconcileSpacing = undefined;
      this.reconciledAt = Number.NEGATIVE_INFINITY;
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

  private readonly artworkReads = new Map<string, Promise<Card>>();

  /**
   * Refresh one hero's signed art (its grant was refused) from the hero's own title, without
   * replacing the carousel, progress or paged rows. Never a Home read: that issues a ranking
   * receipt for every entry, and a hero whose images keep failing (an image service under load)
   * would ask once per carousel turn. Concurrent asks for one hero share a read.
   */
  async refreshArtwork(id: string): Promise<{ backdrop: string; poster: string } | undefined> {
    const epoch = this.session.epoch;
    let read = this.artworkReads.get(id);
    if (!read) {
      const next = (async () => {
        const connection = await this.session.ready();
        const detail = await connection.adapter.detail(id, true);
        return card(detail.title, '', await connection.images(), this.artWidth());
      })();
      read = next;
      this.artworkReads.set(id, next);
      void next.finally(() => { if (this.artworkReads.get(id) === next) this.artworkReads.delete(id); }).catch(() => {});
    }
    const fresh = await read;
    this.session.check(epoch, 'hero artwork');
    this.box.update('home', home => !home.value ? home : ({ ...home, value: {
      ...home.value, hero: home.value.hero.map(hero => hero.id === id ? { ...hero, backdrop: fresh.backdrop, poster: fresh.poster, logo: fresh.logo } : hero),
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

  /**
   * Re-read only the server-owned progress presentation after a confirmed playback stop: the
   * progress shelves Home shows, each on its own, when the title is on one; otherwise Home. A
   * newer stop replaces one waiting or in flight, and reads are spaced (RECONCILE_SPACING_MS).
   */
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
      const due = this.reconciledAt + this.reconcileSpacingMs - Date.now();
      if (due > 0) {
        const spacing = new AbortController();
        this.reconcileSpacing = spacing;
        // A session reset ends the wait (and clears what was pending); a newer stop only replaces it.
        await wait(due, spacing.signal).catch(() => {});
        if (this.reconcileSpacing === spacing) this.reconcileSpacing = undefined;
        continue;
      }
      const watched = this.reconcilePending;
      this.reconcilePending = undefined;
      const generation = this.reconcileGeneration;
      const controller = new AbortController();
      this.reconcileController = controller;
      this.reconciledAt = Date.now();
      await this.reconcileOne(watched, generation, controller.signal);
      if (this.reconcileController === controller) this.reconcileController = undefined;
    }
  }

  private async reconcileOne(watched: Watched, generation: number, signal: AbortSignal): Promise<void> {
    const epoch = this.session.epoch;
    for (let attempt = 0; attempt <= RECONCILE_RETRIES; attempt++) {
      try {
        const connection = await this.session.ready();
        // A title Home already shows on a progress shelf is brought up to date by reading those
        // shelves alone. Anything else (the first stop of a title, an audiobook part whose book is
        // the card, a book's reading place) may need a shelf Home does not show yet: Home itself.
        const shown = this.box.get().home.value?.rows.filter(progressRow) ?? [];
        const holding = watched === ANY_PROGRESS ? [] : shown.filter(row => row.items.some(card => card.id === watched.titleId));
        const read = holding.length ? await this.readShelves(connection, shown) : { rows: [], superseded: false };
        // The shelves that show the title must all have answered; otherwise Home itself. A shelf
        // whose id the server no longer knows (it re-minted Home's row ids when the feed
        // recomputed) means every row id on show is old: Home itself, so none is kept.
        const shelves = !read.superseded && holding.every(row => read.rows.some(fresh => fresh.id === row.id)) ? read.rows : [];
        if (signal.aborted || generation !== this.reconcileGeneration) return;
        let value: Card | undefined;
        let merge: (home: HomeModel) => HomeModel;
        if (shelves.length) {
          value = shelves.flatMap(row => row.items).find(card => card.id === watched.titleId);
          merge = home => reconcileShelves(home, shelves);
        } else {
          const fresh = await this.readFresh(connection, signal);
          this.session.check(epoch, 'home progress');
          if (signal.aborted || generation !== this.reconcileGeneration) return;
          value = homeCard(fresh, watched.titleId);
          merge = home => adoptHome(home, fresh);
        }
        this.session.check(epoch, 'home progress');
        if (signal.aborted || generation !== this.reconcileGeneration) return;
        // A card the server still shows at an older place is read again (it answered before it
        // stored the last report); a title it does not show (a track, an audiobook part, a stop
        // below its resume threshold) is its answer, not a reason to ask again.
        const behind = watched !== ANY_PROGRESS && value !== undefined && !recorded(value, watched);
        if (behind && attempt < RECONCILE_RETRIES) {
          await wait(this.reconcileDelayMs * (attempt + 1), signal);
          continue;
        }
        if (behind) return;
        this.box.update('home', home => {
          const value = home.value ? merge(home.value) : home.value;
          return { ...home, value, progressRevision: home.progressRevision + 1, ...(value !== home.value ? this.paged(home, value) : {}) };
        });
        return;
      } catch {
        if (signal.aborted || epoch !== this.session.epoch) return;
        // A background correction never replaces the Home page with an error.
        return;
      }
    }
  }

  /** Progress shelves read again one by one; one that cannot be read is left out (it keeps what it
   * shows). `superseded`: the server no longer knows one of the ids (404, 409). */
  private async readShelves(connection: Connection, rows: Row[]): Promise<{ rows: Row[]; superseded: boolean }> {
    if (!rows.length) return { rows: [], superseded: false };
    let superseded = false;
    const read = await Promise.all(rows.map(row => connection.adapter.row(row.id, undefined, PAGE_ITEMS).catch(error => {
      if (supersededRow(error)) superseded = true;
      return undefined;
    })));
    const images = await connection.images();
    return { rows: read.filter((row): row is V.Row => !!row).map(row => feedRow(row, images, this.artWidth())), superseded };
  }

  /**
   * Home read afresh as the server has it now: its first page, and further pages until as many
   * rows as Home shows are covered (the viewer scrolled through them), at most HOME_PAGES. A
   * further page that cannot be read ends the read there; its cursor is kept for the next page.
   */
  private async readFresh(connection: Connection, signal: AbortSignal): Promise<HomeModel> {
    // Ether answers 409 bootstrap_changed (retry allowed) while its feed is being rebuilt, which
    // is exactly when a re-read happens: asked again on the server's terms before giving up.
    const bootstrap = await withReadRetry(() => connection.adapter.home(true, signal), { signal, sleep: this.retrySleep });
    const images = await connection.images();
    let fresh = homeModel({ ...bootstrap, capabilities: advertise(connection.adapter, bootstrap.capabilities) }, images, this.artWidth());
    const shown = this.box.get().home.value?.rows.length ?? 0;
    for (let page = 1; page < HOME_PAGES && fresh.nextCursor && fresh.rows.length < shown; page++) {
      if (signal.aborted) break;
      const cursor = fresh.nextCursor;
      const data = await connection.adapter.rows({ cursor, placement: 'home' }, true).catch(() => undefined);
      if (!data || data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) break;
      fresh = { ...fresh, rows: [...fresh.rows, ...this.pageRows(fresh, data.items, images)], nextCursor: data.nextCursor ?? '' };
    }
    return fresh;
  }

  /** A further page of Home's rows: without the heroes' titles and without rows already listed. */
  private pageRows(model: HomeModel, rows: (V.Row | V.SurfaceRow)[], images: Awaited<ReturnType<Connection['images']>>): Row[] {
    const featured = new Set(model.hero.map(card => card.id));
    const known = new Set(model.rows.map(row => row.id));
    return rows
      .filter(row => !known.has(row.id) && !!known.add(row.id))
      .map(row => {
        if (isSurfaceRow(row)) return feedRow(row, images, this.artWidth());
        const items = row.items.filter(item => item.kind !== 'title' || !featured.has(item.title.id));
        return feedRow({ ...row, items }, images, this.artWidth());
      })
      // A plugin's surface row has no items of its own; it keeps its place.
      .filter(row => row.surface || row.items.length > 0);
  }

  /** Home's paging state for an adopted read: its next page from the new cursor; rows being paged
   * that are no longer on show (their id was re-minted) are no longer loading. */
  private paged(home: HomeState, value: HomeModel | undefined): Pick<HomeState, 'moreRows' | 'rowsLoading'> {
    const ids = new Set(value?.rows.map(row => row.id));
    return {
      moreRows: value?.nextCursor ? (home.moreRows === 'loading' ? 'loading' : 'idle') : 'end',
      rowsLoading: home.rowsLoading.filter(id => ids.has(id)),
    };
  }

  /**
   * The row on show as `row` (an id the server may since have re-minted) in Home read afresh now,
   * which Home then shows: for a See all whose row answered 404 or 409. Undefined when the fresh
   * Home has no such row (matched as matchRows does: key, else surface or purpose, name and
   * library). Concurrent asks share one read.
   */
  resolveRow(row: Row): Promise<Row | undefined> {
    const read = this.resolving ??= this.readResolved().finally(() => { if (this.resolving === read) this.resolving = undefined; });
    return read.then(rows => rows && [...matchRows([row], rows).keys()][0]);
  }

  private resolving: Promise<Row[] | undefined> | undefined;

  private async readResolved(): Promise<Row[] | undefined> {
    const epoch = this.session.epoch;
    const connection = await this.session.ready();
    const fresh = await this.readFresh(connection, new AbortController().signal);
    this.session.check(epoch, 'home rows');
    this.box.update('home', home => {
      if (!home.value) return home;
      const value = adoptHome(home.value, fresh);
      return value === home.value ? home : { ...home, value, ...this.paged(home, value) };
    });
    return fresh.rows;
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
      this.box.update('home', home => {
        // Home was read afresh meanwhile: its own cursor pages on (paged).
        if (!home.value || home.value.nextCursor !== cursor) return home.moreRows === 'loading' ? { ...home, moreRows: home.value?.nextCursor ? 'idle' : 'end' } : home;
        const rows = this.pageRows(home.value, data.items, images);
        const value = { ...home.value, rows: [...home.value.rows, ...rows], nextCursor: data.nextCursor ?? '' };
        return { ...home, value, moreRows: data.continuation === 'more' ? 'idle' : 'end' };
      });
    } catch {
      if (epoch === this.session.epoch) this.box.update('home', home => ({ ...home, moreRows: 'failed' }));
    }
  }

  /**
   * The next items of one row, appended in the server's order. A page holding only items already
   * shown (a row read afresh keeps items the viewer paged to) reads on, a few pages at most. A row
   * whose id the server no longer knows (404, 409: re-minted) is found again in Home read afresh
   * (resolveRow), once, and pages on from there.
   */
  async rowItems(rowId: string, resolved = false): Promise<void> {
    const state = this.box.get().home;
    const row = state.value?.rows.find(r => r.id === rowId);
    if (!state.value || !row || !row.nextCursor || row.continuation !== 'more' || state.rowsLoading.includes(rowId)) return;
    const epoch = this.session.epoch;
    const featured = new Set(state.value.hero.map(card => card.id));
    this.setRowLoading(rowId, true);
    let again: Row | undefined;
    try {
      const connection = await this.session.ready();
      for (let page = 0, cursor = row.nextCursor; page < ROW_SKIP_PAGES && cursor; page++) {
        const data = await connection.adapter.row(rowId, cursor, PAGE_ITEMS);
        if (data.id !== rowId) throw new Error('Wrong row returned');
        if (data.continuation === 'more' && (!data.nextCursor || data.nextCursor === cursor)) {
          throw new Error('Invalid home item continuation');
        }
        const images = await connection.images();
        this.session.check(epoch, 'home row');
        let added = 0;
        const read = cursor;
        this.box.update('home', home => {
          const current = home.value?.rows.find(r => r.id === rowId);
          if (!home.value || !current || current.nextCursor !== read) return home;
          const seen = new Set(current.items.map(item => item.id));
          const items = data.items
            .filter(item => item.kind !== 'title' || !featured.has(item.title.id))
            .map(item => entry(item, images, this.artWidth()))
            .filter(item => !seen.has(item.id) && !!seen.add(item.id));
          added = items.length;
          const next: Row = {
            ...current,
            items: [...current.items, ...items],
            nextCursor: data.nextCursor ?? '',
            continuation: data.continuation,
          };
          const rows = home.value.rows.map(r => (r.id === rowId ? next : r));
          return { ...home, value: { ...home.value, rows } };
        });
        const now = this.box.get().home.value?.rows.find(r => r.id === rowId);
        if (added || !now || now.continuation !== 'more') break;
        cursor = now.nextCursor;
      }
    } catch (error) {
      // The row keeps its cursor; the viewer can page again.
      if (!resolved && supersededRow(error) && epoch === this.session.epoch) again = await this.resolveRow(row).catch(() => undefined);
    } finally {
      if (epoch === this.session.epoch) this.setRowLoading(rowId, false);
    }
    if (again && again.id !== rowId) await this.rowItems(again.id, true);
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
        for (const { id, name, kind, artwork, dateDisplay = 'year', media, presentation, tabs, experience } of page.items) {
          const image = artwork.find(a => a.kind === 'backdrop');
          items.push({ id, name, kind, dateDisplay, ...(media ? { media: mediaClass(media) } : {}), ...(presentation ? { presentation } : {}), ...(tabs ? { tabs } : {}),
            ...(experience ? { declaredExperience: experience } : {}),
            experience: libraryExperience({ media, kind, experience }, this.session.features?.libraryExperiences), backdrop: image ? artworkURL(image, 960, 540, images) ?? '' : '' });
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
    const chosen = (item: Destination) => libraryExperience({ media: item.media, kind: item.kind, experience: item.declaredExperience }, feature);
    if (!libraries.value?.some(item => item.experience !== chosen(item))) return;
    this.box.update('libraries', current => current.value
      ? { ...current, value: current.value.map(item => ({ ...item, experience: chosen(item) })) }
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

