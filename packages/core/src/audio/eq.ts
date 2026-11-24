// The equalizer as filters (docs/sound.md): one definition every engine applies, so a preset sounds the
// same on the web, Android and Apple. Ten bands: a low shelf at 31 Hz, peaking filters an octave wide
// from 62 Hz to 8 kHz, a high shelf at 16 kHz. The coefficients are Robert Bristow-Johnson's cookbook,
// exactly as Web Audio's BiquadFilterNode defines them (peaking with Q, shelves with slope 1), so the
// native taps compute what the browser computes.
import { EQ_BANDS_HZ, type SoundSettings } from './sound';

export type FilterType = 'lowshelf' | 'peaking' | 'highshelf';

export interface EqFilter { type: FilterType; frequency: number; q: number; gainDb: number }

/** What an engine applies: a gain before the filters (headroom for boosts, dB) and the filters. */
export interface EqChain { preGainDb: number; filters: EqFilter[] }

/** One octave: Q = √2. */
export const EQ_Q = Math.SQRT2;

/** The chain for the settings, or null when the EQ is off or flat (nothing to apply). A boost lowers
 * the signal by the largest positive gain first, so the filters never push full scale over. */
export function eqChain(eq: SoundSettings['eq']): EqChain | null {
  if (!eq.on || eq.bands.every(gain => gain === 0)) return null;
  const filters = EQ_BANDS_HZ.map((frequency, i): EqFilter => ({
    type: i === 0 ? 'lowshelf' : i === EQ_BANDS_HZ.length - 1 ? 'highshelf' : 'peaking',
    frequency, q: EQ_Q, gainDb: eq.bands[i] ?? 0,
  }));
  return { preGainDb: -Math.max(0, ...eq.bands), filters };
}

/** Normalised biquad coefficients (a0 = 1): y = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2. */
export interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

/** A filter's coefficients at a sample rate. A frequency at or above Nyquist passes the shelf's gain
 * (high shelf) or nothing changes (peaking, low shelf), as Web Audio does. */
export function biquad(filter: EqFilter, sampleRate: number): Biquad {
  const nyquist = sampleRate / 2;
  const A = 10 ** (filter.gainDb / 40);
  if (filter.frequency >= nyquist) {
    return filter.type === 'highshelf' ? { b0: A * A, b1: 0, b2: 0, a1: 0, a2: 0 } : { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
  }
  const w0 = (2 * Math.PI * filter.frequency) / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (filter.type === 'peaking') {
    const alpha = sin / (2 * filter.q);
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
  } else {
    // Shelf slope 1.
    const alpha = (sin / 2) * Math.SQRT2;
    const root = 2 * Math.sqrt(A) * alpha;
    if (filter.type === 'lowshelf') {
      b0 = A * ((A + 1) - (A - 1) * cos + root); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - root);
      a0 = (A + 1) + (A - 1) * cos + root; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - root;
    } else {
      b0 = A * ((A + 1) + (A - 1) * cos + root); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - root);
      a0 = (A + 1) - (A - 1) * cos + root; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - root;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** The magnitude of one biquad at a frequency, dB. */
export function biquadResponseDb(c: Biquad, frequency: number, sampleRate: number): number {
  const w = (2 * Math.PI * frequency) / sampleRate;
  // H(e^jw) = (b0 + b1 e^-jw + b2 e^-2jw) / (1 + a1 e^-jw + a2 e^-2jw)
  const re = (b0: number, b1: number, b2: number) => b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
  const im = (b1: number, b2: number) => -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
  const nr = re(c.b0, c.b1, c.b2), ni = im(c.b1, c.b2), dr = re(1, c.a1, c.a2), di = im(c.a1, c.a2);
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
}

/** The whole chain's magnitude at a frequency, dB (the pre-gain included): what a sweep measures. */
export function chainResponseDb(chain: EqChain | null, frequency: number, sampleRate: number): number {
  if (!chain) return 0;
  return chain.filters.reduce((sum, f) => sum + biquadResponseDb(biquad(f, sampleRate), frequency, sampleRate), chain.preGainDb);
}

/** Equal-power crossfade gains at fraction x (0..1) of the fade: the outgoing song's and the incoming one's. */
export function crossfadeGains(x: number): { out: number; in: number } {
  const t = Math.min(1, Math.max(0, x));
  return { out: Math.cos((t * Math.PI) / 2), in: Math.sin((t * Math.PI) / 2) };
}
