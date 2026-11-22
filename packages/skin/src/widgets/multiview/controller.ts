// Live TV multiview: up to four live channels on one screen. One controller per signed-in server
// remembers the chosen channels; the multiview screen opens it while on screen. Opening creates a
// server group (POST /multiview), each tile starts a live playback in that group with its tile index
// and the height it is drawn at, and leaving deletes the group, which ends every tile. Audio follows
// focus: only the focused tile is unmuted. A tile that grows (full screen, the big tile) asks for its
// larger height with a new session in its place, shown once it plays; one that shrinks does so later. A tile the server refuses (a provider connection cap) shows why on
// that tile; the others keep playing.
import type { Command, Snapshot } from '@vela/player-api';
import { VelaError } from '@vela/core';
import type { LiveEventRef, MultiviewTile as MultiviewTileRequest } from '../../../../protocol/live-events';
import type { PlaybackPlan } from '../../../../protocol/types';
import { ladderHeight, layoutsFor, MAX_TILES, settleLayout, type MultiviewLayout } from './layout';
import { tileRefusal, type TileRefusal } from './refusal';

export type { LiveEventRef, MultiviewTile as MultiviewTileRequest } from '../../../../protocol/live-events';

/** The server operations multiview needs; the app builds one from its adapter. */
export interface MultiviewSource {
  open(): Promise<{ groupId: string; maxTiles: number }>;
  /** Ends every tile of the group. */
  close(groupId: string): Promise<void>;
  tune(channelId: string, multiview: MultiviewTileRequest): Promise<PlaybackPlan>;
  stop(plan: PlaybackPlan): Promise<void>;
  /** Follows a tile's session until `signal` aborts: its newer plans and the live event on air. */
  follow?(sessionId: string, on: { plan(plan: PlaybackPlan): void; liveEvent(liveEvent: LiveEventRef | null): void }, signal: AbortSignal): Promise<void>;
}

/** How long a tile's new height must hold before it is asked for: growing soon, shrinking later, so a
 * look at full screen and back does not replace the stream twice. */
const GROW_AFTER_MS = 500;
const SHRINK_AFTER_MS = 6000;
/** A tile's session stream that drops is followed again after this. */
const FOLLOW_RETRY_MS = 5000;

export type TileState = 'waiting' | 'tuning' | 'playing' | 'failed';

export interface MultiviewTile {
  /** The tile's index in the server group (0..3): its identity while it exists. */
  slot: number;
  channelId: string;
  state: TileState;
  plan: PlaybackPlan | null;
  /** A session at the tile's new height, playing hidden until it shows its first picture. */
  next: PlaybackPlan | null;
  refusal: TileRefusal | null;
  /** Playing, but waiting for media: the picture stays (its last frame) and the tile says it is loading. */
  buffering: boolean;
  muted: boolean;
  /** The latest mute command for the tile's player view. */
  command: Command | null;
  liveEvent: LiveEventRef | null;
}

export interface MultiviewView {
  /** closed: off screen; opening: asking for a group; open: tiles play; failed: no group. */
  phase: 'closed' | 'opening' | 'open' | 'failed';
  failure: string | null;
  /** In display order. */
  tiles: MultiviewTile[];
  layout: MultiviewLayout;
  layouts: MultiviewLayout[];
  maxTiles: number;
  /** The focused tile's slot (it has the audio), or -1. */
  focused: number;
  /** The slot shown full screen, or -1. */
  fullscreen: number;
}

interface TileRecord {
  slot: number;
  channelId: string;
  generation: number;
  plan: PlaybackPlan | null;
  next: PlaybackPlan | null;
  /** The height the tile is drawn at (device pixels on the ladder), and the one its plan was asked at. */
  height: number | undefined;
  askedHeight: number | undefined;
  heightTimer: ReturnType<typeof setTimeout> | undefined;
  following: AbortController | null;
  /** The session has shown a picture; `buffering` while it waits for more. */
  playing: boolean;
  buffering: boolean;
  refusal: TileRefusal | null;
  muted: boolean;
  commandId: number;
  command: Command | null;
  liveEvent: LiveEventRef | null;
  askedAgain: boolean;
}

/** Ether supersedes overlapping tunes from one device; that refusal says nothing about the channel. */
const cancelled = (error: unknown) => error instanceof VelaError && error.detail.code === 'cancelled';

