import { expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('react-native-reanimated', () => ({ cubicBezier: (...values: number[]) => values }));
mock.module('../src/fonts', () => ({ fontFace: (name: string) => name }));
const { boxStyle } = await import('../src/translate');
const measure = { viewport: { width: 412, height: 915, insets: { top: 0, right: 0, bottom: 0, left: 0 } }, fontSize: 16, axis: 'x' as const };

test('horizontal rows clip only the vertical axis, leaving native browser scrolling enabled', () => {
  const { style, fx } = boxStyle({ 'overflow-x': 'auto', 'overflow-y': 'hidden' }, measure);
  expect(fx.scrollX).toBe(true);
  expect(style).toMatchObject({ overflowY: 'hidden' });
  expect(style.overflow).toBeUndefined();
});

test('vertical scrollers clip only the horizontal axis; fully clipped boxes stay clipped', () => {
  const { style, fx } = boxStyle({ 'overflow-x': 'hidden', 'overflow-y': 'auto' }, measure);
  expect(fx.scrollY).toBe(true);
  expect(style).toMatchObject({ overflowX: 'hidden' });
  expect(style.overflow).toBeUndefined();
  expect(boxStyle({ overflow: 'hidden' }, measure).style.overflow).toBe('hidden');
});
