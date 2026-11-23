// The native audio player behind the store's AudioEngine (packages/core/src/store/audio.ts): one
// player for the whole app in the native module (Media3 in a MediaSessionService on Android, AVPlayer
// with Now Playing and the remote commands on Apple). Platform-neutral: the native side is reached only
// through `NativeAudioBridge`, so the event mapping, load identity and position clock are testable.
import type { PlayerCapabilities } from '@vela/player-api';

export type NativeAudioState = 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'failed';
export type RemoteAudioCommand = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek' | 'skip';

/** What the native player reports, tagged with the load it belongs to. */
export type NativeAudioEvent =
  | { id: number; type: 'status'; state: NativeAudioState; position: number; duration: number; rate?: number;
      buffered?: { startSeconds: number; endSeconds: number }[]; error?: string }
  /** The system's media controls (lock screen, notification, headset, Siri Remote, car). */
  | { id: number; type: 'remote'; command: RemoteAudioCommand; seconds?: number };

/** A server's media authorization, resolved: headers for one origin and path prefix. */
export interface NativeAudioAccess { origin: string; pathPrefix: string; headers: Record<string, string> }

/** What Now Playing shows beside the player's own position, duration and rate. */
export interface NativeNowPlaying {
  title: string; artist: string; album: string; artwork: string;
  /** Spoken word (audiobooks, podcasts): the system offers 15/30-second skips rather than next/previous. */
  spoken: boolean;
}

export interface NativeAudioBridge {
  load(request: { id: number; url: string; access: NativeAudioAccess | null; start: number; rate: number }): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  unload(): void;
  nowPlaying(info: NativeNowPlaying | null): void;
  subscribe(listener: (event: NativeAudioEvent) => void): () => void;
}

/** The store's engine events (AudioEngineEvent), restated so this module needs no @vela/core. */
export type AudioEngineEvent = 'time' | 'playing' | 'paused' | 'waiting' | 'ended' | 'error' | 'duration';

export interface NativeAudioEngine {
  load(url: string, startSeconds: number, rate: number): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  unload(): void;
  position(): number;
  duration(): number;
  buffered(): { startSeconds: number; endSeconds: number }[];
  error(): string;
  subscribe(listener: (event: AudioEngineEvent) => void): () => void;
}

interface Status {
  state: NativeAudioState;
  position: number;
  duration: number;
  rate: number;
  buffered: { startSeconds: number; endSeconds: number }[];
  error: string;
  /** When `position` was true, on the engine's clock (ms). */
  at: number;
}

/** The store events a native status implies, given the previous one. */
export function audioEvents(previous: Pick<Status, 'state' | 'duration' | 'position'>, next: Pick<Status, 'state' | 'duration' | 'position'>): AudioEngineEvent[] {
  const events: AudioEngineEvent[] = [];
  if (next.duration > 0 && Math.abs(next.duration - previous.duration) > 0.25) events.push('duration');
  if (next.state !== previous.state) {
    const change = ({ playing: 'playing', paused: 'paused', buffering: 'waiting', ended: 'ended', failed: 'error' } as const)[next.state as 'playing'];
    if (change) events.push(change);
  }
  if (next.state === 'playing' || (next.position !== previous.position && next.state !== 'ended' && next.state !== 'failed')) events.push('time');
  return events;
}

/** The playing position between the native player's reports: it moves at the rate while playing. */
export function extrapolatedPosition(status: Pick<Status, 'state' | 'position' | 'duration' | 'rate' | 'at'>, now: number): number {
  if (status.state !== 'playing') return status.position;
  const moved = status.position + Math.max(0, now - status.at) / 1000 * status.rate;
  return status.duration > 0 ? Math.min(moved, status.duration) : moved;
}

/**
 * The store's engine over the native player. `authorize` resolves the media authorization a URL needs
 * (null for a server whose URLs carry their own, as Ether's do). Calls reach the native side in order;
 * a load waits for its authorization, and anything after it waits for the load.
 */
