// Audio playback (docs/media-kinds.md): a queue of tracks, an audiobook or its parts, played by
// a platform audio engine. Each item is an ordinary playback session (`Playback`: the plan,
// session following, recovery, the stop that saves the resume point); this adds the queue,
// the engine's progress reports, speed and the sleep timer. One session plays at a time: a video
// started elsewhere takes the session and the audio pauses.
import type * as V from '../wire';
import type { Card } from '../models';
import { appendAutoplay, clearQueued, createQueue, current, cycleRepeat, enqueue, jumpTo, moveTo, next, previous, removeAt, toggleShuffle, type AudioQueue, type Random } from '../audio/queue';
import { albumInOrder, DEFAULT_SOUND, levellingGain, loudnessOf, soundSettings, transitionBetween, type SoundSettings } from '../audio/sound';
import { eqChain, type EqChain } from '../audio/eq';
import type { Playback, PlaybackTarget } from './playback';
import type { Session } from './session';
import type { StateBox } from './state';
import type { VelaState } from './index';

export type AudioEngineEvent = 'time' | 'playing' | 'paused' | 'waiting' | 'ended' | 'error' | 'duration' | 'advanced';

/** The item an engine readies to play straight after the current one (gapless playback). `gain` is its
 * levelling (linear); `crossfade` (AutoMix) starts it `seconds` before the current one's audible end,
 * at `at` seconds into the current item, from `startSeconds`, fading equal-power across. Without it
 * the join is gapless. */
export interface AudioPreload { url: string; startSeconds: number; gain?: number; crossfade?: { seconds: number; at: number } }

/** What the engine applies to the playing item: its levelling gain (linear) and the EQ (all items). */
export interface AudioSound { gain: number; eq: EqChain | null }

/** The platform's audio element: web's HTMLAudioElement, a native player on devices. */
export interface AudioEngine {
  load(url: string, startSeconds: number, rate: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  /** 0..1; engines without one leave volume to the device. */
  setVolume?(volume: number): void;
  /** Levelling and the EQ (docs/sound.md); engines without it play at unity with no EQ. */
  setSound?(sound: AudioSound): void;
  unload(): void;
  position(): number;
  duration(): number;
  buffered(): V.TimeRange[];
  /** Why the last error happened, for the viewer. */
  error(): string;
  subscribe(listener: (event: AudioEngineEvent) => void): () => void;
  /**
   * Gapless playback: ready `next` to play the moment the current item ends, or forget it (null).
   * At the end the engine plays it with no gap and emits 'advanced' instead of 'ended'; from then
   * on position, duration and events are the new item's. `load` and `unload` forget it too. An
   * engine without it ends each item and the store loads the next.
   */
  preload?(next: AudioPreload | null): void;
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
  /** AutoMix, loudness levelling and the equalizer (audio/sound.ts); this device's own. */
  sound: SoundSettings;
}

export const initialAudio: AudioState = {
  queue: null, phase: 'idle', positionSeconds: 0, durationSeconds: 0, rate: 1,
  sleep: { mode: 'off', endsAt: 0 }, chapters: [], error: '', unsupported: false, volume: 1, muted: false, sound: DEFAULT_SOUND,
};

export interface AudioRequest {
  items: Card[];
  index: number;
  positionSeconds?: number;
  shuffle?: boolean;
  source?: { id: string; name: string; kind?: 'title' | 'playlist' | 'favorites' };
}

/** Autoplay asks for what follows this long before the last item ends, seconds. */
const AUTOPLAY_LEAD = 60;

export const AUDIO_RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const OBSERVE_EVERY_MS = 10_000;

/**
 * How long before an item ends the next one's plan is asked for and handed to the engine: twenty
 * seconds, half of a short item (but at least four seconds); six for spoken word, whose resume point
 * the server keeps (see `lookAhead`).
 */
export function preloadLead(durationSeconds: number, spoken = false): number {
  return Math.min(spoken ? 6 : 20, Math.max(4, durationSeconds / 2));
}
/** With this little left the next plan is asked for even if the engine has not buffered to the end. */
const PRELOAD_LAST_CALL = 5;
/** A prepared item is given back when the viewer seeks this much further from the end than the lead. */
const PRELOAD_RELEASE_MARGIN = 30;

/** The next item, made ready before the current one ends. */
interface Prepared {
  /** The title it plays. */
  id: string;
  /** Its plan once the server answered, and the plan's URL. */
  plan?: V.PlaybackPlan;
  url?: string;
  start: number;
  /** The engine holds it (`preload`). */
  handed: boolean;
  /** Its loudness (the plan's, else the card's), and what was handed: its gain and the crossfade. */
  loudness?: V.Loudness;
  handover?: AudioPreload;
}

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
  /** The next item's plan, asked for ahead of the current item's end (gapless playback). */
  private prepared: Prepared | undefined;
  /** The session and next title whose preparation failed: not asked again until either changes. */
  private declined = '';
  /** Autoplay: what plays after a music title when the queue runs out (the server's continuation). */
  private continuation: ((id: string) => Promise<Card[]>) | undefined;
  /** The last item autoplay was asked for (`at:id`), so it is asked once. */
  private autoplayAsked = '';
  /** The queue item already played on afresh after it failed while the next was prepared (once each). */
  private retried = '';
  /** The playing item's loudness: its plan's (measured on the file playing), else its card's. */
  private loudness: V.Loudness | undefined;

