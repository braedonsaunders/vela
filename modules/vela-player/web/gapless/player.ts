// The web's gapless music player: tracks decoded in the page (stream.ts) and scheduled back to back
// on one AudioContext clock, so the next track's first sample follows the last one's exactly (an
// album like a live record plays as one unbroken performance). The context runs at the first track's
// sample rate, so audio is never resampled between buffers; the output device's rate is the browser's
// concern after that. It plays at 1x only (Web Audio cannot keep pitch at speed): the app's audio engine
// hands speed changes, and anything this browser cannot open or decode here, to an <audio> element.
// Sound (docs/sound.md): each track has its own levelling gain and fade gain, summed into one bus that
// runs through the EQ (a pre-gain and ten biquads) to the volume. A gapless join switches levelling at
// the boundary sample (each track's own gain node); an AutoMix crossfade starts the next track before
// the current one's audible end, nudged onto the beat (beats.ts), with equal-power fades.
import type { PcmChunk } from './stream';
import { TrackStream, UnsupportedTrack } from './stream';
import { registerDecoder } from 'mediabunny';
import type { GaplessEvent, GaplessNext, GaplessPlayer, GaplessSound } from '../../src/gapless-audio';
import { CompatAudioDecoder } from './compat-decoder';
import { alignCrossfade, OnsetEnvelope } from './beats';

/** Seconds of audio kept scheduled ahead of the clock (background tabs tick about once a second). */
const AHEAD = 6;
/** Seconds of the next track decoded before it is needed. */
const NEXT_PREFETCH = 2;
/** In its last this-many seconds the playing track is decoded to its end. */
const END_WINDOW = 30;
/** How far ahead of the clock a fresh start (load, seek, resume after a stall) is placed. */
const START_MARGIN = 0.06;
/** Seconds of a crossfading next track decoded before it starts (its first beats are read from them). */
const CROSSFADE_PREFETCH = 10;
/** The outgoing track's tail read for its beat: this long before the crossfade start, and after. */
const BEAT_BEFORE = 10, BEAT_AFTER = 2;
/** A crossfade handed over too late to fade properly still fades over at least this long. */
const MIN_FADE = 0.3;
/** Levelling and EQ changes glide over about this long (seconds, a time constant): no clicks. */
const GLIDE = 0.015;

function curve(f: (x: number) => number): Float32Array {
  const points = new Float32Array(128);
  for (let i = 0; i < points.length; i++) points[i] = f(i / (points.length - 1));
  return points;
}
/** Equal-power crossfade shapes. */
const FADE_OUT = curve(x => Math.cos((x * Math.PI) / 2));
const FADE_IN = curve(x => Math.sin((x * Math.PI) / 2));

interface Item {
  url: string;
  from: number;
  open: Promise<TrackStream>;
  stream?: TrackStream;
  /** The decode in progress: a new one (a seek) retires the old. */
  pcm?: AsyncGenerator<PcmChunk>;
  generation: number;
  decoding: boolean;
  buffered: PcmChunk[];
  exhausted: boolean;
  /** Context time of `from`, once scheduled; frames scheduled since (at the track's rate). */
  startTime?: number;
  frames: number;
  nodes: Set<AudioBufferSourceNode>;
  failed?: unknown;
  /** Its levelling (linear), applied by its own gain node; then its fade gain; then the bus. */
  gain: number;
  level?: GainNode;
  fade?: GainNode;
  /** AutoMix: it starts `seconds` before the one before ends, at `at` seconds into that one. */
  crossfade?: { seconds: number; at: number };
  /** Its crossfade start was moved onto the beat (once per scheduling). */
  aligned?: boolean;
  /** Context time its fade-out ends (it is the outgoing track of a crossfade). */
  fadeEnd?: number;
  /** Onset strength as it is decoded, for beat alignment. */
  env: OnsetEnvelope;
}

