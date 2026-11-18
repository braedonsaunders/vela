// The preview tile: one muted ambient channel session shared by the guide's header and a live
// home's monitor. It tunes to the viewer's remembered channel or the first that plays in server
// order, moves on when one cannot play (three tries, or none for a channel the viewer chose), and
// holds at most one session. Every session it was granted is stopped at the server, and full
// watch opens only after the server confirmed that stop, so the viewer never holds two streams.
import type { Command, Snapshot } from '@vela/player-api';
import type { PlaybackPlan } from '../../../../protocol/types';
import type { LiveSource } from './source';

export type TileState = 'off' | 'tune-in' | 'connecting' | 'playing' | 'unavailable' | 'stuck';

export interface TileView {
  state: TileState;
  channelId: string;
  muted: boolean;
  fullscreen: boolean;
  /** The session to draw, while connecting or playing. */
  plan: PlaybackPlan | null;
  /** The latest mute command for the player view. */
  command: Command | null;
}

/** What the tile is allowed to want right now, decided by the controller. */
export interface TileInputs {
  /** A surface that shows the tile is visible and its listings are loaded. */
  open: boolean;
  /** Channel ids in the server's order. */
  order: string[];
  remembered: string;
  /** Reduced motion or Save-Data: wait for the viewer to tune in. */
  quiet: boolean;
  /** The app can draw a picture (a player view exists). */
  canPreview: boolean;
}

/** Waits before re-sending a stop the server did not confirm; after these the tile says so. */
const STOP_RETRIES = [1000, 3000, 8000];
const AUTOMATIC_TRIES = 3;

