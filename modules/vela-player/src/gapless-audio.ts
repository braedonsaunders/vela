// The web's gapless music player (modules/vela-player/web/gapless): Web Audio fed by WebCodecs, so
// consecutive tracks join sample to sample. Web only (gapless-audio.web.ts); devices play gaplessly in
// their native players (audio.ts), so here there is none.
export type GaplessEvent = 'time' | 'playing' | 'paused' | 'waiting' | 'ended' | 'error' | 'duration' | 'advanced' | 'unsupported';

/** The EQ as filters (packages/core/src/audio/eq.ts, restated so this module needs no @vela/core). */
export interface GaplessEq { preGainDb: number; filters: { type: 'lowshelf' | 'peaking' | 'highshelf'; frequency: number; q: number; gainDb: number }[] }
/** The playing track's levelling gain (linear) and the EQ (every track). */
export interface GaplessSound { gain: number; eq: GaplessEq | null }
/** The next track: its levelling gain, and AutoMix's crossfade (start `seconds` before the current track's
 * audible end, at `at` seconds into it); without one the join is gapless. */
export interface GaplessNext { url: string; startSeconds: number; gain?: number; crossfade?: { seconds: number; at: number } }

export interface GaplessPlayer {
  load(url: string, startSeconds: number): void;
  /** The next track, joined to the current one ('advanced' when it takes over); null forgets it. */
  preload(next: GaplessNext | null): void;
  /** Levelling and the EQ (docs/sound.md). */
  setSound(sound: GaplessSound): void;
  /** What the last crossfade did: where it started on the outgoing track, its beat shift and tempo. */
  diagnostics(): { crossfade: { at: number; shift: number; bpm: number; start: number; seconds: number } | null };
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  unload(): void;
  position(): number;
  duration(): number;
  buffered(): { startSeconds: number; endSeconds: number }[];
  error(): string;
  /** The URL of the track playing. */
  url(): string;
  /** 'unsupported': this track cannot be opened or decoded here (before any of it played). */
  subscribe(listener: (event: GaplessEvent) => void): () => void;
  /** The node the player's output leaves through (for a measurement tap). */
  output(): AudioNode | null;
}

/** Whether this platform can run it: never off the web. */
export function gaplessSupported(): boolean { return false; }

export function createGaplessPlayer(): GaplessPlayer | null { return null; }
