// Audio playback (docs/media-kinds.md): a queue of tracks, an audiobook or its parts, played by
// a platform audio engine. Each item is an ordinary playback session (`Playback`: the plan,
// session following, recovery, the stop that saves the resume point); this adds the queue,
// the engine's progress reports, speed and the sleep timer. One session plays at a time: a video
// started elsewhere takes the session and the audio pauses.
import type * as V from '../wire';
import type { Card } from '../models';
import { createQueue, current, cycleRepeat, jumpTo, next, previous, toggleShuffle, type AudioQueue, type Random } from '../audio/queue';
import type { Playback } from './playback';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

export type AudioEngineEvent = 'time' | 'playing' | 'paused' | 'waiting' | 'ended' | 'error' | 'duration';

/** The platform's audio element: web's HTMLAudioElement, a native player on devices. */
export interface AudioEngine {
  load(url: string, startSeconds: number, rate: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  unload(): void;
  position(): number;
  duration(): number;
  buffered(): V.TimeRange[];
  /** Why the last error happened, for the viewer. */
  error(): string;
  subscribe(listener: (event: AudioEngineEvent) => void): () => void;
}

export type AudioPhase = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'failed';
export type SleepMode = 'off' | 'timer' | 'chapter' | 'item';

export interface AudioState {
  queue: AudioQueue | null;
  phase: AudioPhase;
  positionSeconds: number;
  durationSeconds: number;
  rate: number;
  /** The sleep timer: until a time (ms since the epoch), the end of the chapter or of the item. */
  sleep: { mode: SleepMode; endsAt: number };
  chapters: V.Chapter[];
  error: string;
  /** No engine on this platform yet (native audio is device work). */
  unsupported: boolean;
}

export const initialAudio: AudioState = {
  queue: null, phase: 'idle', positionSeconds: 0, durationSeconds: 0, rate: 1,
  sleep: { mode: 'off', endsAt: 0 }, chapters: [], error: '', unsupported: false,
};

export interface AudioRequest {
  items: Card[];
  index: number;
  positionSeconds?: number;
  shuffle?: boolean;
  source?: { id: string; name: string };
}

export const AUDIO_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const OBSERVE_EVERY_MS = 10_000;

export class Audio {
  private engine: AudioEngine | null = null;
  private detach: (() => void) | undefined;
  /** The session the engine plays, and the plan URL it was loaded from. */
  private sessionId = '';
  private url = '';
  private loadToken: object | undefined;
  private sequence = 0;
  private lastObservation = 0;
  private lastPatch = 0;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly playback: Playback,
    private readonly random: Random = Math.random,
  ) {
    session.onReset(() => { this.halt(); this.box.update('audio', () => initialAudio); });
    // A session that is no longer ours (a video started, the server replaced it) stops the engine;
    // a recovered plan for our session reloads at the same place.
    box.subscribe(() => this.follow());
  }

  /** The platform engine; none (native, for now) marks audio unsupported. */
  attach(engine: AudioEngine | null): () => void {
    this.detach?.();
    this.engine = engine;
    this.patch({ unsupported: !engine });
    if (!engine) return () => undefined;
    const off = engine.subscribe(event => this.onEngine(event));
    this.detach = () => { off(); engine.unload(); if (this.engine === engine) this.engine = null; };
    return () => this.detach?.();
  }

  get state(): AudioState { return this.box.get().audio; }

  play(request: AudioRequest): void {
    const items = request.items.filter(Boolean);
    if (!items.length) return;
    const queue = createQueue(items, request.index, { shuffle: request.shuffle, repeat: this.state.queue?.repeat, source: request.source }, this.random);
    this.patch({ queue, error: '', chapters: [] });
    void this.load(request.shuffle ? 0 : request.positionSeconds ?? 0);
  }

  toggle(): void {
    if (this.state.phase === 'playing' || this.state.phase === 'buffering' || this.state.phase === 'loading') this.pause();
    else this.resume();
  }

  pause(): void {
    this.engine?.pause();
    if (this.state.phase === 'loading') this.loadToken = undefined;
    this.patch({ phase: 'paused' });
    this.observe('paused');
  }

  resume(): void {
    if (!current(this.state.queue)) return;
    // The session was taken (a video played) or ended: ask for a new one at the same place.
    if (!this.ours() || this.state.phase === 'ended' || this.state.phase === 'failed') { void this.load(this.state.phase === 'ended' ? 0 : this.state.positionSeconds); return; }
    this.engine?.play();
  }

  next(): void {
    const queue = this.state.queue && next(this.state.queue);
    if (!queue) return;
    this.patch({ queue, chapters: [] });
    void this.load(0);
  }