  constructor(
    private readonly box: StateBox<VelaState>,
    private readonly session: Session,
    private readonly playback: Playback,
    private readonly random: Random = Math.random,
  ) {
    // A prepared session belongs to the old sign-in: dropped, never released through the new one.
    session.onReset(() => { this.prepared = undefined; this.halt(); this.box.update('audio', audio => ({ ...initialAudio, sound: audio.sound })); });
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

  /** Where autoplay finds what comes next (none: a queue simply ends). */
  setContinuation(find: ((id: string) => Promise<Card[]>) | undefined): void { this.continuation = find; }

  /**
   * Autoplay: on the last item of a music queue (repeat off), within a minute of its end, ask once
   * for what follows and append it, so the preload and gapless join treat it as the next item.
   */
  private autoplayNext(remaining: number): void {
    const queue = this.state.queue;
    const item = current(queue);
    if (!queue || !item || !this.continuation || queue.repeat !== 'off' || item.media?.class !== 'music') return;
    if (queue.at + 1 < queue.order.length || remaining > AUTOPLAY_LEAD) return;
    const asked = `${queue.at}:${item.id}`;
    if (this.autoplayAsked === asked) return;
    this.autoplayAsked = asked;
    void this.continuation(item.id).then(cards => {
      const now = this.state.queue;
      if (!now || !cards.length || current(now)?.id !== item.id) return;
      this.patch({ queue: appendAutoplay(now, cards, item.name) });
    }).catch(() => undefined);
  }

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
    this.lookAhead(to);
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
    this.lookAhead();
  }

  /** Play next / Add to queue; with nothing playing they start a queue of their own. */
  playNext(cards: Card[]): void { this.enqueue(cards, 'next'); }
  addToQueue(cards: Card[]): void { this.enqueue(cards, 'last'); }
  private enqueue(cards: Card[], where: 'next' | 'last'): void {
    const items = cards.filter(Boolean);
    if (!items.length) return;
    if (!this.state.queue) { this.play({ items, index: 0 }); return; }
    this.requeue(enqueue(this.state.queue, items, where));
  }
  /** Remove the upcoming item at play position `position`. */
  remove(position: number): void { if (this.state.queue) this.requeue(removeAt(this.state.queue, position)); }
  /** Move an upcoming item between play positions. */
  move(from: number, to: number): void { if (this.state.queue) this.requeue(moveTo(this.state.queue, from, to)); }
  clearQueued(): void { if (this.state.queue) this.requeue(clearQueued(this.state.queue)); }

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

