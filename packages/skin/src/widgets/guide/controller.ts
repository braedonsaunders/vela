// Live TV's state, one per signed-in server: the minute clock, the guide's day of listings, the
// preview tile and channel flicking. Surfaces open it while they are on screen (the guide, a live
// home, live watch); with none open it holds no clock, loads nothing and keeps no session.
// React reads it through useSyncExternalStore (hooks.ts); documents read it as env.live.
import type { Snapshot } from '@vela/player-api';
import { advanceGuideClock, loadGuide, time, guideRetry, type Images, type GuideChannel, type GuideModel } from '@vela/core';
import type { LiveSource } from './source';
import { Tile, type TileView } from './tile';
import { Zap } from './zap';
import { guideFailure } from './diagnostics';
import { coversRange, timeWindow } from './navigation';
import { requestedDays, timeline } from './timeline';

export type Surface = 'guide' | 'home' | 'watch';

export interface LiveView {
  /** The shown day's listings: loading the first time or after a day change, then ready. */
  load: 'idle' | 'loading' | 'failed' | 'ready';
  guide: GuideModel | null;
  day: number;
  /** The minute clock, locale-formatted (env.clock). */
  clock: string;
  tile: TileView;
  /** The channel on the monitor, or the one being dialled while flicking. */
  tunedId: string;
  /** The number being dialled on a live home's monitor. */
  zapping: string;
  /** The channel being dialled in live watch, before it retunes. */
  watchZap: string;
}

interface GuideTiming {
  now(): number;
  set(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clear(timer: ReturnType<typeof setTimeout> | undefined): void;
}
const REAL_TIME: GuideTiming = { now: () => Date.now(), set: (callback, delay) => setTimeout(callback, delay), clear: timer => clearTimeout(timer) };

export interface LiveOptions {
  /** Deterministic guide scheduling; hosts normally use the system clock. */
  timing?: GuideTiming;
  source: LiveSource;
  /** Cache scope for listings: the server and viewer. */
  scope: string;
  images?: Images;
  /** Where the viewer's current channel is remembered across launches. */
  memory: { get(key: string): string | null; set(key: string, value: string): void };
  /** Open full-screen live watch; `replace` swaps the watched channel in place. */
  openWatch(channelId: string, replace: boolean): void;
}

const MINUTE = 60000;
const DAYS = 7;
const HOME_ZAP_WAIT = 800;
const WATCH_ZAP_WAIT = 1100;

export class LiveController {
  private disposed = false;
  private readonly backoff: ReturnType<typeof guideRetry>;
  private readonly timing: GuideTiming;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly surfaces = new Map<Surface, number>();
  private readonly tile: Tile;
  private readonly homeZap: Zap;
  private readonly watchZap: Zap;
  private current: LiveView;
  private now = 0;
  private pendingRead: object | undefined;
  private clockUntil = 0;
  private readonly prefetchedClock = new Set<number>();
  private day = 0;
  private load: LiveView['load'] = 'idle';
  private guide: GuideModel | null = null;
  private readonly blocks = new Map<number, GuideModel>();
  private readonly loadedChannels = new WeakMap<GuideModel, Set<string>>();
  private firstDay = 0;
  private lastDay = 0;
  private loadGeneration = 0;
  private guideIds: string[] = [];
  private guideIdsKey = "";
  private guideRange: { from: number; to: number } | undefined;
  private retainedIds: string[] = [];
  private unavailableTimer: ReturnType<typeof setTimeout> | undefined;
  private viewportTimer: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private quiet = false;
  private canPreview = false;

  constructor(private readonly options: LiveOptions) {
    this.timing = options.timing ?? REAL_TIME;
    this.backoff = guideRetry(options.scope);
    this.tile = new Tile(
      options.source,
      () => this.emit(),
      id => this.watchNow(id, false),
    );
    this.homeZap = new Zap(
      HOME_ZAP_WAIT,
      () => this.channels(),
      id => this.preview(id),
      () => { this.scheduleFetch(); this.emit(); },
    );
    this.watchZap = new Zap(
      WATCH_ZAP_WAIT,
      () => this.channels(),
      id => { this.tile.enterWatch(id); this.watchNow(id, true); },
      () => { this.scheduleFetch(); this.emit(); },
    );
    this.current = this.compose();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  view = (): LiveView => this.current;

  /** A surface is on screen until the returned function runs. */
  open(surface: Surface): () => void {
    if (this.disposed) return () => {};
    this.surfaces.set(surface, (this.surfaces.get(surface) ?? 0) + 1);
    this.sync();
    return () => {
      const left = (this.surfaces.get(surface) ?? 1) - 1;
      if (left > 0) this.surfaces.set(surface, left);
      else this.surfaces.delete(surface);
      if (surface === 'home') this.homeZap.cancel();
      if (surface === 'watch') this.watchZap.cancel();
      this.sync();
    };
  }

  /** The app is in the foreground (the tab is visible). */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.sync();
  }

