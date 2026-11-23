// The web's audio engine: one HTMLAudioElement for the whole app, so music keeps playing while
// the viewer browses, and the Media Session API for the browser's and the OS's media controls
// (lock screen, keyboard media keys, headset buttons).
import type { AudioEngine, AudioEngineEvent, AudioState } from '@vela/core';
import { currentInQueue } from '@vela/core';

/** The browser plays only URLs that carry their own authorization, so it takes no authorizer. */
export function createAudioEngine(_authorize?: unknown): AudioEngine | null {
  if (typeof document === 'undefined' || typeof Audio === 'undefined') return null;
  const element = new Audio();
  element.preload = 'auto';
  // Spoken word keeps its pitch at speed.
  (element as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const emit = (event: AudioEngineEvent) => { for (const listener of [...listeners]) listener(event); };
  let start = 0;
  let loaded = false;
  const on = (name: string, event: AudioEngineEvent) => element.addEventListener(name, () => { if (loaded) emit(event); });
  on('playing', 'playing');
  on('pause', 'paused');
  on('waiting', 'waiting');
  on('ended', 'ended');
  on('error', 'error');
  on('durationchange', 'duration');
  on('timeupdate', 'time');
  element.addEventListener('loadedmetadata', () => {
    if (loaded && start > 0 && Number.isFinite(element.duration)) element.currentTime = Math.min(start, Math.max(0, element.duration - 1));
    start = 0;
  });
  return {
    load(url, startSeconds, rate) {
      loaded = true;
      start = startSeconds;
      element.src = url;
      element.playbackRate = rate;
      element.defaultPlaybackRate = rate;
      element.load();
    },
    play() { void element.play().catch(() => emit('paused')); },
    pause() { element.pause(); },
    seek(seconds) { if (element.readyState > 0) element.currentTime = seconds; else start = seconds; },
    setRate(rate) { element.playbackRate = rate; element.defaultPlaybackRate = rate; },
    setVolume(volume) { element.volume = volume; },
    unload() {
      if (!loaded) return;
      loaded = false;
      element.pause();
      element.removeAttribute('src');
      element.load();
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