interface Stopping {
  plan: PlaybackPlan;
  tries: number;
  failed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class Tile {
  private inputs: TileInputs = { open: false, order: [], remembered: '', quiet: false, canPreview: false };
  private chosen = '';
  private attempt = 0;
  private manual = false;
  private givenUp = false;
  private generation = 0;
  private requesting = -1;
  private held: PlaybackPlan | null = null;
  private playing = false;
  private muted = true;
  private commandId = 0;
  private command: Command | null = null;
  private fullscreen = false;
  private readonly stopping = new Map<string, Stopping>();

  constructor(
    private readonly source: LiveSource,
    private readonly changed: () => void,
    private readonly openWatch: (channelId: string) => void,
  ) {}

  /** The channel on the tile: the viewer's choice, else the current automatic candidate. */
  get target(): string {
    if (this.chosen) return this.chosen;
    const { order, remembered } = this.inputs;
    const candidates =
      remembered && order.includes(remembered) ? [remembered, ...order.filter(id => id !== remembered)] : order;
    return candidates[this.attempt] ?? '';
  }

  private get allowed(): boolean {
    return this.manual || !this.inputs.quiet;
  }

  private get wanted(): boolean {
    const { open, canPreview } = this.inputs;
    return open && canPreview && this.allowed && this.target !== '' && !this.givenUp;
  }

  view(): TileView {
    return {
      state: this.state(),
      channelId: this.target,
      muted: this.muted,
      fullscreen: this.fullscreen,
      plan: this.wanted ? this.held : null,
      command: this.command,
    };
  }

  private state(): TileState {
    if ([...this.stopping.values()].some(s => s.failed)) return 'stuck';
    if (this.target === '' || !this.inputs.canPreview) return 'off';
    if (!this.allowed) return 'tune-in';
    if (this.givenUp) return 'unavailable';
    return this.held && this.playing ? 'playing' : 'connecting';
  }

  /** Re-decide after the controller's inputs changed: tune when wanted, release when not. */
  update(inputs: TileInputs): void {
    this.inputs = { ...inputs, open: inputs.open || this.fullscreen };
    if (!inputs.open && !this.fullscreen && (this.givenUp || this.attempt > 0 || this.chosen || this.manual)) this.forget();
    this.settle();
  }

  private settle(): void {
    if (this.wanted && !this.held && this.requesting !== this.generation) this.request();
    if (!this.wanted && this.held) this.release();
  }

  private request(): void {
    const generation = this.generation;
    const channelId = this.target;
    this.requesting = generation;
    this.source.tune(channelId).then(
      plan => {
        if (generation !== this.generation || !this.wanted || channelId !== this.target) {
          this.stop(plan);
          return;
        }
        this.held = plan;
        this.playing = false;
        this.changed();
      },
      () => {
        if (generation === this.generation) this.fail();
      },
    );
  }

  /** The preview could not play this channel: an automatic tile tries the next in order. */
  fail(): void {
    this.drop();
    if (!this.chosen && this.attempt < AUTOMATIC_TRIES - 1) this.attempt += 1;
    else this.givenUp = true;
    this.settle();
    this.changed();
  }

  /** The player view's report for the held session. */
  snapshot(snapshot: Snapshot): void {
    if (!this.held || snapshot.sessionId !== this.held.sessionId) return;
    if (snapshot.state === 'failed') {
      this.fail();
      return;
    }
    const playing = snapshot.state === 'playing' && !snapshot.waiting;
    if (playing === this.playing) return;
    this.playing = playing;
    this.changed();
  }

  /** Put a channel on the tile (the guide's selection, a live home's favourites, flicking). */
  retune(channelId: string): void {
    if (channelId === this.target && !this.givenUp) {
      // Focusing the automatic candidate is still an explicit choice. A later playback
      // failure must not silently switch the preview to another channel.
      this.chosen = channelId;
      return;
    }
    this.drop();
    this.chosen = channelId;
    this.attempt = 0;
    this.givenUp = false;
    this.settle();
    this.changed();
  }

  tuneIn(): void {
    this.manual = true;
    this.settle();
    this.changed();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    this.commandId += 1;
    this.command = { id: this.commandId, type: 'mute', muted: this.muted };
    this.changed();
  }

  /** The same owned session is displayed full screen, without stopping or starting it again. */
  watch(channelId: string): void {
    this.enterWatch(channelId);
    this.openWatch(channelId);
  }

  enterWatch(channelId: string): void {
    this.fullscreen = true;
    this.inputs = { ...this.inputs, open: true };
    this.retune(channelId);
    this.settle();
    this.changed();
  }

  leaveWatch(): void {
    this.fullscreen = false;
    this.changed();
  }

  updatePlan(plan: PlaybackPlan): void {
    if (this.held?.sessionId === plan.sessionId) this.held = plan;
  }

  /** The tile says its stop did not take; the viewer asks again. */
  retryStop(): void {
    for (const entry of this.stopping.values()) {
      if (!entry.failed) continue;
      entry.failed = false;
      this.send(entry);
    }
    this.changed();
  }

  /** Leaving: stop everything, forget the run. A pending stop still completes in the background. */
  dispose(): void {
    this.inputs = { ...this.inputs, open: false };
    this.fullscreen = false;
    this.drop();
  }

  private forget(): void {
    this.givenUp = false;
    this.attempt = 0;
    this.chosen = '';
    this.manual = false;
  }

  private release(): void {
    this.drop();
    this.muted = true;
    this.command = null;
  }

  /** Stop the held session, if any, and stop waiting for the one being requested. */
  private drop(): void {
    if (this.held) this.stop(this.held);
    this.held = null;
    this.playing = false;
    this.generation += 1;
  }

  private stop(plan: PlaybackPlan): void {
    if (this.stopping.has(plan.sessionId)) return;
    const entry: Stopping = { plan, tries: 0, failed: false };
    this.stopping.set(plan.sessionId, entry);
    this.send(entry);
  }

  private send(entry: Stopping): void {
    this.source.stop(entry.plan).then(
      () => this.stopped(entry),
      () => this.stopFailed(entry),
    );
  }

  private stopped(entry: Stopping): void {
    clearTimeout(entry.timer);
    this.stopping.delete(entry.plan.sessionId);
    this.settle();
    this.changed();
  }

  private stopFailed(entry: Stopping): void {
    entry.failed = true;
    const wait = STOP_RETRIES[entry.tries];
    if (wait !== undefined) {
      entry.tries += 1;
      entry.timer = setTimeout(() => {
        entry.failed = false;
        this.send(entry);
        this.changed();
      }, wait);
    }
    this.changed();
  }
}