export interface MultiviewOptions {
  source: MultiviewSource;
  /** The channel's name, for a refusal's words. */
  channelName?(channelId: string): string;
  /** Diagnostics for a failed server call; never shown. */
  report?(operation: string, error: unknown): void;
}

export class MultiviewController {
  private readonly listeners = new Set<() => void>();
  private tiles: TileRecord[] = [];
  private chosenLayout: MultiviewLayout | null = null;
  private focusedSlot = -1;
  private fullscreenSlot = -1;
  private phase: MultiviewView['phase'] = 'closed';
  private failure: string | null = null;
  private groupId = '';
  private maxTiles = MAX_TILES;
  private openGeneration = 0;
  private current: MultiviewView;
  private disposed = false;

  constructor(private readonly options: MultiviewOptions) {
    this.current = this.compose();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  view = (): MultiviewView => this.current;

  /** The channels on the tiles, in display order. */
  get channels(): string[] {
    return this.tiles.map(tile => tile.channelId);
  }

  // Channels

  /** Adds a channel (from the guide, a channel's actions, the player or a game's watch target). With
   * every tile taken, it replaces the focused tile's channel. Returns the tile's slot. */
  add(channelId: string): number {
    const existing = this.tiles.find(tile => tile.channelId === channelId);
    if (existing) { this.focus(existing.slot); return existing.slot; }
    if (this.tiles.length >= Math.min(this.maxTiles, MAX_TILES)) {
      const target = this.focusedSlot >= 0 ? this.focusedSlot : this.tiles[this.tiles.length - 1]!.slot;
      this.swap(target, channelId);
      return target;
    }
    const used = new Set(this.tiles.map(tile => tile.slot));
    const slot = [0, 1, 2, 3].find(candidate => !used.has(candidate))!;
    const tile: TileRecord = { slot, channelId, generation: 0, plan: null, next: null, height: undefined, askedHeight: undefined, heightTimer: undefined, following: null, playing: false, buffering: false, refusal: null, muted: true, commandId: 0, command: null, liveEvent: null, askedAgain: false };
    this.tiles.push(tile);
    if (this.focusedSlot < 0) this.focusedSlot = slot;
    this.applyAudio();
    if (this.phase === 'open') this.tune(tile);
    this.emit();
    return slot;
  }

  /** Puts another channel on a tile (the tile's channel picker). */
  swap(slot: number, channelId: string): void {
    const tile = this.tile(slot);
    if (!tile) return;
    // A failed tile's own channel picked again (on a TV the picker is what Select opens on a failed
    // tile) is the way to try it again.
    if (tile.channelId === channelId) { if (tile.refusal) this.retry(slot); return; }
    const other = this.tiles.find(candidate => candidate.channelId === channelId);
    if (other) {
      // The channel is already on another tile: the two trade places instead of playing twice.
      const a = this.tiles.indexOf(tile), b = this.tiles.indexOf(other);
      [this.tiles[a], this.tiles[b]] = [other, tile];
      this.focus(other.slot);
      this.emit();
      return;
    }
    this.drop(tile);
    tile.channelId = channelId;
    tile.refusal = null;
    if (this.phase === 'open') this.tune(tile);
    this.emit();
  }

  remove(slot: number): void {
    const tile = this.tile(slot);
    if (!tile) return;
    const index = this.tiles.indexOf(tile);
    this.drop(tile);
    this.tiles.splice(index, 1);
    if (this.fullscreenSlot === slot) this.fullscreenSlot = -1;
    if (this.focusedSlot === slot) this.focusedSlot = this.tiles[Math.min(index, this.tiles.length - 1)]?.slot ?? -1;
    this.applyAudio();
    this.emit();
  }

  /** Moves a tile to the first place (the large tile of the feature layout). */
  promote(slot: number): void {
    const index = this.tiles.findIndex(tile => tile.slot === slot);
    if (index <= 0) return;
    const [tile] = this.tiles.splice(index, 1);
    this.tiles.unshift(tile!);
    this.emit();
  }

  // Presentation

  /** Focus moves the audio: only the focused tile is unmuted. */
  focus(slot: number): void {
    if (slot === this.focusedSlot || !this.tile(slot)) return;
    this.focusedSlot = slot;
    this.applyAudio();
    this.emit();
  }

  setLayout(layout: MultiviewLayout): void {
    if (!layoutsFor(this.tiles.length).includes(layout) || layout === this.chosenLayout) return;
    this.chosenLayout = layout;
    this.emit();
  }

  /** The height a tile is drawn at now, in device pixels (the screen reports it on every layout). */
  setHeight(slot: number, pixels: number): void {
    const tile = this.tile(slot);
    const height = ladderHeight(pixels);
    if (!tile || tile.height === height) return;
    tile.height = height;
    clearTimeout(tile.heightTimer);
    tile.heightTimer = undefined;
    if (!tile.plan || this.phase !== 'open' || tile.askedHeight === height) return;
    const grow = tile.askedHeight === undefined || height > tile.askedHeight;
    tile.heightTimer = setTimeout(() => { tile.heightTimer = undefined; this.regrade(tile); }, grow ? GROW_AFTER_MS : SHRINK_AFTER_MS);
  }

  /** Full screen and back (long-press). Full screen also takes the focus, and so the audio. */
  toggleFullscreen(slot: number): void {
    const tile = this.tile(slot);
    if (!tile) return;
    const entering = this.fullscreenSlot !== slot;
    this.fullscreenSlot = entering ? slot : -1;
    if (entering) { this.focusedSlot = slot; this.applyAudio(); }
    this.emit();
  }

  exitFullscreen(): boolean {
    if (this.fullscreenSlot < 0) return false;
    this.toggleFullscreen(this.fullscreenSlot);
    return true;
  }

  // Lifecycle

  /** The screen is on screen: ask for a group, then tune every tile. Returns the close. */
  open(): () => void {
    if (this.disposed) return () => {};
    const generation = ++this.openGeneration;
    this.phase = 'opening';
    this.failure = null;
    this.emit();
    this.options.source.open().then(
      group => {
        if (generation !== this.openGeneration || this.disposed) {
          void this.options.source.close(group.groupId).catch(error => this.options.report?.('close', error));
          return;
        }
        this.groupId = group.groupId;
        this.maxTiles = Math.max(1, Math.min(MAX_TILES, group.maxTiles || MAX_TILES));
        this.phase = 'open';
        for (const tile of this.tiles.slice(this.maxTiles)) this.remove(tile.slot);
        for (const tile of this.tiles) this.tune(tile);
        this.emit();
      },
      error => {
        if (generation !== this.openGeneration) return;
        this.options.report?.('open', error);
        this.phase = 'failed';
        this.failure = error instanceof Error && error.message ? error.message : 'Multiview is unavailable';
        this.emit();
      },
    );
    return () => this.close(generation);
  }

  private close(generation: number): void {
    if (generation !== this.openGeneration) return;
    this.openGeneration += 1;
    const groupId = this.groupId;
    const plans = this.tiles.map(tile => tile.plan).filter((plan): plan is PlaybackPlan => !!plan);
    for (const tile of this.tiles) this.reset(tile);
    this.groupId = '';
    this.phase = 'closed';
    this.fullscreenSlot = -1;
    if (groupId) {
      // Deleting the group ends every tile; when that fails, each tile is stopped on its own.
      this.options.source.close(groupId).catch(error => {
        this.options.report?.('close', error);
        for (const plan of plans) void this.options.source.stop(plan).catch(stopError => this.options.report?.('stop', stopError));
      });
    }
    this.emit();
  }

  dispose(): void {
    this.close(this.openGeneration);
    this.disposed = true;
    this.listeners.clear();
  }

  // Player reports

  snapshot(slot: number, snapshot: Snapshot): void {
    const tile = this.tile(slot);
    if (tile?.next && snapshot.sessionId === tile.next.sessionId) {
      if (snapshot.state === 'failed') { this.dropNext(tile); this.emit(); return; }
      if (snapshot.state === 'playing' && !snapshot.waiting && snapshot.totalFrames !== 0) this.takeNext(tile);
      return;
    }
    if (!tile?.plan || snapshot.sessionId !== tile.plan.sessionId) return;
    if (snapshot.state === 'failed') {
      this.fail(tile, new Error(snapshot.failure?.message || ''));
      return;
    }
    const playing = snapshot.state === 'playing' && !snapshot.waiting && snapshot.totalFrames !== 0;
    // Once a picture showed, waiting for media keeps it on screen: the tile only says it is loading.
    if (tile.playing) {
      const buffering = !playing && snapshot.state !== 'paused';
      if (buffering === tile.buffering) return;
      tile.buffering = buffering;
      this.emit();
      return;
    }
    if (!playing) return;
    tile.playing = true;
    tile.buffering = false;
    this.emit();
  }

  failed(slot: number, sessionId: string, message: string): void {
    const tile = this.tile(slot);
    if (tile?.next?.sessionId === sessionId) { this.dropNext(tile); this.emit(); return; }
    if (tile?.plan?.sessionId === sessionId) this.fail(tile, new Error(message));
  }

  /** The tile's session has a newer plan (a recovery or a height change). */
  updatePlan(slot: number, plan: PlaybackPlan): void {
    const tile = this.tile(slot);
    if (tile?.next?.sessionId === plan.sessionId) { tile.next = plan; this.emit(); return; }
    if (!tile?.plan || tile.plan.sessionId !== plan.sessionId || plan.revision < tile.plan.revision) return;
    if (plan.state === 'ended') { this.fail(tile, new Error('')); return; }
    tile.plan = plan;
    this.emit();
  }

  /** The programme on a tile's channel matched a live event, or stopped matching (session SSE). */
  setLiveEvent(sessionId: string, liveEvent: LiveEventRef | null): void {
    const tile = this.tiles.find(candidate => candidate.plan?.sessionId === sessionId);
    if (!tile || sameEvent(tile.liveEvent, liveEvent)) return;
    tile.liveEvent = liveEvent;
    this.emit();
  }

  /** Try a failed tile again. */
  retry(slot: number): void {
    const tile = this.tile(slot);
    if (!tile || this.phase !== 'open') return;
    this.drop(tile);
    tile.refusal = null;
    this.tune(tile);
    this.emit();
  }

  // Internals

  private tile(slot: number): TileRecord | undefined {
    return this.tiles.find(tile => tile.slot === slot);
  }

  private tune(tile: TileRecord): void {
    const generation = ++tile.generation;
    const channelId = tile.channelId;
    const request: MultiviewTileRequest = { groupId: this.groupId, tile: tile.slot };
    if (tile.height !== undefined) request.maxHeight = tile.height;
    tile.askedHeight = tile.height;
    tile.playing = false;
    tile.buffering = false;
    this.options.source.tune(channelId, request).then(
      plan => {
        if (generation !== tile.generation || !this.tiles.includes(tile) || this.phase !== 'open') {
          void this.options.source.stop(plan).catch(error => this.options.report?.('stop', error));
          return;
        }
        tile.plan = plan;
        tile.askedAgain = false;
        tile.liveEvent = null;
        this.follow(tile, plan);
        this.emit();
      },
      error => {
        if (generation !== tile.generation || !this.tiles.includes(tile)) return;
        this.options.report?.('tune', error);
        if (cancelled(error) && !tile.askedAgain) {
          tile.askedAgain = true;
          this.tune(tile);
          return;
        }
        this.fail(tile, error);
      },
    );
  }

  private fail(tile: TileRecord, error: unknown): void {
    const name = this.options.channelName?.(tile.channelId) ?? tile.channelId;
    this.drop(tile);
    tile.refusal = tileRefusal(error, name);
    this.emit();
  }

  /** Stops the tile's session, if any, and stops waiting for the one being requested. */
  private drop(tile: TileRecord): void {
    tile.generation += 1;
    tile.playing = false;
    tile.buffering = false;
    tile.liveEvent = null;
    this.unfollow(tile);
    this.dropNext(tile);
    const plan = tile.plan;
    tile.plan = null;
    if (plan) this.stopPlan(plan);
  }

  private stopPlan(plan: PlaybackPlan): void {
    void this.options.source.stop(plan).catch(error => this.options.report?.('stop', error));
  }

  private dropNext(tile: TileRecord): void {
    clearTimeout(tile.heightTimer);
    tile.heightTimer = undefined;
    const next = tile.next;
    tile.next = null;
    if (next) this.stopPlan(next);
  }

  /** Asks for a session at the tile's new height; the current one plays until it shows a picture. */
  private regrade(tile: TileRecord): void {
    if (!tile.plan || this.phase !== 'open' || tile.height === tile.askedHeight) return;
    const generation = tile.generation;
    const height = tile.height;
    const request: MultiviewTileRequest = { groupId: this.groupId, tile: tile.slot, ...(height !== undefined ? { maxHeight: height } : {}) };
    tile.askedHeight = height;
    this.options.source.tune(tile.channelId, request).then(
      plan => {
        if (generation !== tile.generation || !tile.plan || !this.tiles.includes(tile) || this.phase !== 'open') { this.stopPlan(plan); return; }
        if (tile.next) this.stopPlan(tile.next);
        tile.next = plan;
        this.emit();
      },
      error => {
        // The tile keeps playing at its old height; the next change asks again.
        this.options.report?.('height', error);
        if (generation === tile.generation) tile.askedHeight = tile.plan ? undefined : tile.askedHeight;
      },
    );
  }

  /** The new-height session shows its first picture: it takes the tile's place and the old one stops. */
  private takeNext(tile: TileRecord): void {
    const next = tile.next;
    if (!next) return;
    const old = tile.plan;
    tile.next = null;
    tile.plan = next;
    tile.playing = true;
    tile.buffering = false;
    // The new view consumed a muting command with the current id: its own state comes with a new one.
    tile.commandId += 1;
    tile.command = { id: tile.commandId, type: 'mute', muted: tile.muted };
    this.unfollow(tile);
    this.follow(tile, next);
    if (old) this.stopPlan(old);
    this.emit();
  }

  private follow(tile: TileRecord, plan: PlaybackPlan): void {
    const follow = this.options.source.follow;
    if (!follow) return;
    const abort = new AbortController();
    tile.following = abort;
    const sessionId = plan.sessionId;
    const run = () => {
      follow.call(this.options.source, sessionId, {
        plan: next => { if (!abort.signal.aborted) this.updatePlan(tile.slot, next); },
        liveEvent: ref => { if (!abort.signal.aborted) this.setLiveEvent(sessionId, ref); },
      }, abort.signal).catch(error => { if (!abort.signal.aborted) this.options.report?.('follow', error); })
        .finally(() => { if (!abort.signal.aborted && tile.plan?.sessionId === sessionId) setTimeout(() => { if (!abort.signal.aborted && tile.plan?.sessionId === sessionId) run(); }, FOLLOW_RETRY_MS); });
    };
    run();
  }

  private unfollow(tile: TileRecord): void {
    tile.following?.abort();
    tile.following = null;
  }

  /** Forget the session without stopping it (the group's delete ends it). */
  private reset(tile: TileRecord): void {
    tile.generation += 1;
    this.unfollow(tile);
    clearTimeout(tile.heightTimer);
    tile.heightTimer = undefined;
    tile.next = null;
    tile.askedHeight = undefined;
    tile.plan = null;
    tile.playing = false;
    tile.buffering = false;
    tile.liveEvent = null;
    tile.refusal = null;
    tile.askedAgain = false;
  }

  private applyAudio(): void {
    for (const tile of this.tiles) {
      const muted = tile.slot !== this.focusedSlot;
      if (muted === tile.muted && tile.command) continue;
      tile.muted = muted;
      tile.commandId += 1;
      tile.command = { id: tile.commandId, type: 'mute', muted };
    }
  }

  private compose(): MultiviewView {
    return {
      phase: this.phase,
      failure: this.failure,
      tiles: this.tiles.map(tile => ({
        slot: tile.slot,
        channelId: tile.channelId,
        state: tile.refusal ? 'failed' : this.phase !== 'open' ? 'waiting' : !tile.plan ? 'tuning' : tile.playing ? 'playing' : 'tuning',
        plan: tile.plan,
        next: tile.next,
        refusal: tile.refusal,
        buffering: tile.playing && tile.buffering,
        muted: tile.muted,
        command: tile.command,
        liveEvent: tile.liveEvent,
      })),
      layout: settleLayout(this.chosenLayout, this.tiles.length),
      layouts: layoutsFor(this.tiles.length),
      maxTiles: this.maxTiles,
      focused: this.focusedSlot,
      fullscreen: this.fullscreenSlot,
    };
  }

  private emit(): void {
    this.current = this.compose();
    for (const listener of [...this.listeners]) listener();
  }
}

function sameEvent(a: LiveEventRef | null, b: LiveEventRef | null): boolean {
  return a === b || (!!a && !!b && a.id === b.id && a.feed === b.feed);
}