  /** Replace the sound settings (checked, so a stored or partial value cannot break the engines). The
   * playing item and the prepared one follow at once. */
  setSound(next: SoundSettings): void {
    this.patch({ sound: soundSettings(next) });
    this.applySound();
    const prepared = this.prepared;
    if (prepared?.handed && prepared.handover && this.engine?.preload) {
      prepared.handover = this.handover(prepared, prepared.handover.url);
      this.engine.preload(prepared.handover);
    }
  }

  /** The playing item's levelling gain (linear) for the current settings. */
  private gainOf(item: Card | undefined, loudness: V.Loudness | undefined): number {
    return levellingGain(loudness, this.state.sound.levelling, { albumInOrder: albumInOrder(this.state.queue, item) }).linear;
  }

  /** Hand the engine the playing item's gain and the EQ. */
  private applySound(): void {
    this.engine?.setSound?.({ gain: this.gainOf(current(this.state.queue), this.loudness), eq: eqChain(this.state.sound.eq) });
  }

  /**
   * What the engine is handed for the prepared item: its gain, and AutoMix's crossfade where one is
   * allowed. Two sessions overlap in a crossfade, so it needs a server that keeps the outgoing one
   * serving (features.queuedPlayback.handoverSeconds), or the outgoing item already all in the engine;
   * it plays at 1x, and never into the same item again (repeat one).
   */
  private handover(prepared: Prepared, url: string): AudioPreload {
    const queue = this.state.queue;
    const item = current(queue);
    const after = queue && next(queue, true);
    const nextItem = current(after);
    const level = this.gainOf(nextItem, prepared.loudness);
    const gain = level === 1 ? {} : { gain: level };
    const duration = this.state.durationSeconds;
    const overlap = this.playback.handoverSeconds > 0 || this.bufferedToEnd(duration);
    if (!item || !nextItem || nextItem.id === item.id || this.state.rate !== 1 || !overlap || prepared.start > 0) return { url, startSeconds: prepared.start, ...gain };
    const transition = transitionBetween(
      { card: item, durationSeconds: duration, loudness: this.loudness },
      { card: nextItem, durationSeconds: prepared.plan?.durationSeconds ?? nextItem.durationSeconds, loudness: prepared.loudness },
      this.state.sound.automix,
    );
    if (transition.kind !== 'crossfade') return { url, startSeconds: prepared.start, ...gain };
    // The server keeps the outgoing session for its handover only: a fade never runs past it.
    const handoverCap = this.playback.handoverSeconds > 0 && !this.bufferedToEnd(duration) ? this.playback.handoverSeconds - 1 : Infinity;
    const seconds = Math.min(transition.seconds, handoverCap);
    return { url, startSeconds: transition.nextFrom, ...gain, crossfade: { seconds, at: transition.at + (transition.seconds - seconds) } };
  }

  toggleShuffle(): void { if (this.state.queue) this.requeue(toggleShuffle(this.state.queue, this.random)); }
  cycleRepeat(): void { if (this.state.queue) this.requeue(cycleRepeat(this.state.queue)); }

  /** A changed queue may change what plays next: the prepared item follows it. */
  private requeue(queue: AudioQueue): void {
    this.patch({ queue });
    this.lookAhead();
  }

  /** Stop and clear the queue; the server keeps the resume point. */
  async stop(): Promise<void> {
    this.observe('paused');
    // Asked before the queue and session are cleared: they are how the playback is known as ours.
    const owns = this.ownsPlayback();
    this.halt();
    this.box.update('audio', audio => ({ ...initialAudio, rate: audio.rate, unsupported: audio.unsupported, volume: audio.volume, muted: audio.muted, sound: audio.sound }));
    if (owns) await this.playback.stop();
  }

