import { expect, test } from 'bun:test';
import { gaplessPartFrames } from '../../packages/protocol/fixtures/media';
import { gaplessSignal } from '../scripts/make-gapless-media';
import { measureJoins } from '../scripts/measure-gapless';

// The gapless measurement finds what a player inserted or lost at each join of the test album.
const reference = Float32Array.from(gaplessSignal(), value => value / 32768);
const joins = gaplessPartFrames.slice(0, 3).map((_, i) => gaplessPartFrames.slice(0, i + 1).reduce((sum, frames) => sum + frames, 0));

test('a seamless recording measures no gap at any join, wherever it starts', () => {
  const recording = new Float32Array(reference.length + 5000);
  recording.set(reference, 3210);
  const measured = measureJoins(recording, reference);
  expect(measured.map(join => Math.round(join.gapSamples) + 0)).toEqual([0, 0, 0]);
  expect(measured.every(join => join.silenceMs < 0.5)).toBe(true);
});

test('inserted silence and lost samples are measured to the sample', () => {
  const pieces = [reference.subarray(0, joins[0]), reference.subarray(joins[0], joins[1]), new Float32Array(37),
    reference.subarray(joins[1], joins[2] - 200), reference.subarray(joins[2])];
  const recording = new Float32Array(1000 + pieces.reduce((sum, piece) => sum + piece.length, 0));
  let at = 1000;
  for (const piece of pieces) { recording.set(piece, at); at += piece.length; }
  const measured = measureJoins(recording, reference);
  expect(measured.map(join => Math.round(join.gapSamples) + 0)).toEqual([0, 37, -200]);
  expect(measured[1]!.silenceMs).toBeGreaterThan(0.8);
  // A cut mid-signal is a click: far above the (here perfect) signal match around it.
  expect(measured[2]!.peakResidualDb).toBeGreaterThan(measured[2]!.baselineResidualDb + 40);
});
