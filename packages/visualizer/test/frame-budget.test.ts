import { expect, test } from 'bun:test';
import { frameBudget } from '../web/frame-budget';

test('sustained misses at minimum resolution request 30 FPS before disabling a slow device', () => {
  const governor = frameBudget();
  const window = (seconds: number, target: number, floor: boolean, n: number) =>
    Array.from({ length: n }, () => governor.sample(seconds, target, floor)).filter(decision => decision !== 'keep');
  expect(window(.0625, 1 / 60, false, 160)).toEqual([]);
  expect(window(.03125, 1 / 60, true, 128)).toEqual(['limit30']);
  expect(window(1 / 30, 1 / 30, true, 180)).toEqual([]);
  expect(window(.0625, 1 / 30, true, 64)).toEqual(['disable']);
});

test('resuming after a pause and isolated long frames do not count as sustained misses', () => {
  const governor = frameBudget();
  for (let i = 0; i < 32; i++) expect(governor.sample(.0625, 1 / 30, true)).toBe('keep');
  governor.reset();
  for (let i = 0; i < 200; i++) expect(governor.sample(i === 10 ? 18 : 1 / 30, 1 / 30, true)).toBe('keep');
});
