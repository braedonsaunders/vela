// The preview tile: one muted ambient channel session shared by the guide's header and a live
// home's monitor. It tunes to the viewer's remembered channel or the first that plays in server
// order, keeps that channel selected if it cannot play, and
// owns the current session. Full watch shares that session without a server retune.
import type { Command, Snapshot } from '@vela/player-api';
import { startRefusal, startRetry, VelaError, type StartRefusal } from '@vela/core';
import type { LivePreviewMode, PlaybackPlan } from '../../../../protocol/types';
import type { LiveSource } from './source';
import { previewFailure } from './diagnostics';

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
  /** Why the channel could not play (the server's refusal or the engine's failure), once given up. */
  failure: StartRefusal | null;
  /** The server allowed asking again: when the tile does, and why the last attempt was refused. */
  retrying: { seconds: number; message: string } | null;
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

/**
 * Ether supersedes a client's live session when the same device tunes again, and a quick zap can
 * overlap two tunes: the one it cancels may be the channel the viewer landed on. That refusal
 * says nothing about the channel, so it is asked once more before anything is shown.
 */
function cancelledTune(error: unknown): boolean {
  return error instanceof VelaError && error.detail.code === 'cancelled';
}

/** Waits before re-sending a stop the server did not confirm; after these the tile says so. */
const STOP_RETRIES = [1000, 3000, 8000];

interface Stopping {
  plan: PlaybackPlan;
  tries: number;
  failed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

export class Tile {
  private inputs: TileInputs = { open: false, order: [], remembered: '', quiet: false, canPreview: false };
  private chosen = '';
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
  private mode: LivePreviewMode = 'auto';
  private readonly stopping = new Map<string, Stopping>();
  private failure: StartRefusal | null = null;
  private retries = 0;
  private retryingIn = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private askedAgain = false;

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
    return candidates[0] ?? '';
  }

  private get allowed(): boolean {
    if (this.fullscreen) return true;
    if (this.mode === 'off') return false;
    return this.mode === 'auto' ? !this.inputs.quiet || this.manual : this.manual;
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
      failure: this.givenUp ? this.failure ?? { message: '', code: '', errorClass: '' } : null,
      retrying: this.retryingIn > 0 ? { seconds: this.retryingIn, message: this.failure?.message ?? '' } : null,
    };
  }

  private state(): TileState {
    if (!this.held && [...this.stopping.values()].some(s => s.failed && s.tries >= STOP_RETRIES.length)) return 'stuck';
    if (this.target === '' || !this.inputs.canPreview || (!this.inputs.open && !this.fullscreen) || (this.mode === 'off' && !this.fullscreen)) return 'off';
    if (!this.allowed) return 'tune-in';
    if (this.givenUp) return 'unavailable';
    return this.held && this.playing ? 'playing' : 'connecting';
  }

  setMode(mode: LivePreviewMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (mode !== 'auto') this.manual = false;
    this.settle();
    this.changed();
  }

  /** Re-decide after the controller's inputs changed: tune when wanted, release when not. */
  update(inputs: TileInputs): void {
    this.inputs = { ...inputs, open: inputs.open || this.fullscreen };
    if (!inputs.open && !this.fullscreen && (this.givenUp || this.chosen || this.manual)) this.forget();
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
        this.retries = 0;
        this.retryingIn = 0;
        this.askedAgain = false;
        this.failure = null;
        this.changed();
      },
      error => {
        previewFailure('tune', error);
        if (generation !== this.generation) return;
        if (cancelledTune(error) && !this.askedAgain && this.wanted && channelId === this.target) {
          this.askedAgain = true;
          this.request();
          return;
        }
        // A refusal the server allows retrying is asked again on its terms; anything else is final.
        const seconds = startRetry(error, this.retries);
        if (seconds <= 0) { this.fail(error); return; }
        this.retries += 1;
        this.retryingIn = seconds;
        this.failure = startRefusal(error);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = undefined;
          this.retryingIn = 0;
          if (generation !== this.generation) return;
          if (this.wanted && channelId === this.target) this.request();
          else this.requesting = -1;
          this.changed();
        }, seconds * 1000);
        this.changed();
      },
    );
  }

  /** A failed channel stays selected until the viewer retries or explicitly changes it. */
  fail(reason?: unknown): void {
    this.drop();
    this.givenUp = true;
    this.failure = reason === undefined ? null : startRefusal(reason);
    this.settle();
    this.changed();
  }

  /** Try the channel again from the start (the viewer's Try again), whatever state it is in. */
  restart(channelId: string): void {
    this.drop();
    this.manual = true;
    this.chosen = channelId;
    this.givenUp = false;
    this.failure = null;
    this.settle();
    this.changed();
  }

  /** The player view's report for the held session. */
  snapshot(snapshot: Snapshot): void {
    if (!this.held || snapshot.sessionId !== this.held.sessionId) return;
    if (snapshot.state === 'failed') {
      this.fail(snapshot.failure ? new Error(snapshot.failure.message) : undefined);
      return;
    }
    const playing = snapshot.state === 'playing' && !snapshot.waiting && snapshot.totalFrames !== 0;
    if (playing === this.playing) return;
    this.playing = playing;
    this.changed();
  }

  /** An explicit tune from Select, favourites or channel controls. */
  retune(channelId: string): void {
    this.manual = true;
    if (channelId === this.target && !this.givenUp) {
      // Focusing the automatic candidate is still an explicit choice. A later playback
      // failure must not silently switch the preview to another channel.
      this.chosen = channelId;
      return;
    }
    this.drop();
    this.chosen = channelId;
    this.givenUp = false;
    this.failure = null;
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
    if (this.held?.sessionId === plan.sessionId || (this.fullscreen && plan.channelId === this.target)) {
      this.held = plan;
      this.givenUp = false;
      this.failure = null;
      this.changed();
    }
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
    this.failure = null;
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
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.retries = 0;
    this.retryingIn = 0;
    this.askedAgain = false;
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
      error => { previewFailure('stop', error); this.stopFailed(entry); },
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
