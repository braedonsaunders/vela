// The web's gapless music player (modules/vela-player/web/gapless): Web Audio fed by WebCodecs, so
// consecutive tracks join sample to sample. Web only (gapless-audio.web.ts); devices play gaplessly in
// their native players (audio.ts), so here there is none.
export type GaplessEvent = 'time' | 'playing' | 'paused' | 'waiting' | 'ended' | 'error' | 'duration' | 'advanced' | 'unsupported';

export interface GaplessPlayer {
  load(url: string, startSeconds: number): void;
  /** The next track, joined to the current one with no gap ('advanced'); null forgets it. */
  preload(next: { url: string; startSeconds: number } | null): void;
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
