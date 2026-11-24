// Analyse sound captures (tools/sound-measure/README.md) against the measurement spec: levelling gain,
// the per-item gain switch at a gapless join, the EQ's frequency response and the crossfade's start,
// overlap and power, and beat alignment. Captures are mono float32 (`<case>.f32`, or 16/32-bit WAV, first
// channel) at the rate in `<case>.json` or the WAV header.
// Usage: bun tools/sound-measure/analyse.ts <captures dir> <platform name> [out dir]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chainResponseDb, eqChain } from '../../packages/core/src/audio/eq';
import { DEFAULT_SOUND, EQ_BANDS_HZ, withPreset } from '../../packages/core/src/audio/sound';

const [dir, platform = 'web', outDir = dir] = process.argv.slice(2);
if (!dir) { console.error('usage: bun tools/sound-measure/analyse.ts <captures dir> <platform> [out dir]'); process.exit(2); }

interface Capture { x: Float32Array; rate: number }

function load(name: string): Capture | null {
  const f32 = join(dir!, `${name}.f32`), wav = join(dir!, `${name}.wav`);
  if (existsSync(f32)) {
    const meta = existsSync(join(dir!, `${name}.json`)) ? JSON.parse(readFileSync(join(dir!, `${name}.json`), 'utf8')) : {};
    const bytes = readFileSync(f32);
    return { x: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4), rate: meta.rate ?? 48_000 };
  }
  if (existsSync(wav)) return readWav(readFileSync(wav));
  return null;
}