  /** Start the current item's session and load the engine when its plan arrives. */
  private async load(startSeconds: number): Promise<void> {
    const item = current(this.state.queue);
    if (!item) return;
    // The item prepared ahead (the viewer skipped to it, or an engine without gapless playback ended
    // the one before): its session is already there.
    const prepared = startSeconds === 0 && this.prepared?.id === item.id && this.prepared.plan ? this.prepared : undefined;
    if (prepared) this.prepared = undefined;
    else this.forget();
    const token = {};
    this.loadToken = token;
    this.autoplay = true;
    this.engine?.unload();
    this.sessionId = ''; this.url = '';
    this.patch({ phase: this.engine ? 'loading' : 'failed', positionSeconds: startSeconds, durationSeconds: item.durationSeconds, error: '' });
    if (!this.engine) { if (prepared?.plan) this.playback.release(prepared.plan); return; }
    if (prepared?.plan) {
      this.loadToken = undefined;
      this.playback.adopt(this.target(item.id), prepared.plan);
      this.begin(prepared.plan, startSeconds);
      return;
    }
    await this.playback.start(this.target(item.id, startSeconds));
    if (this.loadToken !== token) return;
    this.loadToken = undefined;
    const playback = this.box.get().playback;
    if (playback.phase === 'failed' || !playback.plan) {
      this.patch({ phase: 'failed', error: playback.error || 'This item could not be played' });
      return;
    }
    this.begin(playback.plan, startSeconds);
  }

  /** The playback target for a queue item: a title, with the queue's source as its play context
   * and the item's media class (a track's stop does not re-read Home's progress shelves). */
  private target(id: string, startSeconds = 0): Extract<PlaybackTarget, { kind: 'title' }> {
    const source = this.state.queue?.source;
    const context = source?.kind ? { kind: source.kind, id: source.id } : undefined;
    const media = this.state.queue?.items.find(item => item.id === id)?.media?.class;
    return { kind: 'title', id, ...(startSeconds > 0 ? { positionSeconds: startSeconds } : {}), ...(context ? { context } : {}), ...(media ? { media } : {}) };
  }

  private begin(plan: V.PlaybackPlan, startSeconds: number): void {
    const path = planURL(plan);
    if (!this.engine || !path) {
      this.patch({ phase: 'failed', error: 'This item has no playable audio' });
      return;
    }
    this.sessionId = plan.sessionId;
    this.url = path;
    this.sequence = 0;
    this.lastObservation = 0;
    this.loudness = loudnessOf(plan.loudness) ?? current(this.state.queue)?.media?.loudness;
    const start = plan.positionSeconds > 0 ? plan.positionSeconds : startSeconds;
    this.patch({ chapters: plan.chapters ?? [], durationSeconds: plan.durationSeconds ?? this.state.durationSeconds, positionSeconds: start });
    this.loadEngine(path, start, () => {
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
      const resolved = await this.resolve(url);
      if (!this.engine || this.sessionId !== sessionId || this.url !== url) return;
      this.engine.load(resolved, start, this.state.rate);
      this.engine.setVolume?.(this.state.muted ? 0 : this.state.volume);
      this.applySound();
      then();
    })();
  }

  /** The URL the engine plays: the server's credentialed form where it needs one (`loadEngine`). */
  private async resolve(url: string): Promise<string> {
    try {
      const access = await this.playback.mediaAccess();
      if (access?.nativeURL) return await access.nativeURL(url);
    } catch { /* The URL as planned: a server that needs no credential still plays it. */ }
    return url;
  }

  // Gapless playback: the next item's plan is asked for before the current item ends and handed to
  // the engine, which plays it straight on and says 'advanced'. The finished item's session then
  // ends (reported as ended, stopped) and the prepared one becomes the playing session.

  /** What plays when the current item ends by itself (itself on repeat-one); none when the queue
   * ends there or the sleep timer stops at the item's end. */
  private upcoming(): Card | undefined {
    const queue = this.state.queue;
    const sleep = this.state.sleep.mode;
    if (!queue || sleep === 'item' || sleep === 'chapter') return undefined;
    const after = next(queue, true);
    return after ? current(after) : undefined;
  }

