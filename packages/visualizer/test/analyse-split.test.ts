import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error plain JS runtime module
import { vizReduce, vizInterpret } from '../runtime/analyse-split.js';

// Loads framework/10_audio.js on its own and returns its analysis state and analyse().
function loadAudio() {
  const src = fs.readFileSync(path.join(import.meta.dir, '../framework/10_audio.js'), 'utf8');
  const make = new Function('location', 'URLSearchParams', 'window', src + '\n;return { A, analyse, BANDS, WAVE };');
  return make({ search: '?mute' }, URLSearchParams, {});
}
// A deterministic stand-in for music: a kick every 0.48 s, a snare on the off-beat, a moving melody.
function frameInput(t: number, rnd: () => number) {
  const freq = new Float32Array(2048), time = new Float32Array(4096);
  const beat = (t / 0.48) % 1, kick = Math.exp(-beat * 14), snare = Math.exp(-((beat + 0.5) % 1) * 18), note = 300 + 200 * Math.sin(t * 0.7);
  for (let i = 0; i < 2048; i++) freq[i] = -85 + 35 * Math.exp(-i / 260) + (i < 30 ? 32 * kick : 0) + (i > 80 && i < 500 ? 20 * snare : 0) + 18 * Math.exp(-((i - note) ** 2) / 50) + 4 * rnd();
  for (let i = 0; i < 4096; i++) time[i] = 0.5 * Math.sin(i * 0.031 + t * 50) * (0.4 + kick) + 0.05 * (rnd() - 0.5);
  return { freq, time };
}

describe('analysis split for no-JIT hosts', () => {
  test('reduce + interpret reproduce analyse() exactly over 20 s of varying frame times', () => {
    const ref = loadAudio(), cut = loadAudio();
    let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let cur: { freq: Float32Array; time: Float32Array } = { freq: new Float32Array(2048), time: new Float32Array(4096) };
    const analyser = { minDecibels: -92, maxDecibels: -18, getFloatFrequencyData: (a: Float32Array) => a.set(cur.freq), getFloatTimeDomainData: (a: Float32Array) => a.set(cur.time) };
    for (const S of [ref, cut]) {
      S.A.analyser = analyser; S.A.freq = new Float32Array(2048); S.A.time = new Float32Array(4096); S.A.binOf = new Array(S.BANDS + 1);
      for (let i = 0; i <= S.BANDS; i++) S.A.binOf[i] = Math.min(2047, Math.max(1, Math.round(28 * Math.pow(16000 / 28, i / S.BANDS) / 24000 * 2048)));
    }
    const bandDb = new Float32Array(ref.BANDS), wave = new Float32Array(ref.WAVE);
    let t = 0, kicks = 0;
    for (let f = 0; f < 1200; f++) {
      const dt = [1 / 60, 1 / 30, 1 / 120, 0.05][f % 7 === 0 ? 1 : f % 11 === 0 ? 2 : f % 97 === 0 ? 3 : 0];
      t += dt; cur = frameInput(t, rnd);
      ref.analyse(dt);
      vizReduce(cur.freq, cur.time, cut.A.binOf, cut.BANDS, bandDb, wave);
      vizInterpret(cut.A, dt, bandDb, wave, -92, 74);
      kicks = ref.A.beat;
    }
    for (const k of ['bass', 'mid', 'high', 'level', 'bassS', 'levelS', 'kick', 'kickL', 'snare', 'dyn', 'drop', 'accent', 'agc', 'beat', 'snares', 'notes', 'hats', 'noteBand'])
      expect(cut.A[k]).toBe(ref.A[k]);
    for (const k of ['bands', 'bandsS', 'bandsM', 'pulse', 'histRow', 'slowRow', 'specU8'])
      expect(Array.from(cut.A[k] as ArrayLike<number>)).toEqual(Array.from(ref.A[k] as ArrayLike<number>));
    // The waveform crosses the native boundary as float32, so it agrees to float32 precision, not bit for bit.
    const dw = Math.max(...Array.from(cut.A.wave as Float32Array, (v, i) => Math.abs(v - ref.A.wave[i])));
    const du8 = Math.max(...Array.from(cut.A.waveU8 as Uint8Array, (v, i) => Math.abs(v - ref.A.waveU8[i])));
    expect(dw).toBeLessThan(1e-6); expect(du8).toBeLessThanOrEqual(1);
    expect(kicks).toBeGreaterThan(20);
  });
});
