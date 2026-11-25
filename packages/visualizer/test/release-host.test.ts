import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import scenes from '../scenes.json';

// Exercise the file the Apple resource bundle and Android AssetManager actually load.
const source = readFileSync(join(import.meta.dir, '../../../modules/vela-player/ios/VisualizerAssets/viz-native.js'), 'utf8');

test('the shipped native renderer consumes private short-FFT bins at the heard frame', () => {
  let now = 0;
  const fastFreq = new Float32Array(512).fill(-Infinity);
  const errors: string[] = [];
  const host = {
    scene: 'wire', width: 320, height: 180, dpr: 1, sampleRate: 48000,
    now: () => now, commandBuffer: new ArrayBuffer(16 << 20),
    log: (message: string) => errors.push(message),
    fastFreq, bandDb: new Float32Array(256).fill(-Infinity), wave: new Float32Array(512),
    link: () => ({ok: true, uniforms: []}), flush() {},
  };
  const viz = new Function('__host', source + '\nreturn __viz;')(host);
  expect(viz.scenes.map((s: {id: string}) => s.id)).toEqual(scenes.map(s => s.id));
  const counts = () => viz.state().hit.map((lane: {n: number}) => lane.n);
  for (const [lane, bin] of [2, 20, 150].entries()) {
    for (let i = 0; i < 20; i++) viz.frame(now += 16);
    fastFreq[bin] = -1;
    viz.frame(now += 16);
    expect(counts()).toEqual([0, 1, 2].map(index => Number(index <= lane)));
    expect(viz.state().hitFast[lane]).toBeGreaterThan(0);
    expect(viz.state().hitSlow[lane]).toBeGreaterThan(0);
    fastFreq[bin] = -Infinity;
  }
  // At 8 kHz the 5–14 kHz band is entirely above Nyquist. Energy in the
  // highest available bin cannot trigger a high onset.
  viz.audioFormat(8000);
  for (let i = 0; i < 20; i++) viz.frame(now += 16);
  fastFreq[511] = -1;
  viz.frame(now += 16);
  expect(counts()).toEqual([1, 1, 1]);
  expect(viz.stats().broken).toEqual([]);
  expect(errors).toEqual([]);
});
