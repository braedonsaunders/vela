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
  | { id: number; type: 'remote'; command: RemoteAudioCommand; seconds?: number }
  /** The player finished its item and went straight on to the preloaded one, whose id this is. */
  | { id: number; type: 'advanced'; position?: number; duration?: number };

/** A server's media authorization, resolved: headers for one origin and path prefix. */
export interface NativeAudioAccess { origin: string; pathPrefix: string; headers: Record<string, string> }

/** What Now Playing shows beside the player's own position, duration and rate. */
export interface NativeNowPlaying {
  title: string; artist: string; album: string; artwork: string;
  /** Spoken word (audiobooks, podcasts): the system offers 15/30-second skips rather than next/previous. */
  spoken: boolean;
}

/** The item the native player readies to play straight after its current one. `gain`: its levelling
 * (linear, default 1). `crossfade` (AutoMix): start it `seconds` before the current item's audible end,
 * at `at` seconds into the current item, with equal-power fades (cos/sin) on both; the outgoing item
 * plays out its fade and is then dropped, and `advanced` (the preload's id) is sent when it starts.
 * Without it the join is gapless, as before. */
export interface NativeAudioPreload { id: number; url: string; access: NativeAudioAccess | null; start: number; gain?: number; crossfade?: { seconds: number; at: number } }

/** One EQ filter, Robert Bristow-Johnson's cookbook exactly as Web Audio's BiquadFilterNode defines it
 * (peaking with Q; shelves with slope 1; packages/core/src/audio/eq.ts). */
export interface NativeEqFilter { type: 'lowshelf' | 'peaking' | 'highshelf'; frequency: number; q: number; gainDb: number }
/** Levelling and the EQ: the playing item's gain (linear; may exceed 1, the store has already limited
 * it against the track's peak) and the EQ for every item (a pre-gain in dB, then the filters in order;
 * null: none). Native players apply them to decoded PCM, sample-accurately per item. */
export interface NativeSound { gain: number; eq: { preGainDb: number; filters: NativeEqFilter[] } | null }

export interface NativeAudioBridge {
  load(request: { id: number; url: string; access: NativeAudioAccess | null; start: number; rate: number }): void;
  /** Gapless playback: queue the next item after the current one, or drop it (null). A native player
   * without it ends each item. */
  preload?(request: NativeAudioPreload | null): void;
  /** Levelling and the EQ; a native player without it plays at unity with no EQ. */
  sound?(sound: NativeSound): void;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  unload(): void;
  nowPlaying(info: NativeNowPlaying | null): void;
  subscribe(listener: (event: NativeAudioEvent) => void): () => void;
}

/** The store's engine events (AudioEngineEvent), restated so this module needs no @vela/core. */
export type AudioEngineEvent = 'time' | 'playing' | 'paused' | 'waiting' | 'ended' | 'error' | 'duration' | 'advanced';

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
  /** Gapless playback and AutoMix (the store's AudioEngine.preload). */
  preload(next: { url: string; startSeconds: number; gain?: number; crossfade?: { seconds: number; at: number } } | null): void;
  /** Levelling and the EQ (the store's AudioEngine.setSound). */
  setSound(sound: NativeSound): void;
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
  /**
   * The native clock was seen moving: a playing report ahead of the one before it. A new item (a
   * load, a gapless advance) or a seek is not moving until a report shows it: a queue player's next
   * item stands still for a moment after it takes over, and extrapolating over that ran a second
   * ahead and then jumped back.
   */
  moving?: boolean;
}

/** How far the position may run on past the native player's last report (it reports twice a second
 * while playing): a clock that stops without saying so is not extrapolated for long. */
const EXTRAPOLATE_SECONDS = 1.5;

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

/** The playing position between the native player's reports: it moves at the rate while playing and
 * the clock is known to move, for a little beyond the last report. */
export function extrapolatedPosition(status: Pick<Status, 'state' | 'position' | 'duration' | 'rate' | 'at' | 'moving'>, now: number): number {
  if (status.state !== 'playing' || status.moving === false) return status.position;
  const moved = status.position + Math.min(EXTRAPOLATE_SECONDS, Math.max(0, now - status.at) / 1000) * status.rate;
  return status.duration > 0 ? Math.min(moved, status.duration) : moved;
}

/** A report this little behind the position already shown is the extrapolation running a touch ahead,
 * not a move: the shown position holds until the clock passes it. */
