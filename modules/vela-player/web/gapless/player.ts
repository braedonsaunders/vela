// The web's gapless music player: tracks decoded in the page (stream.ts) and scheduled back to back
// on one AudioContext clock, so the next track's first sample follows the last one's exactly (an
// album like a live record plays as one unbroken performance). The context runs at the first track's
// sample rate, so audio is never resampled between buffers; the output device's rate is the browser's
// concern after that. It plays at 1x only (Web Audio cannot keep pitch at speed): the app's audio engine
// hands speed changes, and anything this browser cannot open or decode here, to an <audio> element.
import type { PcmChunk } from './stream';
import { TrackStream, UnsupportedTrack } from './stream';
import { registerDecoder } from 'mediabunny';
import type { GaplessEvent, GaplessPlayer } from '../../src/gapless-audio';
import { CompatAudioDecoder } from './compat-decoder';

/** Seconds of audio kept scheduled ahead of the clock (background tabs tick about once a second). */
const AHEAD = 6;
/** Seconds of the next track decoded before it is needed. */
const NEXT_PREFETCH = 2;
/** In its last this-many seconds the playing track is decoded to its end. */
const END_WINDOW = 30;
/** How far ahead of the clock a fresh start (load, seek, resume after a stall) is placed. */
const START_MARGIN = 0.06;

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
}

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
  let volume = 1;
  let items: Item[] = [];
  let wanted = false;
  let waiting = false;
  let ended = false;
  let failure = '';
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastTime = 0;

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
    return context;
  }

  function stopNodes(item: Item): void {
    for (const node of item.nodes) { node.onended = null; try { node.stop(); } catch { /* Not started. */ } node.disconnect(); }
    item.nodes.clear();
  }

  function retire(item: Item): void {
    stopNodes(item);
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
  }

  function create(url: string, from: number): Item {
    const item: Item = { url, from, open: TrackStream.open(url), generation: 0, decoding: false, buffered: [], exhausted: false, frames: 0, nodes: new Set() };
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
        if (!before || !finished(before) || before.startTime === undefined) break;
        // Straight after the one before; a track handed over too late starts as soon as it can.
        item.startTime = Math.max(scheduledEnd(before), ctx.currentTime + 0.02);
      }
      while (item.buffered.length && scheduledEnd(item) < horizon) {
        const chunk = item.buffered.shift()!;
        const buffer = ctx.createBuffer(chunk.channels.length, chunk.frames, chunk.sampleRate);
        chunk.channels.forEach((plane, channel) => buffer.copyToChannel(plane as Float32Array<ArrayBuffer>, channel));
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(output);
        node.start(scheduledEnd(item));
        item.frames += chunk.frames;
        item.nodes.add(node);
        node.onended = () => { item.nodes.delete(node); node.disconnect(); };
      }
      if (!finished(item)) break;
    }
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
    if (next) void decode(next, next.startTime === undefined ? NEXT_PREFETCH : AHEAD);
    schedule();
    if (current.startTime === undefined) return;
    const now = audible();
    // The clock reached the next track: it is the one playing now.
    if (next?.startTime !== undefined && now >= next.startTime) {
      retire(current);
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
      ended = false; waiting = false; failure = '';
      const item = create(url, Math.max(0, startSeconds));
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
    preload(next) {
      const held = items[1];
      if (held && next && held.url === next.url && held.from === Math.max(0, next.startSeconds)) return;
      if (held) { retire(held); items = items.slice(0, 1); }
      if (!next || !items[0]) return;
      const item = create(next.url, Math.max(0, next.startSeconds));
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
    unload() {
      for (const item of items) retire(item);
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
    output: () => gain,
  };
}
