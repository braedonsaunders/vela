// Beat alignment for AutoMix on the web (docs/sound.md): the gapless player already decodes each track
// in the page, so an onset envelope is gathered as audio is decoded (no extra decode), and before a
// crossfade the outgoing track's tail and the incoming track's head are read for tempo and beat phase.
// The crossfade's start then moves by under half a beat so the incoming song's first beat lands on one
// of the outgoing song's beats. Pure: no Web Audio here.

/** Envelope resolution: one value per hop of this many seconds (about 86 a second). */
export const HOP_SECONDS = 512 / 44_100;
const MIN_BPM = 60, MAX_BPM = 200;

/** Onset strength as audio is decoded: the rise in log energy from one hop to the next. */
export class OnsetEnvelope {
  /** Track time of the first value, seconds. */
  start = 0;
  readonly values: number[] = [];
  private hop = 0;
  private filled = 0;
  private energy = 0;
  private last = -1;

  constructor(start = 0) { this.start = start; }

  /** Add decoded audio (planar channels at `sampleRate`), continuing from what came before. */
  push(channels: ArrayLike<number>[], frames: number, sampleRate: number): void {
    const hop = Math.max(1, Math.round(HOP_SECONDS * sampleRate));
    if (this.hop && hop !== this.hop) return;
    this.hop = hop;
    const count = channels.length || 1;
    for (let i = 0; i < frames; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c]![i]!;
      const mono = sum / count;
      this.energy += mono * mono;
      if (++this.filled === hop) {
        const level = Math.log10(1e-10 + this.energy / hop);
        this.values.push(this.last < -9 && this.values.length === 0 ? 0 : Math.max(0, level - (this.last === -1 ? level : this.last)));
        this.last = level;
        this.filled = 0;
        this.energy = 0;
      }
    }
  }

  /** The values between two track times (seconds), and the time of the first. */
  window(from: number, to: number): { values: number[]; start: number } {
    const a = Math.max(0, Math.floor((from - this.start) / HOP_SECONDS));
    const b = Math.min(this.values.length, Math.ceil((to - this.start) / HOP_SECONDS));
    return { values: this.values.slice(a, Math.max(a, b)), start: this.start + a * HOP_SECONDS };
  }
}

export interface Beat { period: number; confidence: number }

/** The beat period (seconds) by autocorrelation over 60–200 BPM. The envelope is smoothed (a click's
 * onset smears over a hop or two, and a period is rarely a whole number of hops); each candidate scores
 * its first three multiples (the beats a bar apart agree with it), mildly preferring 120 BPM between
 * octaves. Confidence is the winning lag's correlation over the envelope's own power (0 to 1). */
export function tempo(values: number[]): Beat {
  const minLag = Math.floor(60 / MAX_BPM / HOP_SECONDS), maxLag = Math.ceil(60 / MIN_BPM / HOP_SECONDS);
  if (values.length < maxLag * 4) return { period: 0, confidence: 0 };
  const smooth = values.map((_, i) => {
    let sum = 0, weight = 0;
    for (let k = -3; k <= 3; k++) { const v = values[i + k]; if (v === undefined) continue; const w = Math.exp(-(k * k) / 4.5); sum += v * w; weight += w; }
    return sum / weight;
  });
  const n = smooth.length;
  const mean = smooth.reduce((s, v) => s + v, 0) / n;
  const centred = smooth.map(v => v - mean);
  const limit = Math.min(n - 1, maxLag * 3 + 2);
  const auto: number[] = [];
  for (let lag = 0; lag <= limit; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += centred[i]! * centred[i - lag]!;
    auto.push(sum / (n - lag));
  }
  const power = auto[0]!;
  if (!(power > 0)) return { period: 0, confidence: 0 };
  /** Correlation at a fractional lag (linear between whole lags). */
  const at = (lag: number) => { const i = Math.floor(lag), f = lag - i; return i + 1 > limit ? 0 : auto[i]! * (1 - f) + auto[i + 1]! * f; };
  let best = -Infinity, bestLag = 0;
  for (let lag = minLag; lag <= maxLag; lag += 0.25) {
    const bpm = 60 / (lag * HOP_SECONDS);
    const weight = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    const score = (at(lag) + at(2 * lag) + at(3 * lag)) * (0.8 + 0.2 * weight);
    if (score > best) { best = score; bestLag = lag; }
  }
  if (!bestLag || best <= 0) return { period: 0, confidence: 0 };
  // Between octaves that score alike (half the period carries the beats just as well), the faster one:
  // a beat every other click is the same grid, but crossfades align on the beat.
  const plain = (lag: number) => at(lag) + at(2 * lag) + at(3 * lag);
  while (bestLag / 2 >= minLag && plain(bestLag / 2) >= 0.85 * plain(bestLag)) bestLag /= 2;
  return { period: bestLag * HOP_SECONDS, confidence: Math.max(0, Math.min(1, at(bestLag) / power)) };
}

/** Where the beats fall: the offset (seconds from the window's start) of the comb of `period` that
 * collects the most onset strength. */
export function phase(values: number[], period: number): number {
  const steps = Math.max(1, Math.round(period / HOP_SECONDS));
  let best = -1, bestOffset = 0;
  for (let offset = 0; offset < steps; offset++) {
    let sum = 0;
    for (let t = offset * HOP_SECONDS; t / HOP_SECONDS < values.length; t += period) sum += values[Math.round(t / HOP_SECONDS)] ?? 0;
    if (sum > best) { best = sum; bestOffset = offset; }
  }
  return bestOffset * HOP_SECONDS;
}

/**
 * Move a crossfade's start (`at`, seconds into the outgoing track) so the incoming track's first beat
 * (`incomingBeat` seconds after it starts) lands on an outgoing beat. Both tempos must be found with
 * some confidence and agree within 8% (else the beats drift apart at once and nothing moves); the move
 * is at most half a beat. Returns the new `at`.
 */
export function alignCrossfade(input: {
  at: number;
  outgoing: { values: number[]; start: number };
  incoming: { values: number[]; start: number; from: number };
}): { at: number; shift: number; bpm: number } {
  const out = tempo(input.outgoing.values);
  const inc = tempo(input.incoming.values);
  if (out.confidence < 0.15 || inc.confidence < 0.15 || !out.period || !inc.period) return { at: input.at, shift: 0, bpm: 0 };
  const ratio = out.period / inc.period;
  if (Math.abs(ratio - 1) > 0.08) return { at: input.at, shift: 0, bpm: 0 };
  const outBeats = input.outgoing.start + phase(input.outgoing.values, out.period);
  const incomingBeat = input.incoming.start + phase(input.incoming.values, inc.period) - input.incoming.from;
  // Where the incoming beat would land on the outgoing track's clock, and the nearest outgoing beat.
  const lands = input.at + incomingBeat;
  const k = Math.round((lands - outBeats) / out.period);
  const shift = outBeats + k * out.period - lands;
  if (Math.abs(shift) > out.period / 2 + 1e-9) return { at: input.at, shift: 0, bpm: 0 };
  return { at: input.at + shift, shift, bpm: 60 / out.period };
}
