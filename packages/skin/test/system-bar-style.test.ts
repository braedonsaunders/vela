import { expect, test } from 'bun:test';
import { systemBarStyle } from '../../../apps/vela/src/system-bar-style';

test('light skins get readable dark system icons, including signed Android colours', () => {
  expect(systemBarStyle(0xffffffff)).toBe('dark');
  expect(systemBarStyle(0xfffff0f6 | 0)).toBe('dark');
  expect(systemBarStyle(0xfff4f1e8 | 0)).toBe('dark');
});

test('dark skins and an unavailable page colour keep light system icons', () => {
  expect(systemBarStyle(0xff000000)).toBe('light');
  expect(systemBarStyle(0xff090b0e)).toBe('light');
  expect(systemBarStyle(undefined)).toBe('light');
});
