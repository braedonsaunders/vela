// Live TV's state, one per signed-in server: the minute clock, the guide's day of listings, the
// preview tile and channel flicking. Surfaces open it while they are on screen (the guide, a live
// home, live watch); with none open it holds no clock, loads nothing and keeps no session.
// React reads it through useSyncExternalStore (hooks.ts); documents read it as env.live.
import type { Snapshot } from '../../../../../client/player/model';
import type { Images } from '../../../../../client/src/discovery/artwork';
import { loadGuide, type GuideChannel, type GuideModel } from '../../../../../client/src/live/guide';
import { time } from '../../../../../client/foundation/i18n';
import type { LiveSource } from './source';
import { Tile, type TileView } from './tile';
import { Zap } from './zap';

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

export interface LiveOptions {
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
  private readonly listeners = new Set<() => void>();
  private readonly surfaces = new Map<Surface, number>();
  private readonly tile: Tile;
  private readonly homeZap: Zap;
  private readonly watchZap: Zap;
  private current: LiveView;
  private now = 0;
  private day = 0;
  private load: LiveView['load'] = 'idle';
  private guide: GuideModel | null = null;
  private loadGeneration = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private visible = true;
  private quiet = false;
  private canPreview = false;

  constructor(private readonly options: LiveOptions) {
    this.tile = new Tile(options.source, () => this.emit(), id => this.watchNow(id, false));
    this.homeZap = new Zap(HOME_ZAP_WAIT, () => this.channels(), id => this.preview(id), () => this.emit());
    this.watchZap = new Zap(WATCH_ZAP_WAIT, () => this.channels(), id => this.watchNow(id, true), () => this.emit());
    this.current = this.compose();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  view = (): LiveView => this.current;

  /** A surface is on screen until the returned function runs. */
  open(surface: Surface): () => void {
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
    if (next === this.day) return;
    this.day = next;
    this.load = 'loading';
    this.guide = null;
    this.fetch();
    this.emit();
  }

  retry(): void {
    this.load = 'loading';
    this.fetch();
    this.emit();
  }

  // ---- The tile ----

  /** Put a channel on the monitor; a live home remembers it as the viewer's current channel. */
  preview(channelId: string): void {
    this.tile.retune(channelId);
    if (this.surfaces.has('home')) this.remember(channelId);
  }

  /** Full-screen watch, after the tile's confirmed stop. */
  watch(channelId: string): void {
    if (!channelId) return;
    this.tile.watch(channelId);
  }

  tuneIn(): void {
    this.tile.tuneIn();
  }

  toggleMute(): void {
    this.tile.toggleMute();
  }

  retryStop(): void {
    this.tile.retryStop();
  }

  tileSnapshot(snapshot: Snapshot): void {
    this.tile.snapshot(snapshot);
  }

  tileFailed(): void {
    this.tile.fail();
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
    clearTimeout(this.timer);
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
    return this.surfaces.size > 0;
  }

  /** Start or stop the clock with the surfaces, and re-decide the tile. */
  private sync(): void {
    if (this.active && this.timer === undefined) this.tick();
    if (!this.active && this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.updateTile();
    this.emit();
  }

  private tick = (): void => {
    this.now = Date.now();
    this.timer = setTimeout(this.tick, MINUTE - (this.now % MINUTE) + 50);
    if (this.load === 'idle') this.load = 'loading';
    this.fetch();
    this.emit();
  };

  /** Project the shown day at the clock's minute; listings are cached, so a re-projection is cheap. */
  private fetch(): void {
    if (!this.now) return;
    const generation = ++this.loadGeneration;
    const day = this.day;
    loadGuide(this.options.source, day, this.now, this.options.scope, this.options.images).then(
      model => {
        if (generation !== this.loadGeneration) return;
        this.guide = model;
        this.load = 'ready';
        this.updateTile();
        this.emit();
      },
      error => {
        if (generation !== this.loadGeneration) return;
        console.warn('Vela could not load the guide', error);
        // The minute's re-projection keeps the day already shown; only a first load fails.
        if (this.guide?.day !== day) this.load = 'failed';
        this.emit();
      },
    );
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
