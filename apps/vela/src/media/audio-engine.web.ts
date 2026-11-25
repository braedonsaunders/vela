// The web's audio engine, one for the whole app so music keeps playing while the viewer browses, with
// the Media Session API for the browser's and the OS's media controls (lock screen, keyboard media
// keys, headset buttons). Two players behind it:
// - the gapless player (@vela/player/src/gapless-audio: WebCodecs, or Web Audio's own decoder on a page
//   served over plain http, into Web Audio), which joins consecutive tracks sample to sample. It needs a
//   decoder for the track's codec and 1x speed (Web Audio cannot keep pitch at speed);
// - otherwise <audio> elements: the current one and the next, ready, started the moment the current one
//   ends (close, but not sample-exact: the element's own start-up sits between the tracks).
import type { AudioEngine, AudioEngineEvent, AudioPreload, AudioSound, AudioState } from '@vela/core';
import { currentInQueue } from '@vela/core';
import { createGaplessPlayer, gaplessSupported } from '@vela/player/src/gapless-audio';
import { publishMusicOutput } from '../visualizer/music-output.web';

type ElementEngine = AudioEngine & { preload(next: AudioPreload | null): void };

/** One <audio> element for the item playing and one holding the next, swapped at the end. */
function createElementEngine(): ElementEngine {
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const emit = (event: AudioEngineEvent) => { for (const listener of [...listeners]) listener(event); };
  let rate = 1;
  let volume = 1;
  /** Levelling: an element can only turn down (volume tops out at 1), and has no EQ. */
  let level = 1;
  const loudness = () => volume * Math.min(1, level);
  let start = 0;
  let loaded = false;
  let spare: { element: HTMLAudioElement; url: string; start: number } | null = null;
  const make = () => {
    const created = new Audio();
    created.preload = 'auto';
    // Spoken word keeps its pitch at speed.
    (created as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    const on = (name: string, event: AudioEngineEvent) => created.addEventListener(name, () => { if (loaded && created === element) emit(event); });
    on('playing', 'playing');
    on('pause', 'paused');
    on('waiting', 'waiting');
    on('error', 'error');
    on('durationchange', 'duration');
    on('timeupdate', 'time');
    created.addEventListener('ended', () => { if (loaded && created === element) finished(); });
    created.addEventListener('loadedmetadata', () => {
      if (created !== element || !loaded) return;
      if (start > 0 && Number.isFinite(created.duration)) created.currentTime = Math.min(start, Math.max(0, created.duration - 1));
      start = 0;
    });
    return created;
  };
  let element = make();
  const clear = (old: HTMLAudioElement) => { old.pause(); old.removeAttribute('src'); old.load(); };
  /** The item ended: the next one, already buffered, starts at once and takes over. */
  const finished = () => {
    const next = spare;
    if (!next) { emit('ended'); return; }
    spare = null;
    const old = element;
    element = next.element;
    element.playbackRate = rate; element.defaultPlaybackRate = rate; element.volume = loudness();
    if (next.start > 0 && element.readyState > 0) element.currentTime = next.start;
    void element.play().catch(() => emit('paused'));
    clear(old);
    emit('advanced');
  };
  return {
    load(url, startSeconds, value) {
      if (spare) { clear(spare.element); spare = null; }
      loaded = true;
      start = startSeconds;
      rate = value;
      element.src = url;
      element.playbackRate = rate;
      element.defaultPlaybackRate = rate;
      element.load();
    },
    preload(next) {
      if (spare && next && spare.url === next.url) return;
      if (spare) { clear(spare.element); spare = null; }
      if (!next || !loaded) return;
      const held = make();
      held.src = next.url;
      held.load();
      spare = { element: held, url: next.url, start: next.startSeconds };
    },
    play() { void element.play().catch(() => emit('paused')); },
    pause() { element.pause(); },
    seek(seconds) { if (element.readyState > 0) element.currentTime = seconds; else start = seconds; },
    setRate(value) { rate = value; element.playbackRate = value; element.defaultPlaybackRate = value; },
    setVolume(value) { volume = value; element.volume = loudness(); },
    setSound(sound) { level = sound.gain; element.volume = loudness(); },
    unload() {
      if (spare) { clear(spare.element); spare = null; }
      if (!loaded) return;
      loaded = false;
      clear(element);
    },
    position: () => (start > 0 && element.readyState === 0 ? start : element.currentTime || 0),
    duration: () => (Number.isFinite(element.duration) ? element.duration : 0),
    buffered() {
      const ranges = [];
      for (let i = 0; i < element.buffered.length; i++) ranges.push({ startSeconds: element.buffered.start(i), endSeconds: element.buffered.end(i) });
      return ranges;
    },
    error: () => element.error?.message || (element.error ? `Media error ${element.error.code}` : ''),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/**
 * Browsers give media controls (keys, lock screen, the OS's Now Playing) only to a playing media
 * element. While Web Audio plays, a silent looping one stands in for it.
 */
function silentKeepAlive(): { play(): void; pause(): void } {
  let element: HTMLAudioElement | null = null;
  const make = () => {
    // Ten seconds of 8 kHz mono silence (a media session needs a few seconds of media).
    const frames = 80_000, bytes = new DataView(new ArrayBuffer(44 + frames * 2));
    const text = (at: number, value: string) => [...value].forEach((ch, i) => bytes.setUint8(at + i, ch.charCodeAt(0)));
    text(0, 'RIFF'); bytes.setUint32(4, 36 + frames * 2, true); text(8, 'WAVEfmt '); bytes.setUint32(16, 16, true);
    bytes.setUint16(20, 1, true); bytes.setUint16(22, 1, true); bytes.setUint32(24, 8000, true); bytes.setUint32(28, 16000, true);
    bytes.setUint16(32, 2, true); bytes.setUint16(34, 16, true); text(36, 'data'); bytes.setUint32(40, frames * 2, true);
    const created = new Audio(URL.createObjectURL(new Blob([bytes.buffer], { type: 'audio/wav' })));
    created.loop = true;
    return created;
  };
  return {
    play() { element ??= make(); void element.play().catch(() => undefined); },
    pause() { element?.pause(); },
  };
}

const HLS = /\.m3u8(?:[?#]|$)/i;

let diagnose: () => unknown = () => null;

/** What the engine last did with sound (the last crossfade: where, its beat shift and tempo), for checks. */
export function audioDiagnostics(): unknown { return diagnose(); }

/** The browser plays only URLs that carry their own authorization, so it takes no authorizer. */
export function createAudioEngine(_authorize?: unknown): (AudioEngine & { dispose(): void }) | null {
  if (typeof document === 'undefined' || typeof Audio === 'undefined') return null;
  const element = createElementEngine();
  const gapless = gaplessSupported() ? createGaplessPlayer() : null;
  diagnose = () => gapless?.diagnostics() ?? null;
  const keepAlive = silentKeepAlive();
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const emit = (event: AudioEngineEvent) => { for (const listener of [...listeners]) listener(event); };
  let active: 'element' | 'gapless' = 'element';
  let rate = 1;
  let wanted = false;
  let url = '';
  let start = 0;
  let next: AudioPreload | null = null;
  let playing = false;
  const syncOutput = () => {
    if (!url || active !== 'gapless') { publishMusicOutput('unavailable', null, false); return; }
    const node = gapless?.output() ?? null;
    publishMusicOutput(node ? 'ready' : 'opening', node, playing);
  };
  const fits = (candidate: string) => !!gapless && rate === 1 && !HLS.test(candidate);
  /** Hand the item to the <audio> element at `at` seconds (speed changed, or the track cannot be decoded here). */
  const toElement = (at: number) => {
    gapless?.unload();
    keepAlive.pause();
    active = 'element';
    playing = false; syncOutput();
    element.load(url, at, rate);
    element.preload(next);
    if (wanted) element.play();
  };
  element.subscribe(event => { if (active === 'element') emit(event); });
  gapless?.subscribe(event => {
    if (active !== 'gapless') return;
    switch (event) {
      case 'unsupported': toElement(start); return;
      case 'playing': playing = true; keepAlive.play(); break;
      case 'waiting': playing = false; break;
      case 'paused': case 'ended': case 'error': playing = false; keepAlive.pause(); break;
      case 'advanced': url = gapless.url(); start = 0; next = null; break;
    }
    syncOutput();
    emit(event);
  });
  const engine = () => (active === 'gapless' && gapless ? gapless : element);
  return {
    load(value, startSeconds, speed) {
      playing = false; rate = speed; url = value; start = startSeconds; next = null; wanted = false;
      element.unload();
      gapless?.unload();
      keepAlive.pause();
      if (fits(value)) { active = 'gapless'; gapless!.load(value, startSeconds); }
      else { active = 'element'; element.load(value, startSeconds, speed); }
      syncOutput();
    },
    preload(value) {
      next = value;
      if (active === 'element') element.preload(value);
      else gapless!.preload(value && fits(value.url) ? value : null);
    },
    play() { wanted = true; engine().play(); },
    pause() { wanted = false; engine().pause(); },
    seek(seconds) { engine().seek(seconds); },
    setRate(speed) {
      rate = speed;
      if (active === 'gapless' && speed !== 1) toElement(gapless!.position());
      else element.setRate(speed);
    },
    setVolume(volume) { element.setVolume?.(volume); gapless?.setVolume(volume); },
    setSound(sound: AudioSound) { element.setSound?.(sound); gapless?.setSound(sound); },
    unload() { wanted = false; playing = false; url = ''; next = null; syncOutput(); element.unload(); gapless?.unload(); keepAlive.pause(); },
    position: () => engine().position(),
    duration: () => engine().duration(),
    buffered: () => engine().buffered(),
    error: () => engine().error(),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** AudioDock unmounted: nothing more reaches the store it was attached to. */
    dispose() { active = 'element'; url = ''; syncOutput(); listeners.clear(); },
  };
}

export interface MediaSessionControls {
  play(): void; pause(): void; next(): void; previous(): void; seek(seconds: number): void; skip(delta: number): void;
}

let installed: MediaSessionControls | null = null;
let shown = '';

/** Keep the browser's media session in step with the queue. */
export function syncMediaSession(state: AudioState, controls: MediaSessionControls): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  const item = currentInQueue(state.queue);
  if (installed !== controls) {
    installed = controls;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => { try { session.setActionHandler(action, handler); } catch { /* Unsupported action. */ } };
    set('play', () => controls.play());
    set('pause', () => controls.pause());
    set('nexttrack', () => controls.next());
    set('previoustrack', () => controls.previous());
    set('seekto', details => { if (details.seekTime !== undefined) controls.seek(details.seekTime); });
    set('seekbackward', details => controls.skip(-(details.seekOffset ?? 15)));
    set('seekforward', details => controls.skip(details.seekOffset ?? 30));
  }
  const key = item ? `${item.id}|${item.poster}` : '';
  if (key !== shown) {
    shown = key;
    session.metadata = item ? new MediaMetadata({
      title: item.name,
      artist: item.media?.byline ?? '',
      album: item.media?.parent?.name ?? state.queue?.source?.name ?? '',
      artwork: item.poster ? [{ src: item.poster, sizes: '512x512' }] : [],
    }) : null;
  }
  session.playbackState = state.phase === 'playing' || state.phase === 'buffering' ? 'playing' : item ? 'paused' : 'none';
  if (item && state.durationSeconds > 0 && 'setPositionState' in session) {
    try { session.setPositionState({ duration: state.durationSeconds, playbackRate: state.rate, position: Math.min(state.positionSeconds, state.durationSeconds) }); } catch { /* Out-of-range during a load. */ }
  }
}