  previous(): void {
    if (!this.state.queue) return;
    const { queue, restart } = previous(this.state.queue, this.state.positionSeconds);
    if (restart) { this.seek(0); return; }
    this.patch({ queue, chapters: [] });
    void this.load(0);
  }

  /** Play the queue's item at `itemIndex` (an index into queue.items). */
  jump(itemIndex: number): void {
    if (!this.state.queue) return;
    this.patch({ queue: jumpTo(this.state.queue, itemIndex), chapters: [] });
    void this.load(0);
  }

  seek(seconds: number): void {
    const duration = this.state.durationSeconds;
    const to = Math.max(0, duration > 0 ? Math.min(duration - 0.25, seconds) : seconds);
    this.engine?.seek(to);
    this.patch({ positionSeconds: to });
    this.observe(this.state.phase === 'paused' ? 'paused' : 'playing');
  }

  skip(delta: number): void { this.seek(this.state.positionSeconds + delta); }

  setRate(rate: number): void {
    const value = Math.min(3, Math.max(0.5, rate));
    this.engine?.setRate(value);
    this.patch({ rate: value });
  }

  /** Sleep after `minutes`, at the end of the chapter or item, or never ('off'). */
  setSleep(mode: SleepMode, minutes = 0): void {
    // A chapter sleep remembers where it was set, so it ends with that chapter rather than the next.
    const endsAt = mode === 'timer' ? Date.now() + minutes * 60_000 : mode === 'chapter' ? this.state.positionSeconds : 0;
    this.patch({ sleep: { mode, endsAt } });
  }

  toggleShuffle(): void { if (this.state.queue) this.patch({ queue: toggleShuffle(this.state.queue, this.random) }); }
  cycleRepeat(): void { if (this.state.queue) this.patch({ queue: cycleRepeat(this.state.queue) }); }

  /** Stop and clear the queue; the server keeps the resume point. */
  async stop(): Promise<void> {
    this.observe('paused');
    this.halt();
    this.box.update('audio', audio => ({ ...initialAudio, rate: audio.rate, unsupported: audio.unsupported }));
    if (this.ownsPlayback()) await this.playback.stop();
  }

  /** Start the current item's session and load the engine when its plan arrives. */
  private async load(startSeconds: number): Promise<void> {
    const item = current(this.state.queue);
    if (!item) return;
    const token = {};
    this.loadToken = token;
    this.engine?.unload();
    this.sessionId = ''; this.url = '';
    this.patch({ phase: this.engine ? 'loading' : 'failed', positionSeconds: startSeconds, durationSeconds: item.durationSeconds, error: '' });
    if (!this.engine) return;
    await this.playback.start({ kind: 'title', id: item.id, ...(startSeconds > 0 ? { positionSeconds: startSeconds } : {}) });
    if (this.loadToken !== token) return;
    const playback = this.box.get().playback;
    if (playback.phase === 'failed' || !playback.plan) {
      this.patch({ phase: 'failed', error: playback.error || 'This item could not be played' });
      return;
    }
    this.begin(playback.plan, startSeconds);
  }

  private begin(plan: V.PlaybackPlan, startSeconds: number): void {
    const path = plan.paths.find(p => p.id === plan.selectedPathId) ?? plan.paths[0];
    if (!this.engine || !path || !('url' in path) || !path.url) {
      this.patch({ phase: 'failed', error: 'This item has no playable audio' });
      return;
    }
    this.sessionId = plan.sessionId;
    this.url = path.url;
    this.sequence = 0;
    this.lastObservation = 0;
    const start = plan.positionSeconds > 0 ? plan.positionSeconds : startSeconds;
    this.patch({ chapters: plan.chapters ?? [], durationSeconds: plan.durationSeconds ?? this.state.durationSeconds, positionSeconds: start });
    this.engine.load(path.url, start, this.state.rate);
    this.engine.play();
  }

  private follow(): void {
    if (!this.sessionId) return;
    const playback = this.box.get().playback;
    if (playback.sessionId === this.sessionId && playback.plan) {
      const path = playback.plan.paths.find(p => p.id === playback.plan!.selectedPathId);
      // Recovery replaces the session's plan with fresh URLs: reload where the engine was.
      if (path && 'url' in path && path.url && path.url !== this.url && this.state.phase !== 'paused') {
        this.url = path.url;
        const at = this.engine?.position() ?? this.state.positionSeconds;
        this.engine?.load(path.url, at, this.state.rate);
        this.engine?.play();
      }
      return;
    }
    if (playback.phase === 'preparing' && playback.target?.kind === 'title' && playback.target.id === current(this.state.queue)?.id) return;
    // Another session took over.
    if (playback.sessionId !== this.sessionId && playback.phase !== 'preparing') {
      this.engine?.pause();
      this.engine?.unload();
      this.sessionId = ''; this.url = '';
      if (this.state.phase !== 'idle' && this.state.phase !== 'ended') this.patch({ phase: 'paused' });
    }
  }