  /**
   * Keep the prepared item in step: forget one that no longer plays next (the queue changed, or the
   * viewer sought far back), and ask for the one that does once the playing item nears its end.
   *
   * A server with queued sessions (features.queuedPlayback) opens the next plan beside the playing one,
   * which it keeps until the next is first observed playing. A server without them may keep one session
   * per device and end the playing one when the next is asked for (Ether did): there the next plan waits
   * until the engine holds the rest of the playing item (its buffered range reaches the end; the last
   * few seconds go ahead regardless), and spoken word, whose resume point the last report becomes,
   * waits until its last seconds. Either way the playing item reports where it is first.
   */
  private lookAhead(position = this.engine?.position() ?? this.state.positionSeconds): void {
    if (!this.engine || !this.sessionId) return;
    const duration = this.state.durationSeconds;
    const remaining = duration > 0 ? duration - position : Infinity;
    this.autoplayNext(remaining);
    const upcoming = this.upcoming();
    const cls = current(this.state.queue)?.media?.class;
    // AutoMix starts a crossfade before the audible end: the plan is asked for that much earlier.
    const tail = this.state.sound.automix.on && this.loudness?.trim ? Math.min(30, Math.max(0, duration - this.loudness.trim.endMs / 1000)) : 0;
    const lead = preloadLead(duration, !this.playback.queuedPlayback && (cls === 'audiobook' || cls === 'podcast')) + (this.state.sound.automix.on ? tail + 12 : 0);
    if (this.prepared && (this.prepared.id !== upcoming?.id || remaining > lead + PRELOAD_RELEASE_MARGIN)) this.forget();
    // Handed gapless only because the outgoing item was not all in the engine yet (a server without the
    // queued handover): now that it is, AutoMix's crossfade can still be handed.
    const held = this.prepared;
    if (held?.handed && held.handover && !held.handover.crossfade && this.state.sound.automix.on && this.engine.preload && this.bufferedToEnd(duration)) {
      const again = this.handover(held, held.handover.url);
      if (again.crossfade && again.crossfade.at > position + 1) { held.handover = again; this.engine.preload(again); }
    }
    if (!upcoming || this.prepared || remaining > lead || this.declined === `${this.sessionId}:${upcoming.id}`) return;
    if (this.state.phase !== 'playing' && this.state.phase !== 'buffering') return;
    if (!this.playback.queuedPlayback && remaining > PRELOAD_LAST_CALL && !this.bufferedToEnd(duration)) return;
    void this.prepare(upcoming.id);
  }

  /** The playing queue item: its place in the play order and its title. */
  private itemKey(): string { return `${this.state.queue?.at ?? -1}:${current(this.state.queue)?.id ?? ''}`; }

  /** The engine holds the playing item to its end. */
  private bufferedToEnd(duration: number): boolean {
    return (this.engine?.buffered() ?? []).some(range => range.endSeconds >= duration - 0.5);
  }

  private async prepare(id: string): Promise<void> {
    const prepared: Prepared = { id, start: 0, handed: false };
    this.prepared = prepared;
    const sessionId = this.sessionId;
    // Where the playing item is, before a server that ends it on the next request stops listening.
    this.observe('playing');
    let plan: V.PlaybackPlan | null = null;
    try { plan = await this.playback.prepare(this.target(id)); } catch { /* Loaded at the end instead. */ }
    if (this.prepared !== prepared) { if (plan) this.playback.release(plan); return; }
    const url = plan && planURL(plan);
    if (!plan || !url) {
      this.prepared = undefined;
      this.declined = `${sessionId}:${id}`;
      if (plan) this.playback.release(plan);
      return;
    }
    prepared.plan = plan;
    prepared.url = url;
    prepared.start = plan.positionSeconds > 0 ? plan.positionSeconds : 0;
    const queue = this.state.queue;
    prepared.loudness = loudnessOf(plan.loudness) ?? current(queue && next(queue, true))?.media?.loudness;
    if (!this.engine?.preload) return;
    const resolved = await this.resolve(url);
    if (this.prepared !== prepared || !this.engine?.preload) return;
    prepared.handover = this.handover(prepared, resolved);
    this.engine.preload(prepared.handover);
    prepared.handed = true;
  }

