import { expect, test } from 'bun:test';
import { needsAnimatedFrame } from '../src/animated-frame';
import type { RNode } from '../src/resolve';

const node = (extra: Partial<RNode> = {}): RNode => ({ kind: 'text', text: 'hello', base: { style: { color: 'red' } },
  when: [], states: [], group: false, order: 0, ...extra } as RNode);

test('static transforms and image fades do not require a Reanimated frame', () => {
  expect(needsAnimatedFrame(node({ base: { style: { transform: 'scale(1.1)' } } }))).toBe(false);
  expect(needsAnimatedFrame(node({ kind: 'image', fade: true }))).toBe(false);
});

test('motion and transitions in every possible look keep one animated component', () => {
  expect(needsAnimatedFrame(node({ motion: { keyframes: 'fadeIn', duration: 200 } }))).toBe(true);
  for (const key of ['style', 'hover', 'focus', 'groupHover', 'groupFocus']) {
    expect(needsAnimatedFrame(node({ base: { style: {}, [key]: { transition: 'opacity 200ms' } } }))).toBe(true);
    expect(needsAnimatedFrame(node({ states: [{ when: [], layer: { style: {}, [key]: { transition: 'opacity 200ms' } } }] }))).toBe(true);
  }
  expect(needsAnimatedFrame(node({ active: { transition: 'opacity 200ms' } }))).toBe(true);
  expect(needsAnimatedFrame(node({ disabledStyle: { transition: 'opacity 200ms' } }))).toBe(true);
});
