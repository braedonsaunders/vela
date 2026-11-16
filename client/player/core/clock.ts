import type { AudioClockAnchor } from './types';

/** Playback intent belongs to Vela; only rendered audio advances an audio clock. */
export class MediaClock {
  private epoch = 0;
  private positionUs = 0;
  private anchoredAtMs = 0;
  private rate = 1;
  private playing = false;
  private audio = false;
  private anchor: AudioClockAnchor | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  reset(positionUs: number, epoch: number, hasAudio: boolean): void {
    if (!Number.isFinite(positionUs) || positionUs < 0 || !Number.isSafeInteger(epoch) || epoch < this.epoch)
      throw new Error('Invalid playback clock reset');
    this.epoch = epoch;
    this.positionUs = positionUs;
    this.anchoredAtMs = this.now();
    this.audio = hasAudio;
    this.anchor = null;
  }

  update(anchor: AudioClockAnchor): boolean {
    if (
      anchor.epoch !== this.epoch ||
      !this.audio ||
      ![anchor.mediaTimeUs, anchor.performanceTimeMs, anchor.bufferedUntilUs].every(Number.isFinite) ||
      anchor.bufferedUntilUs < anchor.mediaTimeUs ||
      (this.anchor && anchor.performanceTimeMs < this.anchor.performanceTimeMs)
    )
      return false;
    this.anchor = { ...anchor };
    return true;
  }

  time(): number {
    const now = this.now();
    let candidate = this.positionUs;
    if (this.audio) {
      if (this.playing && this.anchor) {
        const elapsed = this.anchor.playing
          ? Math.max(0, now - this.anchor.performanceTimeMs) * 1000 * this.rate
          : 0;
        candidate = Math.min(this.anchor.bufferedUntilUs, this.anchor.mediaTimeUs + elapsed);
      }
    } else if (this.playing) candidate += Math.max(0, now - this.anchoredAtMs) * 1000 * this.rate;
    // Output timestamp jitter must not move the visible timeline backwards.
    this.positionUs = Math.max(this.positionUs, candidate);
    this.anchoredAtMs = now;
    return this.positionUs;
  }

  setPlaying(playing: boolean): void {
    this.time();
    this.playing = playing;
    this.anchoredAtMs = this.now();
    // A resumed audio output must publish a fresh physical timestamp.
    if (!playing) this.anchor = null;
  }

  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate < 0.25 || rate > 4) throw new Error('Unsupported playback rate');
    this.time();
    this.rate = rate;
    this.anchoredAtMs = this.now();
    this.anchor = null;
  }
}
