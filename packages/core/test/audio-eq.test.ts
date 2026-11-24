import { expect, test } from 'bun:test';
import { biquad, biquadResponseDb, chainResponseDb, crossfadeGains, eqChain, EQ_Q } from '../src/audio/eq';
import { DEFAULT_SOUND, EQ_BANDS_HZ, EQ_PRESETS, withPreset } from '../src/audio/sound';

const RATE = 48_000;

test('the EQ applies nothing when it is off or flat', () => {
  expect(eqChain(DEFAULT_SOUND.eq)).toBeNull();
  expect(eqChain({ ...DEFAULT_SOUND.eq, on: true })).toBeNull();
  expect(eqChain({ ...withPreset(DEFAULT_SOUND, 'rock').eq, on: false })).toBeNull();
});

test('ten filters: a low shelf, eight octave-wide peaks and a high shelf, with headroom for the largest boost', () => {
  const chain = eqChain(withPreset(DEFAULT_SOUND, 'bassBoost').eq)!;
  expect(chain.filters.map(f => f.type)).toEqual(['lowshelf', ...Array(8).fill('peaking'), 'highshelf']);
  expect(chain.filters.map(f => f.frequency)).toEqual([...EQ_BANDS_HZ]);
  expect(chain.filters.every(f => f.q === EQ_Q)).toBe(true);
  expect(chain.preGainDb).toBe(-6);
  expect(eqChain(withPreset(DEFAULT_SOUND, 'bassReducer').eq)!.preGainDb).toBe(-0);
});

test('a peaking band gives exactly its gain at its centre and none far away', () => {
  for (const gainDb of [-12, -3, 4.5, 12]) {
    const c = biquad({ type: 'peaking', frequency: 1000, q: EQ_Q, gainDb }, RATE);
    expect(biquadResponseDb(c, 1000, RATE)).toBeCloseTo(gainDb, 6);
    expect(Math.abs(biquadResponseDb(c, 20, RATE))).toBeLessThan(0.05);
    expect(Math.abs(biquadResponseDb(c, 20_000, RATE))).toBeLessThan(0.3);
  }
});

test('shelves reach their gain beyond the corner and half of it at the corner', () => {
  const low = biquad({ type: 'lowshelf', frequency: 31, q: EQ_Q, gainDb: 6 }, RATE);
  expect(biquadResponseDb(low, 1, RATE)).toBeCloseTo(6, 1);
  expect(biquadResponseDb(low, 31, RATE)).toBeCloseTo(3, 1);
  expect(Math.abs(biquadResponseDb(low, 2000, RATE))).toBeLessThan(0.05);
  const high = biquad({ type: 'highshelf', frequency: 16_000, q: EQ_Q, gainDb: -6 }, RATE);
  expect(biquadResponseDb(high, 16_000, RATE)).toBeCloseTo(-3, 1);
  expect(Math.abs(biquadResponseDb(high, 1000, RATE))).toBeLessThan(0.05);
  // A corner at or past Nyquist: the high shelf is its whole gain, the others pass.
  expect(biquadResponseDb(biquad({ type: 'highshelf', frequency: 16_000, q: EQ_Q, gainDb: -6 }, 22_050), 5000, 22_050)).toBeCloseTo(-6, 6);
});

test('a preset chain never boosts above unity, and follows its bands within a few dB', () => {
  for (const preset of EQ_PRESETS) {
    const chain = eqChain(withPreset(DEFAULT_SOUND, preset.id).eq);
    if (!chain) continue;
    let peak = -Infinity;
    for (let f = 20; f < 20_000; f *= 1.02) peak = Math.max(peak, chainResponseDb(chain, f, RATE));
    expect(peak).toBeLessThan(1.5);
    // At a middle band's centre, the band's own gain less the headroom, give or take its neighbours.
    const mid = chainResponseDb(chain, 1000, RATE);
    expect(Math.abs(mid - (preset.bands[5]! + chain.preGainDb))).toBeLessThan(4);
  }
});

test('equal-power crossfade: the two gains always sum to unit power', () => {
  for (const x of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
    const { out, in: incoming } = crossfadeGains(x);
    expect(out * out + incoming * incoming).toBeCloseTo(1, 9);
  }
  expect(crossfadeGains(0)).toEqual({ out: 1, in: 0 });
  expect(crossfadeGains(2).in).toBe(1);
});