/** The first channel of a PCM WAV (16-bit integer or 32-bit float). */
function readWav(buf: Buffer): Capture {
  let at = 12, rate = 48_000, channels = 1, bits = 16, format = 1;
  while (at < buf.length) {
    const id = buf.toString('ascii', at, at + 4), size = buf.readUInt32LE(at + 4);
    if (id === 'fmt ') { format = buf.readUInt16LE(at + 8); channels = buf.readUInt16LE(at + 10); rate = buf.readUInt32LE(at + 12); bits = buf.readUInt16LE(at + 22); }
    if (id === 'data') {
      const step = (bits / 8) * channels, frames = Math.floor(size / step), x = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        const o = at + 8 + i * step;
        x[i] = format === 3 || bits === 32 ? buf.readFloatLE(o) : buf.readInt16LE(o) / 32768;
      }
      return { x, rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

const db = (ratio: number) => 20 * Math.log10(ratio);
const round = (v: number, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
/** The first sample louder than `threshold`. */
const onset = (x: Float32Array, threshold = 1e-4) => { for (let i = 0; i < x.length; i++) if (Math.abs(x[i]!) > threshold) return i; return -1; };
const rms = (x: Float32Array, from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += x[i]! * x[i]!; return Math.sqrt(s / (to - from)); };

interface Row { case: string; expected: string; measured: string; error: string; pass: boolean }
const tables: Record<string, Row[]> = {};
const raw: Record<string, unknown> = {};
const row = (table: string, r: Row) => { (tables[table] ??= []).push(r); };

// M1: levelling gain, steady state, against the signal's own level (0.1 amplitude: RMS 0.1/√2).
for (const [name, gain] of [['m1-unity', 1], ['m1-half', 0.5], ['m1-double', 2]] as const) {
  const c = load(name);
  if (!c) continue;
  const s0 = onset(c.x);
  const level = rms(c.x, s0 + 2 * c.rate, s0 + 8 * c.rate) / (0.1 / Math.SQRT2);
  const error = db(level) - db(gain);
  raw[name] = { onset: s0, levelDb: db(level) };
  row('M1 levelling gain', { case: `gain ${gain}`, expected: `${round(db(gain), 2)} dB`, measured: `${round(db(level), 3)} dB`, error: `${round(error, 3)} dB`, pass: Math.abs(error) <= 0.05 });
}

// M2: the gain switch at a gapless join, in samples from the boundary.
{
  const c = load('m2-boundary');
  if (c) {
    const s0 = onset(c.x, 1e-3);
    // The tone is a cosine from its first sample, so its onset is item 1's first sample and the
    // boundary (item 2's first sample) is 10 s later, at a peak. Its phase and level from item 1's
    // first second (least squares on sin/cos at 1 kHz).
    const w = (2 * Math.PI * 1000) / c.rate;
    let ss = 0, sc = 0, cc = 0, xs = 0, xc = 0;
    for (let n = s0 + 100; n < s0 + c.rate; n++) { const t = n - s0, si = Math.sin(w * t), co = Math.cos(w * t); ss += si * si; sc += si * co; cc += co * co; xs += c.x[n]! * si; xc += c.x[n]! * co; }
    const det = ss * cc - sc * sc, a = (xs * cc - xc * sc) / det, b = (xc * ss - xs * sc) / det;
    const ref = (n: number) => a * Math.sin(w * (n - s0)) + b * Math.cos(w * (n - s0));
    const amp = Math.hypot(a, b);
    const boundary = s0 + 10 * c.rate;
    let lastLow = -1, firstHigh = -1;
    for (let n = boundary - 2000; n < boundary + 2000; n++) {
      const r = ref(n);
      if (Math.abs(r) < 0.3 * amp) continue;
      const ratio = c.x[n]! / r;
      if (ratio < 1.5 && firstHigh < 0) lastLow = n;
      if (ratio >= 1.5 && firstHigh < 0) firstHigh = n;
    }
    raw['m2-boundary'] = { onset: s0, boundary, lastLow, firstHigh, amplitude: amp };
    const offset = firstHigh - boundary;
    // The switch lies between the last low sample and the first high one (samples near the zero crossings are skipped).
    row('M2 gain switch at a gapless join', { case: 'gain 0.5 → 1.0', expected: '0 samples', measured: `between ${lastLow - boundary} and ${offset} samples`, error: `${lastLow - boundary >= 0 ? lastLow - boundary : 0}…${offset}`, pass: lastLow < boundary && firstHigh >= boundary && offset <= 12 });
  }
}

// M3: EQ response: the same noise samples with and without the EQ (aligned by onset), Welch spectra,
// 1/6-octave bands.
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j]!, re[i]!]; [im[i], im[j]] = [im[j]!, im[i]!]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2]! * cr - im[i + k + len / 2]! * ci, ai = re[i + k + len / 2]! * ci + im[i + k + len / 2]! * cr;
        re[i + k + len / 2] = re[i + k]! - ar; im[i + k + len / 2] = im[i + k]! - ai; re[i + k]! += ar; im[i + k]! += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function welch(x: Float32Array, from: number, length: number, size = 65_536): Float64Array {
  const power = new Float64Array(size / 2);
  const hann = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  for (let start = from; start + size <= from + length; start += size / 2) {
    const re = new Float64Array(size), im = new Float64Array(size);
    for (let i = 0; i < size; i++) re[i] = (x[start + i] ?? 0) * hann[i]!;
    fft(re, im);
    for (let k = 0; k < size / 2; k++) power[k]! += re[k]! * re[k]! + im[k]! * im[k]!;
  }
  return power;
}
{
  const off = load('m3-off');
  if (off) {
    const size = 65_536, rate = off.rate, from = onset(off.x) + Math.round(0.5 * rate), length = Math.round(9.5 * rate);
    const base = welch(off.x, from, length, size);
    const frequencies = [...EQ_BANDS_HZ, 100, 3000, 12_000].sort((a, b) => a - b);
    for (const preset of ['rock', 'bassBoost', 'vocal']) {
      const c = load(`m3-${preset}`);
      if (!c) continue;
      const shaped = welch(c.x, onset(c.x) + Math.round(0.5 * rate), length, size);
      const chain = eqChain(withPreset(DEFAULT_SOUND, preset).eq);
      const measured: Record<number, number> = {};
      for (const f of frequencies) {
        const lo = Math.max(1, Math.floor((f / 2 ** (1 / 12)) * size / rate)), hi = Math.ceil((f * 2 ** (1 / 12)) * size / rate);
        let a = 0, b = 0;
        for (let k = lo; k <= hi; k++) { a += shaped[k]!; b += base[k]!; }
        // The expected response is averaged over the same bins (power), as the measurement is.
        let e = 0;
        for (let k = lo; k <= hi; k++) e += 10 ** (chainResponseDb(chain, (k * rate) / size, rate) / 10) * base[k]!;
        const expected = 10 * Math.log10(e / b), got = 10 * Math.log10(a / b), error = got - expected;
        measured[f] = got;
        const limit = f >= 16_000 ? 1 : 0.5;
        row(`M3 EQ response (${preset})`, { case: `${f} Hz`, expected: `${round(expected, 2)} dB`, measured: `${round(got, 2)} dB`, error: `${round(error, 3)} dB`, pass: Math.abs(error) <= limit });
      }
      raw[`m3-${preset}`] = measured;
    }
  }
}

// M4 and M5: tone envelopes by a sliding Blackman-Harris Goertzel (20 ms windows, 10 ms apart).
function envelope(x: Float32Array, rate: number, frequency: number, from: number, to: number): { t: number; a: number }[] {
  const size = Math.round(0.02 * rate), hop = Math.round(0.01 * rate), out: { t: number; a: number }[] = [];
  const win = Float64Array.from({ length: size }, (_, i) => { const p = (2 * Math.PI * i) / (size - 1); return 0.35875 - 0.48829 * Math.cos(p) + 0.14128 * Math.cos(2 * p) - 0.01168 * Math.cos(3 * p); });
  const sum = win.reduce((s, v) => s + v, 0);
  const w = (2 * Math.PI * frequency) / rate;
  for (let start = Math.max(0, from); start + size <= Math.min(x.length, to); start += hop) {
    let re = 0, im = 0;
    for (let i = 0; i < size; i++) { const v = x[start + i]! * win[i]!; re += v * Math.cos(w * i); im -= v * Math.sin(w * i); }
    out.push({ t: start + size / 2, a: (2 * Math.hypot(re, im)) / sum });
  }
  return out;
}
{
  const c = load('m4-crossfade');
  if (c) {
    const rate = c.rate, s0 = onset(c.x, 1e-5);
    const from = s0 + 15 * rate, to = s0 + 28 * rate;
    const a = envelope(c.x, rate, 440, from, to), b = envelope(c.x, rate, 660, from, to);
    const floor = 0.25 * 10 ** (-60 / 20);
    const tIn = b.find(p => p.a > floor)?.t ?? NaN;
    const tOut = [...a].reverse().find(p => p.a > floor)?.t ?? NaN;
    const start = (tIn - s0) / rate, overlap = (tOut - tIn) / rate;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < a.length; i++) {
      if (a[i]!.t < tIn + 0.05 * rate || a[i]!.t > tOut - 0.05 * rate) continue;
      const p = 10 * Math.log10((a[i]!.a ** 2 + b[i]!.a ** 2) / 0.25 ** 2);
      lo = Math.min(lo, p); hi = Math.max(hi, p);
    }
    raw['m4-crossfade'] = { onset: s0, start, overlap, powerDb: [lo, hi] };
    row('M4 crossfade', { case: 'start', expected: '20.000 s', measured: `${round(start, 3)} s`, error: `${round((start - 20) * 1000, 1)} ms`, pass: Math.abs(start - 20) <= 0.02 });
    row('M4 crossfade', { case: 'overlap', expected: '6.000 s', measured: `${round(overlap, 3)} s`, error: `${round((overlap - 6) * 1000, 1)} ms`, pass: Math.abs(overlap - 6) <= 0.05 });
    row('M4 crossfade', { case: 'equal power across the fade', expected: '0 dB', measured: `${round(lo, 2)} … ${round(hi, 2)} dB`, error: `${round(Math.max(Math.abs(lo), Math.abs(hi)), 2)} dB`, pass: Math.abs(lo) <= 0.5 && Math.abs(hi) <= 0.5 });
  }
}
{
  const c = load('m5-beats');
  const meta = existsSync(join(dir, 'm5-beats.json')) ? JSON.parse(readFileSync(join(dir, 'm5-beats.json'), 'utf8')) : {};
  if (c) {
    const rate = c.rate;
    // The outgoing track's first click is at 0.10 s: its start is 0.10 s before the first sound.
    const trackStart = onset(c.x, 0.01) - Math.round(0.1 * rate);
    const b = envelope(c.x, rate, 1200, trackStart + 19 * rate, trackStart + 23 * rate);
    const peak = Math.max(...b.map(p => p.a));
    const firstClick = b.find(p => p.a > peak * 0.5)!.t;
    // Its click's envelope peaks ~a window after the click: measure against the outgoing beats the same way.
    const a = envelope(c.x, rate, 1800, trackStart + 0.05 * rate, trackStart + 0.6 * rate);
    const aPeak = Math.max(...a.map(p => p.a));
    const aFirst = a.find(p => p.a > aPeak * 0.5)!.t;
    const lag = aFirst - (trackStart + 0.1 * rate);
    const clickAt = (firstClick - lag - trackStart) / rate;
    const nearest = 0.1 + Math.round((clickAt - 0.1) / 0.5) * 0.5;
    const residual = clickAt - nearest;
    const unaligned = 20.2 + 0.31;
    raw['m5-beats'] = { trackStart, clickAt, nearest, residual, diagnostics: meta.diagnostics };
    row('M5 beat alignment (web)', { case: 'incoming first beat vs nearest outgoing beat', expected: '0 ms (unaligned it would be ' + round((unaligned - (0.1 + Math.round((unaligned - 0.1) / 0.5) * 0.5)) * 1000, 0) + ' ms)', measured: `${round(residual * 1000, 1)} ms (moved ${round((meta.diagnostics?.crossfade?.shift ?? 0) * 1000, 1)} ms, ${round(meta.diagnostics?.crossfade?.bpm ?? 0, 1)} BPM found)`, error: `${round(residual * 1000, 1)} ms`, pass: Math.abs(residual) <= 0.012 });
  }
}

let md = `# Sound measurements: ${platform}\n\nCaptured from the engine's processed output (before the device), against tools/sound-measure's signals and docs/sound.md's spec.\n`;
for (const [title, rows] of Object.entries(tables)) {
  md += `\n## ${title}\n\n| Case | Expected | Measured | Error | Pass |\n| --- | --- | --- | --- | --- |\n`;
  for (const r of rows) md += `| ${r.case} | ${r.expected} | ${r.measured} | ${r.error} | ${r.pass ? 'yes' : '**no**'} |\n`;
}
writeFileSync(join(outDir, 'results.md'), md);
writeFileSync(join(outDir, 'results.json'), JSON.stringify({ platform, tables, raw }, null, 1));
console.log(md);