/** What the last crossfade did, for measurement and diagnostics. */
export interface CrossfadeReport { at: number; shift: number; bpm: number; start: number; seconds: number }

/**
 * Whether this browser can run the gapless player: Web Audio, and WebCodecs to decode, or (a page served
 * over plain http, where WebCodecs is withheld) Web Audio's own decoder for FLAC, MP3 and AAC-LC.
 */
export function gaplessSupported(): boolean {
  return typeof window !== 'undefined' && typeof AudioContext !== 'undefined' && (typeof AudioDecoder !== 'undefined' || typeof OfflineAudioContext !== 'undefined');
}

let registered = false;

export function createGaplessPlayer(): GaplessPlayer {
  // Only claims codecs where WebCodecs is missing, so the video player's decoding is untouched.
  if (!registered) { registered = true; registerDecoder(CompatAudioDecoder); }
  const listeners = new Set<(event: GaplessEvent) => void>();
  const emit = (event: GaplessEvent) => { for (const listener of [...listeners]) listener(event); };
  let context: AudioContext | null = null;
  let gain: GainNode | null = null;
  let bus: GainNode | null = null;
  let pre: GainNode | null = null;
  let filters: BiquadFilterNode[] = [];
  let volume = 1;
  let sound: GaplessSound = { gain: 1, eq: null };
  let items: Item[] = [];
  /** Outgoing tracks still fading out under the one playing. */
  let fading: Item[] = [];
  let lastCrossfade: CrossfadeReport | null = null;
  let lastAlignment = { shift: 0, bpm: 0 };
  let wanted = false;
  let waiting = false;
  let ended = false;
  let failure = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastTime = 0;
  /** The next track as an unload left it, opened and partly decoded: a load of it (Next while it was
   * ready) starts from it at once. Any other load retires it. */
  let spare: Item | undefined;

  const rateOf = (item: Item) => item.stream?.sampleRate ?? context?.sampleRate ?? 44100;
  const scheduledEnd = (item: Item) => (item.startTime ?? 0) + item.frames / rateOf(item);
  const finished = (item: Item) => item.exhausted && !item.buffered.length && !item.decoding;
  const audible = () => {
    if (!context) return 0;
    const stamp = context.getOutputTimestamp?.();
    return stamp?.contextTime && stamp.contextTime > 0 ? stamp.contextTime : Math.max(0, context.currentTime - (context.baseLatency || 0));
  };

  function ensureContext(rate: number): AudioContext {
    if (context && context.sampleRate === rate && context.state !== 'closed') return context;
    void context?.close().catch(() => undefined);
    context = new AudioContext({ sampleRate: rate, latencyHint: 'playback' });
    gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(context.destination);
    // Tracks → bus → EQ pre-gain → ten biquads → volume. With the EQ off every filter is at 0 dB, which
    // passes the signal unchanged.
    bus = context.createGain();
    pre = context.createGain();
    filters = Array.from({ length: 10 }, () => context!.createBiquadFilter());
    bus.connect(pre);
    [pre, ...filters].forEach((node, i, chain) => node.connect(chain[i + 1] ?? gain!));
    applyEq(true);
    return context;
  }

  /** Put the EQ on the filters (`now`: at once, as the graph is built; else gliding). */
  function applyEq(now = false): void {
    const ctx = context;
    if (!ctx || !pre) return;
    const set = (param: AudioParam, value: number) => { if (now) param.value = value; else param.setTargetAtTime(value, ctx.currentTime, GLIDE); };
    const eq = sound.eq;
    set(pre.gain, eq ? 10 ** (eq.preGainDb / 20) : 1);
    filters.forEach((filter, i) => {
      const band = eq?.filters[i];
      filter.type = band?.type ?? (i === 0 ? 'lowshelf' : i === 9 ? 'highshelf' : 'peaking');
      if (band) { filter.frequency.value = Math.min(band.frequency, ctx.sampleRate / 2); filter.Q.value = band.q; }
      set(filter.gain, band?.gainDb ?? 0);
    });
  }

  /** A track's own gain nodes into the bus, made when it is first scheduled. */
  function nodesFor(item: Item): GainNode {
    const ctx = context!;
    if (!item.level || item.level.context !== ctx) {
      item.level = ctx.createGain();
      item.level.gain.value = item.gain;
      item.fade = ctx.createGain();
      item.level.connect(item.fade);
      item.fade.connect(bus!);
    }
    return item.level;
  }

  /** Fade `outgoing` out and `incoming` in over `seconds` from context time `start`. */
  function crossfade(outgoing: Item, incoming: Item, start: number, seconds: number): void {
    const ctx = context!;
    nodesFor(outgoing); nodesFor(incoming);
    const out = outgoing.fade!.gain, into = incoming.fade!.gain;
    out.cancelScheduledValues(ctx.currentTime);
    out.setValueAtTime(1, ctx.currentTime);
    out.setValueCurveAtTime(FADE_OUT, start, seconds);
    into.cancelScheduledValues(ctx.currentTime);
    into.setValueAtTime(0, ctx.currentTime);
    into.setValueCurveAtTime(FADE_IN, start, seconds);
    outgoing.fadeEnd = start + seconds;
  }

  /** Move a crossfade's start onto the beat, from the onsets around it (the outgoing tail, the
   * incoming head); no move when either tempo is unclear or they disagree. */
  function aligned(outgoing: Item, incoming: Item, at: number): number {
    const duration = outgoing.stream?.duration ?? Infinity;
    const result = alignCrossfade({
      at,
      outgoing: outgoing.env.window(at - BEAT_BEFORE, at + BEAT_AFTER),
      incoming: { ...incoming.env.window(incoming.from, incoming.from + CROSSFADE_PREFETCH), from: incoming.from },
    });
    // Never past the outgoing track's end, nor before what is already playing.
    const moved = Math.min(result.at, duration - 0.5) >= outgoing.from ? Math.min(result.at, duration - 0.5) : at;
    lastAlignment = { shift: moved - at, bpm: result.bpm };
    return moved;
  }

  function stopNodes(item: Item): void {
    for (const node of item.nodes) { node.onended = null; try { node.stop(); } catch { /* Not started. */ } node.disconnect(); }
    item.nodes.clear();
    // A fade planned on it no longer applies: back to full, ready to fade again.
    if (item.fade && context) { item.fade.gain.cancelScheduledValues(0); item.fade.gain.value = item.crossfade && item.startTime === undefined ? 0 : 1; }
    item.fadeEnd = undefined;
  }

  function retireFading(): void { for (const item of fading) retire(item); fading = []; }

  function retire(item: Item): void {
    stopNodes(item);
    item.level?.disconnect(); item.fade?.disconnect();
    item.level = undefined; item.fade = undefined;
    item.generation++;
    void item.pcm?.return(undefined).catch(() => undefined);
    item.pcm = undefined;
    item.open.then(stream => stream.close(), () => undefined);
  }

  /** Restart an item's decode at `from` (a seek, or the next track whose scheduled audio was dropped). */
  function rewind(item: Item, from: number): void {
    stopNodes(item);
    item.generation++;
    void item.pcm?.return(undefined).catch(() => undefined);
    item.pcm = undefined;
    item.from = from;
    item.buffered = [];
    item.exhausted = false;
    item.decoding = false;
    item.startTime = undefined;
    item.frames = 0;
    item.aligned = false;
    item.env = new OnsetEnvelope(from);
  }

  function create(url: string, from: number, gainValue = 1, fade?: Item['crossfade']): Item {
    const item: Item = { url, from, open: TrackStream.open(url), generation: 0, decoding: false, buffered: [], exhausted: false, frames: 0, nodes: new Set(),
      gain: gainValue, ...(fade ? { crossfade: fade } : {}), env: new OnsetEnvelope(from) };
    item.open.then(stream => { item.stream = stream; }, error => { item.failed = error; });
    return item;
  }

  /** Decode `item` until `seconds` of it wait beyond what is scheduled (or it ends). */
  async function decode(item: Item, seconds: number): Promise<void> {
    if (item.decoding || item.exhausted || item.failed) return;
    item.decoding = true;
    const generation = item.generation;
    try {
      const stream = await item.open;
      if (item.generation !== generation) return;
      item.pcm ??= stream.pcm(item.from);
      const ahead = () => item.buffered.reduce((sum, chunk) => sum + chunk.frames, 0) / stream.sampleRate
        + (item.startTime !== undefined && context ? Math.max(0, scheduledEnd(item) - context.currentTime) : 0);
      while (ahead() < seconds) {
        const next = await item.pcm.next();
        if (item.generation !== generation) return;
        if (next.done) { item.exhausted = true; break; }
        item.buffered.push(next.value);
        item.env.push(next.value.channels, next.value.frames, next.value.sampleRate);
        schedule();
      }
    } catch (error) {
      if (item.generation !== generation) return;
      item.failed = error;
    } finally {
      if (item.generation === generation) item.decoding = false;
    }
    if (item.failed) failed(item);
    else schedule();
  }

  function failed(item: Item): void {
    if (item === items[0]) {
      // The track never played a sample here: another engine may play it.
      const unsupported = item.failed instanceof UnsupportedTrack && item.startTime === undefined;
      failure = item.failed instanceof Error && item.failed.message ? item.failed.message : 'Playback failed';
      for (const each of items) retire(each);
      items = [];
      wanted = false;
      stop();
      emit(unsupported ? 'unsupported' : 'error');
    } else if (item === items[1]) {
      // A next track that cannot play here is dropped: the current one ends and the app loads it.
      retire(item);
      items = items.slice(0, 1);
    }
  }

  /** Put decoded audio on the clock, up to AHEAD seconds out, the next track straight after the current. */
  function schedule(): void {
    const ctx = context;
    const output = gain;
    if (!ctx || !output) return;
    const current = items[0];
    if (!current?.stream) return;
    if (current.startTime === undefined) {
      if (!wanted || ctx.state !== 'running' || (!current.buffered.length && !current.exhausted)) return;
      current.startTime = ctx.currentTime + START_MARGIN;
    }
    const horizon = ctx.currentTime + AHEAD;
    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      if (!item.stream) break;
      if (item.startTime === undefined) {
        const before = items[index - 1];
        if (!before || before.startTime === undefined) break;
        if (item.crossfade && before.stream) {
          // AutoMix: it starts inside the one before. Decided once its start is near, when the audio
          // around it (the outgoing tail, the incoming head) is decoded for the beat.
          const planned = before.startTime + (item.crossfade.at - before.from);
          if (planned > horizon + 2) break;
          if (!item.aligned) { item.aligned = true; item.crossfade = { ...item.crossfade, at: aligned(before, item, item.crossfade.at) }; }
          const due = before.startTime + (item.crossfade.at - before.from);
          // Handed over late (a seek, a slow decode): it starts now and fades over what is left.
          const start = Math.max(due, ctx.currentTime + 0.05);
          const seconds = Math.max(MIN_FADE, item.crossfade.seconds - (start - due));
          item.startTime = start;
          crossfade(before, item, start, seconds);
          lastCrossfade = { at: item.crossfade.at, shift: lastAlignment.shift, bpm: lastAlignment.bpm, start, seconds };
        } else {
          if (!finished(before)) break;
          // Straight after the one before; a track handed over too late starts as soon as it can.
          item.startTime = Math.max(scheduledEnd(before), ctx.currentTime + 0.02);
        }
      }
      // An outgoing track is scheduled only to the end of its fade.
      const limit = item.fadeEnd !== undefined ? Math.min(horizon, item.fadeEnd + 0.05) : horizon;
      const into = nodesFor(item);
      while (item.buffered.length && scheduledEnd(item) < limit) {
        const chunk = item.buffered.shift()!;
        const buffer = ctx.createBuffer(chunk.channels.length, chunk.frames, chunk.sampleRate);
        chunk.channels.forEach((plane, channel) => buffer.copyToChannel(plane as Float32Array<ArrayBuffer>, channel));
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(into);
        node.start(scheduledEnd(item));
        item.frames += chunk.frames;
        item.nodes.add(node);
        node.onended = () => { item.nodes.delete(node); node.disconnect(); };
      }
      if (!finished(item) && !items[index + 1]?.crossfade) break;
    }
    void output;
  }

  function tick(): void {
    const ctx = context;
    const current = items[0];
    if (!ctx || !current) return;
    // Keep decoding ahead: the current track to AHEAD, and to its end in its last half minute (the app
    // asks for the next track's plan once this one is all here: a server may end a device's playing
    // session as it opens the next); the next track a little before it is needed.
    const left = (current.stream?.duration ?? 0) - clockPosition(current);
    void decode(current, current.stream?.duration && left <= END_WINDOW ? Infinity : AHEAD);
    const next = items[1];
    if (next) void decode(next, next.startTime === undefined ? (next.crossfade ? CROSSFADE_PREFETCH : NEXT_PREFETCH) : AHEAD);
    schedule();
    if (current.startTime === undefined) return;
    const now = audible();
    // An outgoing track whose fade is over goes.
    if (fading.length) fading = fading.filter(item => { if (now < (item.fadeEnd ?? 0) + 0.1) return true; retire(item); return false; });
    // The clock reached the next track: it is the one playing now (a crossfading one as it starts;
    // the outgoing track plays out its fade underneath).
    if (next?.startTime !== undefined && now >= next.startTime) {
      if (current.fadeEnd !== undefined) fading.push(current);
      else retire(current);
      items = items.slice(1);
      lastTime = 0;
      emit('advanced');
      emit('duration');
      return;
    }
    const last = items.findLast(item => item.startTime !== undefined) ?? current;
    const chainDone = items.every(finished);
    if (chainDone && !items[1] && now >= scheduledEnd(current)) {
      if (!ended) { ended = true; wanted = false; stop(); emit('ended'); }
      return;
    }
    // Out of decoded audio (a slow network): hold the clock until there is some again.
    if (wanted && !chainDone && ctx.state === 'running' && scheduledEnd(last) - ctx.currentTime < 0.15 && !waiting) {
      waiting = true;
      void ctx.suspend();
      emit('waiting');
    } else if (waiting && (scheduledEnd(last) - ctx.currentTime > 1 || chainDone)) {
      waiting = false;
      if (wanted) void ctx.resume().then(() => emit('playing'));
    }
    if (ctx.state === 'running' && Date.now() - lastTime >= 250) { lastTime = Date.now(); emit('time'); }
  }

  function start(): void { timer ??= setInterval(tick, 100); }

  /** Run the clock (a play, or a play asked for before the track opened). */
  function resume(): void {
    const ctx = context;
    if (!ctx) return;
    start();
    void ctx.resume().then(() => {
      if (!wanted) return;
      schedule();
      emit(waiting ? 'waiting' : 'playing');
    }, () => { wanted = false; emit('paused'); });
  }
  function stop(): void { if (timer !== undefined) clearInterval(timer); timer = undefined; }

  const clockPosition = (item: Item) => {
    if (item.startTime === undefined || !context) return item.from;
    const duration = item.stream?.duration ?? 0;
    const at = item.from + Math.max(0, audible() - item.startTime);
    return duration > 0 ? Math.min(at, duration) : at;
  };

  return {
    load(url, startSeconds) {
      for (const item of items) retire(item);
      retireFading();
      ended = false; waiting = false; failure = '';
      const from = Math.max(0, startSeconds);
      const reused = spare && spare.url === url && spare.from === from && !spare.failed ? spare : undefined;
      if (spare && !reused) retire(spare);
      spare = undefined;
      const item = reused ?? create(url, from);
      items = [item];
      item.open.then(stream => {
        if (items[0] !== item) return;
        ensureContext(stream.sampleRate);
        emit('duration');
        start();
        void decode(item, 1);
        if (wanted) resume();
        else void context!.suspend();
      }, () => { if (items[0] === item) failed(item); });
    },
    preload(next: GaplessNext | null) {
      const held = items[1];
      if (held && next && held.url === next.url && held.from === Math.max(0, next.startSeconds)) {
        // The same track with new sound (a settings change): its gain, and its crossfade until it starts.
        held.gain = next.gain ?? 1;
        if (held.level && context) held.level.gain.setTargetAtTime(held.gain, context.currentTime, GLIDE);
        if (held.startTime === undefined) { held.crossfade = next.crossfade; held.aligned = false; }
        return;
      }
      if (held) { retire(held); items = items.slice(0, 1); }
      if (!next || !items[0]) return;
      const item = create(next.url, Math.max(0, next.startSeconds), next.gain ?? 1, next.crossfade);
      items = [items[0], item];
      item.open.then(() => { if (items[1] === item) void decode(item, NEXT_PREFETCH); }, () => { if (items[1] === item) failed(item); });
    },
    play() {
      wanted = true;
      ended = false;
      // Before the track opens there is no clock yet: it starts then.
      if (items[0]?.stream) resume();
    },
    pause() {
      wanted = false;
      void context?.suspend();
      emit('paused');
    },
    seek(seconds) {
      const current = items[0];
      if (!current) return;
      ended = false;
      const to = Math.max(0, seconds);
      retireFading();
      rewind(current, to);
      // The next track's scheduled audio hung off the old end: it is scheduled again after the new one.
      const next = items[1];
      if (next && (next.startTime !== undefined || next.frames)) rewind(next, next.from);
      start();
      void decode(current, 1);
      lastTime = 0;
      emit('time');
    },
    setVolume(value) { volume = value; if (gain) gain.gain.value = value; },
    setSound(value) {
      const eqChanged = JSON.stringify(value.eq) !== JSON.stringify(sound.eq);
      sound = value;
      const current = items[0];
      if (current) {
        current.gain = value.gain;
        if (current.level && context) current.level.gain.setTargetAtTime(value.gain, context.currentTime, GLIDE);
      }
      if (eqChanged) applyEq();
    },
    diagnostics: () => ({ crossfade: lastCrossfade }),
    unload() {
      const next = items[1];
      // An unload with nothing loaded (a second one in a row) keeps what the first kept.
      if (items.length && spare) { retire(spare); spare = undefined; }
      if (next) {
        // Kept, unscheduled, for a load of the same track.
        if (next.startTime !== undefined || next.frames) rewind(next, next.from);
        stopNodes(next);
        spare = next;
      }
      for (const item of items) if (item !== next) retire(item);
      retireFading();
      items = [];
      wanted = false; waiting = false; ended = false;
      stop();
      void context?.suspend();
    },
    position: () => (items[0] ? clockPosition(items[0]) : 0),
    duration: () => items[0]?.stream?.duration ?? 0,
    buffered() {
      const item = items[0];
      if (!item?.stream) return [];
      const decoded = item.buffered.reduce((sum, chunk) => sum + chunk.frames, 0) / item.stream.sampleRate;
      return [{ startSeconds: item.from, endSeconds: item.from + item.frames / item.stream.sampleRate + decoded }];
    },
    error: () => failure,
    url: () => items[0]?.url ?? '',
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    mixedOutput: () => filters.at(-1) ?? null,
    output: () => gain,
  };
}
