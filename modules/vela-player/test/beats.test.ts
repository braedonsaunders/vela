import { expect, test } from 'bun:test';
import { alignCrossfade, HOP_SECONDS, OnsetEnvelope, phase, tempo } from '../web/gapless/beats';

const RATE = 44_100;

/** A click track: a short decaying burst every beat from `offset`, over a quiet bed, with a little noise. */
function clicks(bpm: number, offset: number, seconds: number, seed = 1): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let r = seed;
  const noise = () => { r = (r * 16807) % 2147483647; return (r / 2147483647) * 2 - 1; };
  for (let i = 0; i < out.length; i++) out[i] = 0.01 * noise();
  for (let t = offset; t < seconds; t += 60 / bpm) {
    const at = Math.round(t * RATE);
    for (let i = 0; i < 0.03 * RATE && at + i < out.length; i++) out[at + i]! += 0.8 * Math.exp(-i / (0.006 * RATE)) * noise();
  }
  return out;
}

function envelope(samples: Float32Array, start = 0): OnsetEnvelope {
  const env = new OnsetEnvelope(start);
  // Fed in decoder-sized chunks, as the player does.
  for (let i = 0; i < samples.length; i += 4096) env.push([samples.subarray(i, i + 4096)], Math.min(4096, samples.length - i), RATE);
  return env;
}

test('the tempo of a click track is found within half a BPM', () => {
  for (const bpm of [80, 100, 120, 128, 150, 174]) {
    const found = tempo(envelope(clicks(bpm, 0.2, 12)).values);
    expect(60 / found.period).toBeGreaterThan(bpm - 0.5);
    expect(60 / found.period).toBeLessThan(bpm + 0.5);
    expect(found.confidence).toBeGreaterThan(0.15);
  }
});

test('silence and noise have no tempo to speak of', () => {
  expect(tempo(new OnsetEnvelope().values)).toEqual({ period: 0, confidence: 0 });
  const noise = new Float32Array(RATE * 10);
  let r = 7;
  for (let i = 0; i < noise.length; i++) { r = (r * 16807) % 2147483647; noise[i] = 0.3 * ((r / 2147483647) * 2 - 1); }
  expect(tempo(envelope(noise).values).confidence).toBeLessThan(0.15);
});

test('the beat phase is found within two hops', () => {
  const values = envelope(clicks(120, 0.137, 10)).values;
  const found = phase(values, 0.5);
  expect(Math.abs(found - 0.137)).toBeLessThan(2 * HOP_SECONDS);
});

test('a crossfade start moves by under half a beat so the incoming first beat lands on an outgoing beat', () => {
  // Outgoing beats at 0.1 + k·0.5 s (120 BPM); its window is 180 to 192 s of the track.
  const out = envelope(clicks(120, 0.1, 12), 180);
  // Incoming: 120 BPM with its first beat 0.31 s after its start (from 0).
  const inc = envelope(clicks(120, 0.31, 10, 3), 0);
  const aligned = alignCrossfade({ at: 192, outgoing: out.window(180, 192), incoming: { ...inc.window(0, 10), from: 0 } });
  // Lands at 192.31 unaligned; the nearest outgoing beat is 192.1 (180.1 + 24 beats): moved by −0.21 s.
  expect(aligned.shift).toBeCloseTo(-0.21, 1);
  expect(Math.abs(aligned.at + 0.31 - 192.1)).toBeLessThan(2.5 * HOP_SECONDS);
  expect(aligned.bpm).toBeCloseTo(120, 0);
});

test('nothing moves when the tempos disagree or are not found', () => {
  const out = envelope(clicks(120, 0.1, 12), 180);
  const fast = envelope(clicks(140, 0.2, 10, 5));
  expect(alignCrossfade({ at: 192, outgoing: out.window(180, 192), incoming: { ...fast.window(0, 10), from: 0 } })).toEqual({ at: 192, shift: 0, bpm: 0 });
  const quiet = new OnsetEnvelope();
  quiet.push([new Float32Array(RATE * 10)], RATE * 10, RATE);
  expect(alignCrossfade({ at: 192, outgoing: out.window(180, 192), incoming: { values: quiet.values, start: 0, from: 0 } }).shift).toBe(0);
});