  /** Forget the prepared item: the engine drops it and the server releases its session. */
  private forget(): void {
    const prepared = this.prepared;
    if (!prepared) return;
    this.prepared = undefined;
    if (prepared.handed) this.engine?.preload?.(null);
    if (prepared.plan) this.playback.release(prepared.plan);
  }

  /** The engine finished the item and went straight on to the prepared one. */
  private advanced(): void {
    const prepared = this.prepared;
    const after = this.state.queue && next(this.state.queue, true);
    const item = current(after);
    if (!prepared?.plan || !prepared.handed || !after || item?.id !== prepared.id) {
      // It moved on to something the queue no longer plays next: play what does.
      this.ended();
      return;
    }
    this.prepared = undefined;
    this.retried = '';
    const fade = prepared.handover?.crossfade;
    // A crossfade with a server that keeps the outgoing session (handover): it is still playing out,
    // and the takeover counts it as played; it stops once the fade is over. Otherwise the finished
    // item's last report is its end, and its session stops as the next one starts.
    const overlapping = !!fade && this.playback.handoverSeconds > 0;
    if (overlapping) this.observe('playing', fade.at);
    else this.observe('ended', this.state.durationSeconds);
    const plan = prepared.plan;
    this.sessionId = plan.sessionId;
    this.url = prepared.url!;
    this.sequence = 0;
    this.lastObservation = 0;
    this.lastPatch = 0;
    this.playback.adopt(this.target(item.id), plan, overlapping ? { finishAfterMs: Math.ceil(fade.seconds * 1000) + 250 } : {});
    this.loudness = prepared.loudness;
    this.patch({
      queue: after, phase: 'playing', error: '', chapters: plan.chapters ?? [],
      durationSeconds: plan.durationSeconds ?? item.durationSeconds, positionSeconds: this.engine?.position() ?? prepared.start,
    });
    this.observe('playing');
    this.applySound();
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
    // Another session took over. Let go of ours first: an engine that reports its pause at once
    // must not find it still here, or the paused state's patch follows again, without end.
    if (playback.sessionId !== this.sessionId && playback.phase !== 'preparing') {
      this.sessionId = ''; this.url = '';
      this.forget();
      this.engine?.pause();
      this.engine?.unload();
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
      case 'error':
        // With the next item prepared, the playing item's session may have ended under it (a server with
        // one session per device): play on from where it was, on a new session, once.
        if (this.prepared?.plan && this.retried !== this.itemKey()) {
          this.retried = this.itemKey();
          this.forget();
          void this.load(position);
          break;
        }
        this.patch({ phase: 'failed', error: engine.error() || 'Playback failed' });
        break;
      case 'ended': this.ended(); break;
      case 'advanced': this.advanced(); break;
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
    this.lookAhead(position);
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

  private observe(state: V.PlayerObservation['state'], at?: number): void {
    const plan = this.box.get().playback.plan;
    if (!this.sessionId || !plan || plan.sessionId !== this.sessionId) return;
    this.lastObservation = Date.now();
    const sequence = ++this.sequence;
    const position = at ?? this.engine?.position() ?? this.state.positionSeconds;
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
    this.forget();
    this.loadToken = undefined;
    this.engine?.unload();
    this.sessionId = ''; this.url = '';
  }

  private patch(change: Partial<AudioState>): void {
    this.box.update('audio', audio => ({ ...audio, ...change }));
  }
}

/** The URL of the plan's selected path (the first path when none is selected), if it has one. */
function planURL(plan: V.PlaybackPlan): string | undefined {
  const path = plan.paths.find(p => p.id === plan.selectedPathId) ?? plan.paths[0];
  return path && 'url' in path && path.url ? path.url : undefined;
}

/** Where the chapter playing at `position` ends: its end, else the next chapter's start. */
export function chapterEnd(chapters: V.Chapter[], position: number): number | undefined {
  const sorted = [...chapters].sort((a, b) => a.startSeconds - b.startSeconds);
  const index = sorted.findLastIndex(c => c.startSeconds <= position);
  if (index < 0) return sorted[0]?.startSeconds;
  return sorted[index]!.endSeconds ?? sorted[index + 1]?.startSeconds;
}
