import { expect, test } from 'bun:test';
import { focusStyle } from '../src/focus-style';

test('focus has a paired inset ring and preserves the control transform', () => {
  const transform = [{ translateY: -2 }];
  const focused = focusStyle(transform);
  expect(focused.outlineColor).toBe('#ffffff');
  expect(focused.outlineWidth).toBe(3);
  expect(focused.outlineOffset).toBe(-3);
  expect(focused.boxShadow).toContain('#101216');
  expect(focused.transform).toEqual([{ translateY: -2 }, { scale: 1.025 }]);
  expect(transform).toEqual([{ translateY: -2 }]);
});

test('reduced motion retains the ring without adding scale', () => {
  const focused = focusStyle(undefined, true);
  expect(focused.outlineWidth).toBe(3);
  expect(focused.transform).toBeUndefined();
});

test('a marked reading stop (an About line) wears its ring around it, clear of the text', () => {
  const around = focusStyle(undefined, false, true);
  expect(around.outlineColor).toBe('#ffffff');
  expect(around.outlineOffset).toBeGreaterThan(0);
  // No inset band: on a box without padding it fell on the glyphs.
  expect(around.boxShadow).toBeUndefined();
  expect(around.transform).toEqual([{ scale: 1.025 }]);
  expect(focusStyle(undefined, true, true).transform).toBeUndefined();
});

test('controls keep the inset ring', () => {
  expect(focusStyle().outlineOffset).toBeLessThan(0);
  expect(focusStyle().boxShadow).toContain('#101216');
});
