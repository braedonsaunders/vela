import type { Rendition } from './model';
export class BandwidthEstimator {
  private fast = 0; private slow = 0;
  get bps(): number | null { return this.fast ? Math.min(this.fast, this.slow) : null; }
  sample(bytes: number, elapsedMs: number, cached: boolean) {
    if (cached || bytes < 16384 || elapsedMs < 50) return;
    const rate = bytes * 8000 / elapsedMs, seconds = elapsedMs / 1000;
    const blend = (old: number, halfLife: number) => old ? old + (rate - old) * (1 - 2 ** (-seconds / halfLife)) : rate;
    this.fast = blend(this.fast, 3); this.slow = blend(this.slow, 10);
  }
}
export class AdaptiveBitrate {
  private upSince = 0;
  manual: string | null = null;
  choose(ladder: Rendition[], current: Rendition | undefined, buffer: number, throughput: number | null, dropRatio: number, now: number): Rendition {
    const sorted = [...ladder].sort((a, b) => a.bandwidth - b.bandwidth);
    if (!sorted.length) throw new Error('No playable renditions');
    const manual = sorted.find(r => r.id === this.manual);
    if (manual) return manual;
    const budget = (throughput ?? sorted[0].bandwidth) * (buffer < 4 ? 0.55 : buffer < 12 ? 0.7 : 0.85);
    let next = sorted.filter(r => r.bandwidth <= budget).at(-1) ?? sorted[0];
    if (buffer < 2) next = sorted[0];
    if (dropRatio > 0.05 && current) next = sorted.filter(r => r.bandwidth < current.bandwidth).at(-1) ?? sorted[0];
    if (current && next.bandwidth > current.bandwidth) {
      if (dropRatio > 0.01) { this.upSince = 0; return current; }
      if (!this.upSince) this.upSince = now;
      // Keep throughput stability across browser-managed fetch pauses, but never up-switch on a low buffer.
      if (buffer < 12 || now - this.upSince < 12000) return current;
      this.upSince = 0;
      return sorted.find(r => r.bandwidth > current.bandwidth) ?? current;
    }
    this.upSince = 0; return next;
  }
  /** A lower segment must beat both the stalled request and buffer exhaustion. */
  abandon(current: Rendition, lower: Rendition, duration: number, received: number, elapsed: number, buffer: number) {
    if (elapsed < 1000 || lower.bandwidth >= current.bandwidth || buffer > 8 || received <= 0) return false;
    const rate = received * 8 / (elapsed / 1000);
    const remaining = Math.max(0, current.bandwidth * duration - received * 8) / rate;
    const replacement = lower.bandwidth * duration / rate + 0.25;
    return remaining > buffer && replacement < remaining && replacement < Math.max(buffer, 1);
  }
}