  /** Reduced motion or Save-Data: the tile waits for tuneIn. */
  setQuiet(quiet: boolean): void {
    this.quiet = quiet;
    this.sync();
  }

  /** Whether the app has a player view to draw the tile's picture. */
  setCanPreview(canPreview: boolean): void {
    this.canPreview = canPreview;
    this.sync();
  }

  chooseDay(day: number): void {
    const next = Math.max(0, Math.min(DAYS - 1, Math.round(day)));
    this.day = next;
    this.firstDay = Math.min(this.firstDay, next);
    this.lastDay = Math.max(this.lastDay, next);
    if (this.blocks.has(next)) this.guide = timeline(this.blocks, this.day);
    this.fetch();
    this.emit();
  }

  setGuideChannels(ids: string[]): void {
    const next = [...new Set(ids)].sort();
    const key = next.join("|");
    if (key === this.guideIdsKey) return;
    this.guideIds = next;
    this.guideIdsKey = key;
    this.scheduleFetch();
  }

  setGuideRange(from: number, to: number): void {
    const previous = this.guideRange;
    this.guideRange = { from, to };
    if (!previous || Math.floor(previous.from / 180) !== Math.floor(from / 180) || Math.ceil(previous.to / 180) !== Math.ceil(to / 180)) this.scheduleFetch();
    if (!this.guide || !this.blocks.size) return;
    const loaded = [...this.blocks.keys()].sort((a, b) => a - b);
    let changed = false;
    for (const day of requestedDays(loaded[0]!, loaded[loaded.length - 1]!, from, to, this.guide.minutes)) {
      if (day < this.firstDay) { this.firstDay = day; changed = true; }
      if (day > this.lastDay) { this.lastDay = day; changed = true; }
    }
    if (changed) this.scheduleFetch();
  }

  setRetainedChannels(ids: string[]): void {
    const next = [...new Set(ids.filter(Boolean))].sort();
    if (next.join("|") === this.retainedIds.join("|")) return;
    const added = next.filter(id => !this.retainedIds.includes(id) && !this.guideIds.includes(id));
    this.retainedIds = next;
    if (added.length) this.scheduleFetch();
  }

  private scheduleFetch(): void {
    if (this.disposed) return;
    if (this.backoff.remaining(this.timing.now())) { this.armRetry(); return; }
    ++this.loadGeneration;
    this.timing.clear(this.viewportTimer);
    this.viewportTimer = this.timing.set(() => { this.viewportTimer = undefined; this.fetch(); }, 100);
  }

  retry(): void {
    if (this.backoff.remaining(this.timing.now())) { this.armRetry(); return; }
    this.load = 'loading';
    this.fetch();
    this.emit();
  }

  // ---- The tile ----

  /** Put a channel on the monitor; a live home remembers it as the viewer's current channel. */
  preview(channelId: string): void {
    this.tile.retune(channelId);
    if (!this.guideIds.includes(channelId)) this.scheduleFetch();
    this.remember(channelId);
  }

  /** Seed the guide once; subsequent focus changes never call preview. */
  initializePreview(channelId: string): void {
    if (channelId && !this.options.memory.get(this.rememberKey)) this.preview(channelId);
  }

  /** Show the owned live session full screen. */
  watch(channelId: string): void {
    if (!channelId) return;
    this.tile.watch(channelId);
  }

  enterWatch(channelId: string): void {
    this.tile.enterWatch(channelId);
  }

  leaveWatch(channelId: string): void {
    if (this.tile.target !== channelId) return;
    this.tile.leaveWatch();
    this.sync();
  }

  updateWatchPlan(plan: import('../../../../protocol/types').PlaybackPlan): void {
    this.tile.updatePlan(plan);
  }

  tuneIn(): void {
    this.tile.tuneIn();
  }

  toggleMute(): void {
    this.tile.toggleMute();
  }

  retryPreview(): void {
    this.tile.retryStop();
    this.tile.retune(this.tile.target);
    this.tile.tuneIn();
  }

  tileSnapshot(snapshot: Snapshot): void {
    this.tile.snapshot(snapshot);
    if (this.tile.view().state === 'playing') this.remember(this.tile.target);
  }

  tileFailed(sessionId?: string): void {
    if (!sessionId || this.tile.view().plan?.sessionId === sessionId) this.tile.fail();
  }

  // ---- Flicking ----

  /** A live home's monitor: move the dialled channel; it retunes once the viewer pauses. */
  zapHome(step: number): void {
    if (this.surfaces.has('home') || this.surfaces.has('guide')) this.homeZap.step(step, this.tile.target);
  }

