import { expect, test } from 'bun:test';
import { entryBudget, frameBudget, softwareRenderer } from '../web/frame-budget';

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

test('foreground GPU entry tolerates a cold miss and disables consistently slow starts', () => {
  const missed = entryBudget();
  expect(missed(550)).toBe(false);
  expect(missed(225)).toBe(false);
  expect(missed(500)).toBe(false);
  expect(missed(525)).toBe(true);
  expect(entryBudget()(1700)).toBe(true);
});

test('known software adapters are recognized while hardware and privacy-masked names stay eligible', () => {
  expect(softwareRenderer('ANGLE (Google, Vulkan 1.3 (SwiftShader Device (Subzero)))')).toBe(true);
  expect(softwareRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)')).toBe(true);
  expect(softwareRenderer('llvmpipe (LLVM 19.1.7, 256 bits)')).toBe(true);
  expect(softwareRenderer('ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11)')).toBe(false);
  expect(softwareRenderer('WebKit WebGL')).toBe(false);
});
