/** An owner preference is a bias, never a viewer-selectable playback mode. */
export interface LivePreference {
  latencyProfile: 'auto' | 'low' | 'stable';
  targetLatencySeconds: number;
}
export interface LiveLatencySample {
  now: number;
  playing: boolean;
  waiting: boolean;
  bufferAhead: number;
  bufferGoalSeconds?: number;
  throughputBps: number | null;
  bitrateBps: number | null;
  segmentSeconds: number;
  windowSeconds: number | null;
  behindSeconds: number | null;
}
export interface LiveLatencyDecision {
  targetSeconds: number;
  playbackRate: number;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Start with room for jitter, tighten only on sustained real buffer/transfer
 * evidence, and immediately back off on stalls. Never opens or switches a source. */
export class LiveLatency {
  private preference: LivePreference | undefined;
  private target: number | null = null;
  private last = 0;
  private steady: number | null = null;
  private cooldown = 0;
  private lastRelax = -Infinity;
  private hasPlayed = false;
  reset(preference?: LivePreference) {
    this.preference = preference;
    this.target = null;
    this.last = 0;
    this.steady = null;
    this.cooldown = 0;
    this.lastRelax = -Infinity;
    this.hasPlayed = false;
  }
  setPreference(preference?: LivePreference) {
    if (
      preference?.latencyProfile === this.preference?.latencyProfile &&
      preference?.targetLatencySeconds === this.preference?.targetLatencySeconds
    )
      return;
    this.preference = preference;
    this.steady = null;
  }
  sample(sample: LiveLatencySample): LiveLatencyDecision {
    const segment =
      Number.isFinite(sample.segmentSeconds) && sample.segmentSeconds > 0
        ? clamp(sample.segmentSeconds, 0.2, 10)
        : 2;
    const goal =
      sample.bufferGoalSeconds !== undefined && Number.isFinite(sample.bufferGoalSeconds)
        ? clamp(sample.bufferGoalSeconds, 0.5, segment * 2)
        : segment * 2;
    const profile = this.preference?.latencyProfile ?? 'auto';
    const declared = this.preference?.targetLatencySeconds;
    const preferred =
      declared && Number.isFinite(declared) && declared > 0 ? declared : Math.max(6, segment * 2);
    const floor = Math.max(1, segment * 1.5);
    const ceiling = Math.max(
      floor,
      Math.min(40, sample.windowSeconds && sample.windowSeconds > 0 ? sample.windowSeconds * 0.75 : 40),
    );
    const baseline = clamp(Math.max(preferred * 2, segment * 4, 12), floor, ceiling);
    this.target = clamp(this.target ?? baseline, floor, ceiling);
    const elapsed = this.last ? clamp((sample.now - this.last) / 1000, 0, 2) : 0;
    this.last = sample.now;
    if (sample.playing) this.hasPlayed = true;
    const bandwidthKnown =
      sample.throughputBps !== null && sample.bitrateBps !== null && sample.bitrateBps > 0;
    const headroom = bandwidthKnown ? sample.throughputBps! / sample.bitrateBps! : null;
    const starved =
      this.hasPlayed &&
      (sample.waiting || (sample.playing && sample.bufferAhead < Math.min(1, segment * 0.5)));
    const insufficient = sample.playing && headroom !== null && headroom < 1.25;
    if (starved || insufficient) {
      this.steady = null;
      this.cooldown = sample.now + 30000;
      if (sample.now - this.lastRelax >= 5000) {
        this.target = clamp(Math.max(baseline, this.target + segment * 2), floor, ceiling);
        this.lastRelax = sample.now;
      }
    } else if (
      sample.playing &&
      !sample.waiting &&
      sample.bufferAhead >= Math.min(goal, this.target * 0.75) &&
      (headroom === null ? sample.bufferAhead >= goal : headroom >= 1.5)
    ) {
      this.steady ??= sample.now;
      const stableFor = sample.now - this.steady,
        threshold = profile === 'low' ? 10000 : profile === 'stable' ? 45000 : 20000;
      if (sample.now >= this.cooldown && stableFor >= threshold) {
        const bias = profile === 'stable' ? 1 : stableFor >= 60000 ? 0.9 : 1;
        const goal = clamp(preferred * bias, floor, ceiling);
        this.target = Math.max(goal, this.target - elapsed * 0.5);
      }
    } else this.steady = null;
    const steady = this.steady !== null && sample.now - this.steady >= 5000;
    const catchingUp =
      sample.playing &&
      !sample.waiting &&
      steady &&
      sample.bufferAhead >= goal &&
      sample.behindSeconds !== null &&
      sample.behindSeconds > this.target + Math.max(1, segment);
    return { targetSeconds: this.target, playbackRate: catchingUp ? 1.03 : 1 };
  }
}