  /** Live watch: the same, from the channel being watched. */
  zapWatch(step: number, playingId: string): void {
    if (this.surfaces.has('watch')) this.watchZap.step(step, playingId);
  }

  commitWatchZap(): void {
    this.watchZap.commit();
  }

  cancelWatchZap(): void {
    this.watchZap.cancel();
  }

  dispose(): void {
    this.disposed = true;
    ++this.loadGeneration;
    this.surfaces.clear();
    this.timing.clear(this.timer);
    this.timing.clear(this.viewportTimer);
    this.timing.clear(this.unavailableTimer);
    this.timing.clear(this.retryTimer);
    this.homeZap.cancel();
    this.watchZap.cancel();
    this.tile.dispose();
    this.listeners.clear();
  }

  // ---- Inside ----

  private channels(): GuideChannel[] {
    return this.guide?.channels ?? [];
  }

  private get rememberKey(): string {
    return `vela.live.channel.${this.options.scope}`;
  }

  private remember(channelId: string): void {
    this.options.memory.set(this.rememberKey, channelId);
  }

  private watchNow(channelId: string, replace: boolean): void {
    this.remember(channelId);
    this.options.openWatch(channelId, replace);
  }

  private get active(): boolean {
    return this.visible && this.surfaces.size > 0;
  }

  /** Start or stop the clock with the surfaces, and re-decide the tile. */
  private sync(): void {
    if (this.disposed) return;
    if (this.active && this.timer === undefined) { this.pendingRead = {}; this.tick(); this.fetch(); }
    if (!this.active && this.timer !== undefined) {
      this.timing.clear(this.timer);
      this.timer = undefined;
    }
    if (!this.active) {
      this.timing.clear(this.unavailableTimer); this.unavailableTimer = undefined;
      this.timing.clear(this.retryTimer); this.retryTimer = undefined;
      this.timing.clear(this.viewportTimer); this.viewportTimer = undefined;
    }
    this.updateTile();
    this.emit();
  }

  private tick = (): void => {
    this.now = this.timing.now();
    this.timer = this.timing.set(this.tick, MINUTE - (this.now % MINUTE) + 50);
    if (this.load === 'idle') this.load = 'loading';
    const advanced = new Map<number, GuideModel>();
    let shift = 0;
    for (const [day, block] of this.blocks) {
      const next = advanceGuideClock(block, this.now);
      shift = day - next.day;
      if (next.day >= -1) advanced.set(next.day, next);
    }
    if (advanced.size) {
      this.blocks.clear(); for (const [day, block] of advanced) this.blocks.set(day, block);
      this.day = Math.max(0, this.day - shift);
      this.firstDay = Math.min(...advanced.keys()); this.lastDay = Math.max(...advanced.keys());
      this.guide = timeline(this.blocks, this.day);
    } else if (this.blocks.size) {
      this.blocks.clear();
      this.day = this.firstDay = this.lastDay = 0;
      this.clockUntil = 0;
      this.guideRange = undefined;
      // The clock has left every retained day (for example after a long sleep).
      if (!this.pendingRead) this.scheduleFetch();
    }
    this.prefetchClock();
    this.emit();
  };

