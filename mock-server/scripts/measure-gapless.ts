// Measures a recording of the gapless test album (make-gapless-media.ts) played through a player: at
// each join between parts, how many samples were inserted (a gap, positive) or lost (negative), the
// longest silence near it, and the worst disturbance (a click) against the coding noise around it.
// The recording is lined up with the reference signal by cross-correlation (the signal's noise floor
// makes the match unambiguous) just before and just after each join; the difference is the gap.
// Usage: bun mock-server/scripts/measure-gapless.ts <recording.wav> [reference.wav] [--parts 1,2,3,4]
// The recording must start at the first part (or earlier); later parts may be a subset (--parts).
import { join } from 'node:path';
import { GAPLESS_RATE, gaplessPartFrames } from '../../packages/protocol/fixtures/media';
import { musicRoot } from '../media-kinds';

/** Channel 0 of a WAV file (PCM 16/24/32-bit or float 32), with its sample rate. */
export function readWav(bytes: Uint8Array): { rate: number; samples: Float32Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let at = 12, format = 0, channels = 0, rate = 0, bits = 0;
  while (at + 8 <= bytes.length) {
    const id = tag(at), size = view.getUint32(at + 4, true), body = at + 8;
    if (id === 'fmt ') {
      format = view.getUint16(body, true); channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true); bits = view.getUint16(body + 14, true);
      if (format === 0xfffe) format = view.getUint16(body + 24, true);
    } else if (id === 'data') {
      const width = bits / 8, frames = Math.floor(Math.min(size, bytes.length - body) / (width * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const p = body + i * width * channels;
        samples[i] = format === 3 ? view.getFloat32(p, true)
          : bits === 16 ? view.getInt16(p, true) / 32768
          : bits === 24 ? ((view.getUint8(p) | view.getUint8(p + 1) << 8 | view.getInt8(p + 2) << 16) / 8388608)
          : view.getInt32(p, true) / 2147483648;
      }
      return { rate, samples };
    }
    at = body + size + (size & 1);
  }
  throw new Error('WAV file has no data');
}

/** In-place radix-2 FFT (re, im of a power-of-two length); `inverse` scales by 1/n. */
function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k++) {
        const wr = Math.cos(angle * k), wi = Math.sin(angle * k);
        const a = start + k, b = a + size / 2;
        const tr = re[b]! * wr - im[b]! * wi, ti = re[b]! * wi + im[b]! * wr;
        re[b] = re[a]! - tr; im[b] = im[a]! - ti; re[a] = re[a]! + tr; im[a] = im[a]! + ti;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] = re[i]! / n; im[i] = im[i]! / n; }
}

/**
 * Where `pattern` (reference samples) sits in `recording`, searching recording positions
 * [from, from + span): the best match's position (sub-sample, parabolic) and its normalised score.
 */
export function locate(recording: Float32Array, pattern: Float32Array, from: number, span: number): { at: number; score: number } {
  const start = Math.max(0, from), end = Math.min(recording.length, from + span + pattern.length);
  const window = recording.subarray(start, end);
  let n = 1; while (n < window.length + pattern.length) n <<= 1;
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
  window.forEach((v, i) => { ar[i] = v; });
  pattern.forEach((v, i) => { br[i] = v; });
  fft(ar, ai); fft(br, bi);
  for (let i = 0; i < n; i++) { const r = ar[i]! * br[i]! + ai[i]! * bi[i]!, m = ai[i]! * br[i]! - ar[i]! * bi[i]!; ar[i] = r; ai[i] = m; }
  fft(ar, ai, true);
  let best = 0, bestValue = -Infinity;
  const last = Math.max(0, window.length - pattern.length);
  for (let lag = 0; lag <= last; lag++) if (ar[lag]! > bestValue) { bestValue = ar[lag]!; best = lag; }
  const y0 = ar[best - 1] ?? bestValue, y2 = ar[best + 1] ?? bestValue, curve = y0 - 2 * bestValue + y2;
  const fraction = curve < 0 ? (y0 - y2) / (2 * curve) : 0;
  let pe = 0, we = 0;
  for (let i = 0; i < pattern.length; i++) { pe += pattern[i]! ** 2; we += (window[best + i] ?? 0) ** 2; }
  return { at: start + best + fraction, score: bestValue / Math.sqrt(pe * we || 1) };
}

export interface JoinMeasure {
  /** The join, in reference samples from the start of the signal. */
  at: number;
  /** Samples inserted (positive) or lost (negative) at the join. */
  gapSamples: number;
  /** The longest run of near silence within 300 ms of the join, in ms. */
  silenceMs: number;
  /** The worst 1 ms disturbance within 20 ms of the join, and the coding noise around it, in dB below the signal. */
  peakResidualDb: number;
  baselineResidualDb: number;
  /** How well the recording matched the signal before and after (1 = exactly). */
  scores: [number, number];
}

/** A second difference: the sweep's tone (under 1 kHz) all but vanishes and the noise floor, whose
 * match is unambiguous, remains. Lossy coders keep that floor too weak to win a match on its own. */