const JITTER_SECONDS = 1.5;

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
  /** Ids for loads and preloads alike, so an event names exactly one of them. */
  let serial = 0;
  /** The load whose events reach the store, and the preloaded item the native player holds (0: none). */
  let id = 0;
  let queued = 0;
  let loaded = false;
  let status: Status = { state: 'idle', position: 0, duration: 0, rate: 1, buffered: [], error: '', at: now(), moving: false };
  /** The position last given to the store, for this item and since its last seek: it never goes back. */
  let shown = 0;
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
    // The preloaded item took over: from here on its events are the store's. A status that names it
    // before the advance itself arrives is the advance.
    if (loaded && queued && event.id === queued) {
      id = queued;
      queued = 0;
      const { position, duration } = event;
      status = { state: 'playing', position: position !== undefined && Number.isFinite(position) ? Math.max(0, position) : 0,
        duration: duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : 0, rate: status.rate, buffered: [], error: '', at: now(), moving: false };
      shown = status.position;
      emit('advanced');
      if (event.type === 'advanced') return;
    }
    if (event.type === 'advanced' || event.id !== id || !loaded) return;
    const previous = status;
    const position = Number.isFinite(event.position) ? Math.max(0, event.position) : previous.position;
    status = {
      state: event.state,
      position,
      duration: Number.isFinite(event.duration) && event.duration > 0 ? event.duration : previous.duration,
      rate: event.rate && event.rate > 0 ? event.rate : previous.rate,
      buffered: event.buffered ?? previous.buffered,
      error: event.state === 'failed' ? event.error || 'Playback failed' : '',
      at: now(),
      moving: event.state === 'playing' && (position > previous.position || (!!previous.moving && position === previous.position && previous.state === 'playing')),
    };
    // Stopped (paused, buffering, ended), nothing is extrapolated and the report is the position; a
    // real move back while playing (beyond jitter) is the native player's truth too.
    if (event.state !== 'playing' || position < shown - JITTER_SECONDS) shown = position;
    for (const change of audioEvents(previous, status)) emit(change);
  });
  return {
    load(url, startSeconds, rate) {
      const load = ++serial;
      id = load;
      queued = 0;
      loaded = true;
      status = { state: 'loading', position: Math.max(0, startSeconds), duration: 0, rate, buffered: [], error: '', at: now(), moving: false };
      shown = status.position;
      send(async () => {
        const access = options.authorize ? await options.authorize(url) : null;
        if (load !== id) return;
        bridge.load({ id: load, url, access, start: Math.max(0, startSeconds), rate });
      });
    },
    play() { send(() => bridge.play()); },
    pause() { send(() => bridge.pause()); },
    seek(seconds) {
      status = { ...status, position: Math.max(0, seconds), at: now(), moving: false };
      shown = status.position;
      send(() => bridge.seek(Math.max(0, seconds)));
    },
    setRate(rate) {
      status = { ...status, position: extrapolatedPosition(status, now()), rate, at: now() };
      send(() => bridge.setRate(rate));
    },
    preload(next) {
      const preload = bridge.preload?.bind(bridge);
      if (!preload || !loaded) return;
      const item = next ? ++serial : 0;
      queued = item;
      send(async () => {
        if (!next) { preload(null); return; }
        const access = options.authorize ? await options.authorize(next.url) : null;
        if (queued !== item) return;
        preload({ id: item, url: next.url, access, start: Math.max(0, next.startSeconds),
          ...(next.gain !== undefined && next.gain !== 1 ? { gain: next.gain } : {}), ...(next.crossfade ? { crossfade: next.crossfade } : {}) });
      });
    },
    setSound(sound) {
      // Sent in order with the rest; the native player keeps it for the items that follow.
      const apply = bridge.sound?.bind(bridge);
      if (apply) send(() => apply({ gain: sound.gain, eq: sound.eq }));
    },
    unload() {
      if (!loaded) return;
      loaded = false;
      id = ++serial;
      queued = 0;
      status = { state: 'idle', position: 0, duration: 0, rate: status.rate, buffered: [], error: '', at: now(), moving: false };
      shown = 0;
      send(() => bridge.unload());
    },
    position: () => {
      shown = Math.max(shown, extrapolatedPosition(status, now()));
      return shown;
    },
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

/** What an audio session declares on a device: exactly what the native audio player opens (AVPlayer or
 * Media3), not the video player's decoders it does not share. Elsewhere the device's own list. */
export function nativeAudioCapabilities(capabilities: PlayerCapabilities, os: string): PlayerCapabilities {
  const audio = os === 'ios' || os === 'android' ? AUDIO_PLAYBACK[os] : undefined;
  if (!audio) return capabilities;
  return { containers: [...audio.containers], videoCodecs: [], audioCodecs: [...audio.audioCodecs], subtitleFormats: [], hls: capabilities.hls, mse: false };
}

/** The device's capabilities with the native audio player's direct-play formats added. */
export function withAudioPlayback(capabilities: PlayerCapabilities, os: string): PlayerCapabilities {
  const audio = os === 'ios' || os === 'android' ? AUDIO_PLAYBACK[os] : undefined;
  if (!audio) return capabilities;
  const merge = (base: string[] | undefined, more: string[]) => [...new Set([...(base ?? []), ...more])];
  return { ...capabilities, audioCodecs: merge(capabilities.audioCodecs, audio.audioCodecs), containers: merge(capabilities.containers, audio.containers) };
}