  private onEngine(event: AudioEngineEvent): void {
    const engine = this.engine;
    if (!engine || !this.sessionId) return;
    const position = engine.position();
    switch (event) {
      case 'playing': this.patch({ phase: 'playing', positionSeconds: position }); this.observe('playing'); break;
      case 'paused': if (this.state.phase !== 'ended') { this.patch({ phase: 'paused', positionSeconds: position }); this.observe('paused'); } break;
      case 'waiting': this.patch({ phase: 'buffering' }); break;
      case 'duration': if (engine.duration() > 0) this.patch({ durationSeconds: engine.duration() }); break;
      case 'error': this.patch({ phase: 'failed', error: engine.error() || 'Playback failed' }); break;
      case 'ended': this.ended(); break;
      case 'time': this.progress(position); break;
    }
  }

  private progress(position: number): void {
    const now = Date.now();
    this.playback.snapshot({ sessionId: this.sessionId, live: null, position, state: this.state.phase === 'paused' ? 'paused' : 'playing' });
    if (now - this.lastPatch >= 250) { this.lastPatch = now; this.patch({ positionSeconds: position }); }
    if (now - this.lastObservation >= OBSERVE_EVERY_MS) this.observe('playing');
    const sleep = this.state.sleep;
    if (sleep.mode === 'timer' && now >= sleep.endsAt) this.sleepNow();
    if (sleep.mode === 'chapter') {
      const end = chapterEnd(this.state.chapters, sleep.endsAt);
      if (end !== undefined && position >= end - 0.3) this.sleepNow();
    }
  }

  private sleepNow(): void {
    this.patch({ sleep: { mode: 'off', endsAt: 0 } });
    this.pause();
  }

  private ended(): void {
    this.observe('ended');
    if (this.state.sleep.mode === 'item' || this.state.sleep.mode === 'chapter') {
      this.patch({ sleep: { mode: 'off', endsAt: 0 }, phase: 'paused' });
      const after = this.state.queue && next(this.state.queue, true);
      if (after) this.patch({ queue: after, positionSeconds: 0 });
      return;
    }
    const after = this.state.queue && next(this.state.queue, true);
    if (!after) {
      this.patch({ phase: 'ended', positionSeconds: 0 });
      void this.playback.stop();
      this.sessionId = '';
      return;
    }
    this.patch({ queue: after, chapters: [] });
    void this.load(0);
  }

  private observe(state: V.PlayerObservation['state']): void {
    const plan = this.box.get().playback.plan;
    if (!this.sessionId || !plan || plan.sessionId !== this.sessionId) return;
    this.lastObservation = Date.now();
    const sequence = ++this.sequence;
    const position = this.engine?.position() ?? this.state.positionSeconds;
    void this.playback.observe(this.sessionId, {
      idempotencyKey: `audio-${this.sessionId}-${sequence}`,
      sequence, observedAt: new Date().toISOString(), positionSeconds: position, state,
      playableRanges: this.engine?.buffered() ?? [], selectedPathId: plan.selectedPathId,
      sourceGeneration: plan.sourceGeneration, seekGeneration: plan.seekGeneration,
    }).catch(() => undefined);
  }

  private ours(): boolean { return !!this.sessionId && this.box.get().playback.sessionId === this.sessionId; }

  private ownsPlayback(): boolean {
    const target = this.box.get().playback.target;
    return this.ours() || (target?.kind === 'title' && !!this.state.queue?.items.some(item => item.id === target.id));
  }

  private halt(): void {
    this.loadToken = undefined;
    this.engine?.unload();
    this.sessionId = ''; this.url = '';
  }

  private patch(change: Partial<AudioState>): void {
    this.box.update('audio', audio => ({ ...audio, ...change }));
  }
}

/** Where the chapter playing at `position` ends: its end, else the next chapter's start. */
export function chapterEnd(chapters: V.Chapter[], position: number): number | undefined {
  const sorted = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
  const index = sorted.findLastIndex(c => c.startSeconds <= position);
  if (index < 0) return sorted[0]?.startSeconds;
  return sorted[index]!.endSeconds ?? sorted[index + 1]?.startSeconds;
}