function whiten(samples: Float32Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 2; i < samples.length; i++) out[i] = samples[i]! - 2 * samples[i - 1]! + samples[i - 2]!;
  return out;
}

/** Measures every join of a recording of `parts` (1-based part numbers, played in that order). */
export function measureJoins(recording: Float32Array, reference: Float32Array, parts = [1, 2, 3, 4], rate = GAPLESS_RATE): JoinMeasure[] {
  const heard = whiten(recording), signal = whiten(reference);
  const starts = gaplessPartFrames.map((_, i) => gaplessPartFrames.slice(0, i).reduce((sum, frames) => sum + frames, 0));
  const window = Math.round(0.3 * rate), guard = Math.round(0.01 * rate), search = Math.round(1.5 * rate);
  // Where the first part's opening sits in the recording.
  const first = starts[parts[0]! - 1]!;
  const opening = locate(heard, signal.subarray(first + guard, first + guard + window), 0, Math.min(recording.length, 30 * rate));
  let offset = opening.at - guard; // recording position of the first part's first sample
  let played = 0;
  const joins: JoinMeasure[] = [];
  for (let k = 0; k + 1 < parts.length; k++) {
    const part = parts[k]! - 1, nextPart = parts[k + 1]! - 1;
    played += gaplessPartFrames[part]!;
    const end = starts[part]! + gaplessPartFrames[part]!, begin = starts[nextPart]!;
    const expected = offset + played; // where the join sits in the recording if nothing was gained or lost
    const before = locate(heard, signal.subarray(end - guard - window, end - guard), Math.round(expected - guard - window - search / 2), search);
    const after = locate(heard, signal.subarray(begin + guard, begin + guard + window), Math.round(expected + guard - search / 2), search);
    const joinBefore = before.at + window + guard; // where the part ended in the recording
    const joinAfter = after.at - guard; // where the next part began
    const gap = joinAfter - joinBefore;
    // Silence: the signal never rests (its noise floor alone is above 0.003).
    let silence = 0, run = 0;
    for (let i = Math.max(0, Math.round(joinBefore - 0.3 * rate)); i < Math.min(recording.length, joinAfter + 0.3 * rate); i++) {
      run = Math.abs(recording[i]!) < 0.003 ? run + 1 : 0;
      silence = Math.max(silence, run);
    }
    // Disturbance: the recording minus the signal, each side lined up on its own, in 1 ms blocks.
    const block = Math.round(rate / 1000);
    const residual = (from: number, to: number) => {
      const out: number[] = [];
      for (let b = from; b + block <= to; b += block) {
        let err = 0, sig = 0;
        for (let i = b; i < b + block; i++) {
          const beforeJoin = i < (joinBefore + joinAfter) / 2;
          const ref = beforeJoin ? reference[Math.round(end - (joinBefore - i))] : reference[Math.round(begin + (i - joinAfter))];
          err += (recording[i]! - (ref ?? 0)) ** 2; sig += (ref ?? 0) ** 2;
        }
        out.push(10 * Math.log10((err + 1e-12) / (sig + 1e-12)));
      }
      return out;
    };
    const near = residual(Math.round(joinBefore - 0.02 * rate), Math.round(joinAfter + 0.02 * rate));
    const around = [...residual(Math.round(joinBefore - 0.25 * rate), Math.round(joinBefore - 0.03 * rate)),
      ...residual(Math.round(joinAfter + 0.03 * rate), Math.round(joinAfter + 0.25 * rate))].sort((a, b) => a - b);
    joins.push({ at: end, gapSamples: gap, silenceMs: silence / rate * 1000, peakResidualDb: Math.max(...near), baselineResidualDb: around[Math.floor(around.length / 2)] ?? 0,
      scores: [before.score, after.score] });
    offset += gap;
  }
  return joins;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = args.indexOf('--parts');
  const parts = flag >= 0 ? args[flag + 1]!.split(',').map(Number) : [1, 2, 3, 4];
  const files = args.filter((arg, i) => !arg.startsWith('--') && (flag < 0 || i !== flag + 1));
  const recording = readWav(new Uint8Array(await Bun.file(files[0]!).arrayBuffer()));
  const reference = readWav(new Uint8Array(await Bun.file(files[1] ?? join(musicRoot, 'gapless-sweep-reference.wav')).arrayBuffer()));
  if (recording.rate !== reference.rate) throw new Error(`The recording is ${recording.rate} Hz; the signal is ${reference.rate} Hz`);
  for (const [i, join] of measureJoins(recording.samples, reference.samples, parts, recording.rate).entries()) {
    console.log(`join ${parts[i]}→${parts[i + 1]}: gap ${join.gapSamples.toFixed(2)} samples (${(join.gapSamples / recording.rate * 1000).toFixed(3)} ms), ` +
      `silence ${join.silenceMs.toFixed(2)} ms, peak disturbance ${join.peakResidualDb.toFixed(1)} dB vs coding noise ${join.baselineResidualDb.toFixed(1)} dB, ` +
      `match ${join.scores.map(s => s.toFixed(3)).join('/')}`);
  }
}