export function createNativeAudioEngine(
  bridge: NativeAudioBridge,
  options: { authorize?: (url: string) => Promise<NativeAudioAccess | null>; now?: () => number; onRemote?: (command: RemoteAudioCommand, seconds?: number) => void } = {},
): NativeAudioEngine {
  const now = options.now ?? Date.now;
  const listeners = new Set<(event: AudioEngineEvent) => void>();
  const emit = (event: AudioEngineEvent) => { for (const listener of [...listeners]) listener(event); };
  let id = 0;
  let loaded = false;
  let status: Status = { state: 'idle', position: 0, duration: 0, rate: 1, buffered: [], error: '', at: now() };
  let queue: Promise<void> = Promise.resolve();
  const send = (step: () => void | Promise<void>) => {
    queue = queue.then(step).catch(error => {
      if (!loaded) return;
      status = { ...status, state: 'failed', error: error instanceof Error && error.message ? error.message : 'Audio playback is unavailable', at: now() };
      emit('error');
    });
  };
  bridge.subscribe(event => {
    if (event.type === 'remote') { options.onRemote?.(event.command, event.seconds); return; }
    if (event.id !== id || !loaded) return;
    const previous = status;
    status = {
      state: event.state,
      position: Number.isFinite(event.position) ? Math.max(0, event.position) : previous.position,
      duration: Number.isFinite(event.duration) && event.duration > 0 ? event.duration : previous.duration,
      rate: event.rate && event.rate > 0 ? event.rate : previous.rate,
      buffered: event.buffered ?? previous.buffered,
      error: event.state === 'failed' ? event.error || 'Playback failed' : '',
      at: now(),
    };
    for (const change of audioEvents(previous, status)) emit(change);
  });
  return {
    load(url, startSeconds, rate) {
      const load = ++id;
      loaded = true;
      status = { state: 'loading', position: Math.max(0, startSeconds), duration: 0, rate, buffered: [], error: '', at: now() };
      send(async () => {
        const access = options.authorize ? await options.authorize(url) : null;
        if (load !== id) return;
        bridge.load({ id: load, url, access, start: Math.max(0, startSeconds), rate });
      });
    },
    play() { send(() => bridge.play()); },
    pause() { send(() => bridge.pause()); },
    seek(seconds) {
      status = { ...status, position: Math.max(0, seconds), at: now() };
      send(() => bridge.seek(Math.max(0, seconds)));
    },
    setRate(rate) {
      status = { ...status, position: extrapolatedPosition(status, now()), rate, at: now() };
      send(() => bridge.setRate(rate));
    },
    unload() {
      if (!loaded) return;
      loaded = false;
      id++;
      status = { state: 'idle', position: 0, duration: 0, rate: status.rate, buffered: [], error: '', at: now() };
      send(() => bridge.unload());
    },
    position: () => extrapolatedPosition(status, now()),
    duration: () => status.duration,
    buffered: () => status.buffered,
    error: () => status.error,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

/**
 * Audio files the native player opens itself, added to the device's declaration so Ether's plan
 * direct-plays them (lossless stays lossless) and transcodes the rest. Ether reads music and audiobooks
 * from the top-level `audioCodecs`/`containers` (the original-playback runtime is for video), and infers
 * the audio-only containers from the codecs: aac/alac → m4a, m4b, mp4; flac → flac; mp3 → mp3;
 * opus/vorbis → ogg, webm; pcm → wav.
 */
export const AUDIO_PLAYBACK: Record<'ios' | 'android', { audioCodecs: string[]; containers: string[] }> = {
  // AVPlayer: MP3, AAC and ALAC (MP4/M4A/M4B and ADTS), FLAC and WAV. It has no Ogg or WebM demuxer,
  // so Opus and Vorbis are transcoded.
  ios: { audioCodecs: ['aac', 'mp3', 'alac', 'flac', 'pcm'], containers: ['mp3', 'aac', 'm4a', 'm4b', 'flac', 'wav'] },
  // Media3: its extractors (MP3, ADTS, MP4, FLAC, Ogg, WebM, WAV) with platform decoders and the FFmpeg
  // audio extension (ALAC, and Opus/Vorbis/FLAC where MediaCodec lacks them).
  android: { audioCodecs: ['aac', 'mp3', 'alac', 'flac', 'opus', 'vorbis', 'pcm'], containers: ['mp3', 'aac', 'm4a', 'm4b', 'flac', 'ogg', 'webm', 'wav'] },
};

/** The device's capabilities with the native audio player's direct-play formats added. */
export function withAudioPlayback(capabilities: PlayerCapabilities, os: string): PlayerCapabilities {
  const audio = os === 'ios' || os === 'android' ? AUDIO_PLAYBACK[os] : undefined;
  if (!audio) return capabilities;
  const merge = (base: string[] | undefined, more: string[]) => [...new Set([...(base ?? []), ...more])];
  return { ...capabilities, audioCodecs: merge(capabilities.audioCodecs, audio.audioCodecs), containers: merge(capabilities.containers, audio.containers) };
}
