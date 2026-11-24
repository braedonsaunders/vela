// Audio playback (docs/media-kinds.md): a queue of tracks, an audiobook or its parts, played by
// a platform audio engine. Each item is an ordinary playback session (`Playback`: the plan,
// session following, recovery, the stop that saves the resume point); this adds the queue,
// the engine's progress reports, speed and the sleep timer. One session plays at a time: a video
// started elsewhere takes the session and the audio pauses.
import type * as V from '../wire';
import type { Card } from '../models';
import { clearQueued, createQueue, current, cycleRepeat, enqueue, jumpTo, moveTo, next, previous, removeAt, toggleShuffle, type AudioQueue, type Random } from '../audio/queue';
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
  /** 0..1; engines without one leave volume to the device. */
  setVolume?(volume: number): void;
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
  /** The app's own volume, 0..1, and mute (the device's volume still applies). */
  volume: number;
  muted: boolean;
}

export const initialAudio: AudioState = {
  queue: null, phase: 'idle', positionSeconds: 0, durationSeconds: 0, rate: 1,
  sleep: { mode: 'off', endsAt: 0 }, chapters: [], error: '', unsupported: false, volume: 1, muted: false,
};

export interface AudioRequest {
  items: Card[];
  index: number;
  positionSeconds?: number;
  shuffle?: boolean;
  source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' };
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
  /** Whether the item being loaded starts playing once its plan arrives (a pause while loading clears it). */
  private autoplay = true;
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
    this.autoplay = false;
    this.patch({ phase: 'paused' });
    this.observe('paused');
    this.held('paused');
  }

  resume(): void {
    if (!current(this.state.queue)) return;
    // Still waiting for the plan: play once it arrives.
    if (this.loadToken && !this.sessionId) { this.autoplay = true; this.patch({ phase: 'loading' }); return; }
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

  /** Play next / Add to queue; with nothing playing they start a queue of their own. */
  playNext(cards: Card[]): void { this.enqueue(cards, 'next'); }
  addToQueue(cards: Card[]): void { this.enqueue(cards, 'last'); }
  private enqueue(cards: Card[], where: 'next' | 'last'): void {
    const items = cards.filter(Boolean);
    if (!items.length) return;
    if (!this.state.queue) { this.play({ items, index: 0 }); return; }
    this.patch({ queue: enqueue(this.state.queue, items, where) });
  }
  /** Remove the upcoming item at play position `position`. */
  remove(position: number): void { if (this.state.queue) this.patch({ queue: removeAt(this.state.queue, position) }); }
  /** Move an upcoming item between play positions. */
  move(from: number, to: number): void { if (this.state.queue) this.patch({ queue: moveTo(this.state.queue, from, to) }); }
  clearQueued(): void { if (this.state.queue) this.patch({ queue: clearQueued(this.state.queue) }); }

  setVolume(volume: number): void {
    const value = Math.min(1, Math.max(0, volume));
    this.engine?.setVolume?.(value);
    this.patch({ volume: value, muted: value === 0 ? this.state.muted : false });
  }
  toggleMute(): void {
    const muted = !this.state.muted;
    this.engine?.setVolume?.(muted ? 0 : this.state.volume);
    this.patch({ muted });
  }

  toggleShuffle(): void { if (this.state.queue) this.patch({ queue: toggleShuffle(this.state.queue, this.random) }); }
  cycleRepeat(): void { if (this.state.queue) this.patch({ queue: cycleRepeat(this.state.queue) }); }

  /** Stop and clear the queue; the server keeps the resume point. */
  async stop(): Promise<void> {
    this.observe('paused');
    // Asked before the queue and session are cleared: they are how the playback is known as ours.
    const owns = this.ownsPlayback();
    this.halt();
    this.box.update('audio', audio => ({ ...initialAudio, rate: audio.rate, unsupported: audio.unsupported, volume: audio.volume, muted: audio.muted }));
    if (owns) await this.playback.stop();
  }

  /** Start the current item's session and load the engine when its plan arrives. */
  private async load(startSeconds: number): Promise<void> {
    const item = current(this.state.queue);
    if (!item) return;
    const token = {};
    this.loadToken = token;
    this.autoplay = true;
    this.engine?.unload();
    this.sessionId = ''; this.url = '';
    this.patch({ phase: this.engine ? 'loading' : 'failed', positionSeconds: startSeconds, durationSeconds: item.durationSeconds, error: '' });
    if (!this.engine) return;
    const source = this.state.queue?.source;
    const context = source?.kind ? { kind: source.kind, id: source.id } : undefined;
    await this.playback.start({ kind: 'title', id: item.id, ...(startSeconds > 0 ? { positionSeconds: startSeconds } : {}), ...(context ? { context } : {}) });
    if (this.loadToken !== token) return;
    this.loadToken = undefined;
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
    this.loadEngine(path.url, start, () => {
      if (this.autoplay) this.engine?.play();
      else this.held('paused');
    });
  }

  /**
   * Load the plan's URL into the engine. A Jellyfin, Emby or Plex plan's URL carries no credential
   * and an audio element sends no headers, so it plays the server's credentialed form of the URL
   * (`Playback.mediaAccess`), minted per load and never kept; Ether's own URLs are unchanged.
   * Nothing loads if another item or URL took over meanwhile.
   */
  private loadEngine(url: string, start: number, then: () => void): void {
    const sessionId = this.sessionId;
    void (async () => {
      let resolved = url;
      try {
        const access = await this.playback.mediaAccess();
        if (access?.nativeURL) resolved = await access.nativeURL(url);
      } catch { /* The URL as planned: a server that needs no credential still plays it. */ }
      if (!this.engine || this.sessionId !== sessionId || this.url !== url) return;
      this.engine.load(resolved, start, this.state.rate);
      this.engine.setVolume?.(this.state.muted ? 0 : this.state.volume);
      then();
    })();
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
        this.loadEngine(path.url, at, () => this.engine?.play());
      }
      return;
    }
    const item = current(this.state.queue);
    const mine = playback.target?.kind === 'title' && playback.target.id === item?.id;
    if (playback.phase === 'preparing' && mine) return;
    // Playback recovered this item on a new session (a lost event stream, a stall): carry on there,
    // paused if the viewer had paused, so the new session is not taken for a stalled one.
    const recovered = mine && playback.phase === 'playing' && playback.plan ? playback.plan.paths.find(p => p.id === playback.plan!.selectedPathId) : undefined;
    if (recovered && 'url' in recovered && recovered.url) {
      const at = this.engine?.position() || playback.plan?.positionSeconds || this.state.positionSeconds;
      this.sessionId = playback.sessionId;
      this.url = recovered.url;
      this.sequence = 0;
      // After playback has finished taking the new plan (it arms its watchdog as it does).
      const paused = this.state.phase === 'paused';
      this.loadEngine(recovered.url, at, () => {
        if (paused) queueMicrotask(() => this.held('paused'));
        else this.engine?.play();
      });
      return;
    }
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
      case 'paused': if (this.state.phase !== 'ended') { this.patch({ phase: 'paused', positionSeconds: position }); this.observe('paused'); this.held('paused'); } break;
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
    this.held('ended');
    if (this.state.sleep.mode === 'item' || this.state.sleep.mode === 'chapter') {
      // Asleep on the next item: its session starts when the viewer resumes.
      this.patch({ sleep: { mode: 'off', endsAt: 0 }, phase: 'paused' });
      const after = this.state.queue && next(this.state.queue, true);
      if (after) this.patch({ queue: after, positionSeconds: 0, chapters: [] });
      this.halt();
      void this.playback.stop();
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

  /**
   * Tell playback the engine stopped on purpose. Without it the session's stall watchdog reads a
   * paused or finished item as a stalled one and replaces the session every few seconds.
   */
  private held(state: 'paused' | 'ended'): void {
    if (!this.sessionId) return;
    this.playback.snapshot({ sessionId: this.sessionId, live: null, position: this.engine?.position() ?? this.state.positionSeconds, state });
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