  /** Load missing coverage or explicitly revalidate an open/resume; never a clock tick. */
  private fetch(): void {
    if (this.disposed || !this.now || !this.active) return;
    if (this.backoff.remaining(this.timing.now())) { this.armRetry(); return; }
    const generation = ++this.loadGeneration;
    const read = this.pendingRead;
    const channels = this.guide?.channels ?? [];
    const retained = [this.tile.target, this.options.memory.get(this.rememberKey) ?? '', this.homeZap.target, this.watchZap.target, ...this.retainedIds];
    for (const id of [this.homeZap.target, this.watchZap.target]) {
      const at = channels.findIndex(c => c.id === id);
      if (at >= 0) retained.push(channels[(at + channels.length - 1) % channels.length]!.id, channels[(at + 1) % channels.length]!.id);
    }
    const base = this.surfaces.has('guide') && this.guideIds.length ? this.guideIds : channels.slice(0, 48).map(c => c.id);
    const ids = [...new Set([...base, ...retained].filter(Boolean))].sort();
    const days = Array.from({ length: this.lastDay - this.firstDay + 1 }, (_, i) => this.firstDay + i).filter(day => {
      if (day < 0) return false;
      if (!this.guideRange || !this.blocks.has(day) || day === this.day) return true;
      const start = this.guide?.dayStarts?.[day] ?? day * 1440;
      return start < this.guideRange.to && start + this.blocks.get(day)!.minutes > this.guideRange.from;
    });
    Promise.all(days.map(offset => {
      const block = this.blocks.get(offset);
      const range = this.surfaces.has('guide') && this.guideRange
        ? timeWindow(this.guideRange.from, this.guideRange.to, this.guide?.dayStarts?.[offset] ?? offset * 1440, block?.minutes ?? 1440)
        : { from: -1, to: 0 };
      let loaded = block && this.loadedChannels.get(block);
      if (block && !loaded) {
        loaded = new Set(block.channels.filter(channel => channel.listingsLoaded && !channel.listingsUnavailable).map(channel => channel.id));
        this.loadedChannels.set(block, loaded);
      }
      if (!read && block && range.from >= 0 && (block.currentUntil ?? 0) >= this.clockUntil
        && coversRange(block.loadedRanges ?? [], range.from, range.to)
        && ids.every(id => loaded?.has(id))) {
        return Promise.resolve(advanceGuideClock(block, this.now));
      }
      return loadGuide(this.options.source, offset, this.now, this.options.scope, this.options.images, undefined, ids, range,
        { clock: () => this.timing.now(), revalidate: read, currentUntil: this.clockUntil });
    })).then(
      models => {
        if (generation !== this.loadGeneration) return;
        this.now = Math.max(this.now, Math.floor(this.timing.now() / MINUTE) * MINUTE);
        for (const model of models) {
          const current = advanceGuideClock(model, this.now);
          this.blocks.set(current.day, current);
        }
        // A request started before midnight can finish on the next day. Load today's
        // missing block before giving initial focus to a programme from yesterday.
        if (this.day === 0 && !this.blocks.has(0)) {
          this.firstDay = Math.min(0, ...this.blocks.keys()); this.lastDay = Math.max(0, ...this.blocks.keys());
          this.scheduleFetch();
          if (!this.guide) return;
        }
        this.guide = timeline(this.blocks, this.day);
        this.load = 'ready';
        this.clockUntil = Math.max(this.clockUntil, ...models.map(model => model.currentUntil ?? 0));
        if (this.pendingRead === read) this.pendingRead = undefined;
        if (this.backoff.remaining(this.timing.now())) this.armRetry();
        else { this.timing.clear(this.retryTimer); this.retryTimer = undefined; }
        this.timing.clear(this.unavailableTimer);
        this.updateTile();
        if (!base.length && models[0]?.channels.length) this.scheduleFetch();
        this.prefetchClock();
        this.emit();
      },
      error => {
        if (this.disposed) return;
        if (this.backoff.remaining(this.timing.now())) {
          this.timing.clear(this.viewportTimer); this.viewportTimer = undefined;
          this.timing.clear(this.unavailableTimer); this.unavailableTimer = undefined;
          this.armRetry();
        }
        if (generation !== this.loadGeneration) return;
        guideFailure(error);
        console.warn('Vela could not load the guide', error);
        if (!this.guide) this.load = 'failed';
        this.emit();
      },
    );
  }

  /** A window is extended once before the local clock reaches its retained edge. */
  private prefetchClock(): void {
    if (!this.active || this.pendingRead || this.backoff.remaining(this.timing.now())) return;
    const until = Math.max(...[...this.blocks.values()].map(block => block.currentUntil ?? 0));
    if (!Number.isFinite(until) || until <= 0 || until - this.now >= 60 * MINUTE || this.prefetchedClock.has(until)) return;
    this.prefetchedClock.add(until);
    this.clockUntil = until + 180 * MINUTE;
    this.scheduleFetch();
  }

  /** One wakeup for the whole scope; clock, focus and routes cannot bypass it. */
  private armRetry(): void {
    if (!this.active || this.retryTimer !== undefined) return;
    const delay = this.backoff.remaining(this.timing.now());
    if (!delay) return;
    this.retryTimer = this.timing.set(() => {
      this.retryTimer = undefined;
      this.now = this.timing.now();
      this.fetch();
    }, delay);
  }

  private updateTile(): void {
    const surface = this.surfaces.has('guide') || this.surfaces.has('home');
    this.tile.update({
      open: surface && this.visible && this.load === 'ready',
      order: this.guide?.tuneOrder ?? [],
      remembered: this.options.memory.get(this.rememberKey) ?? '',
      quiet: this.quiet,
      canPreview: this.canPreview,
    });
  }

  private compose(): LiveView {
    const tile = this.tile.view();
    const dialled = this.homeZap.target;
    const zapped = dialled ? this.channels().find(c => c.id === dialled) : undefined;
    return {
      load: this.load,
      guide: this.guide,
      day: this.day,
      clock: this.now ? time(this.now) : '',
      tile,
      tunedId: dialled || tile.channelId,
      zapping: zapped?.number ?? '',
      watchZap: this.watchZap.target,
    };
  }

  private emit(): void {
    this.current = this.compose();
    for (const listener of this.listeners) listener();
  }
}
