import { expect, test } from 'bun:test';
import { opensAtTop, pinOpeningScroll, viewerScrollIntent } from '../src/opening-scroll';

test('title and plugin-screen details open at the top', () => {
  expect(opensAtTop('title')).toBe(true);
  expect(opensAtTop('screen')).toBe(true);
  expect(opensAtTop('home')).toBe(false);
  expect(opensAtTop('collection')).toBe(false);
});

test('opening scroll stays pinned only through focus settlement and before viewer input', () => {
  expect(pinOpeningScroll(1_000, 2_400, false)).toBe(true);
  expect(pinOpeningScroll(1_000, 2_401, false)).toBe(false);
  expect(pinOpeningScroll(1_000, 1_100, true)).toBe(false);
});

test('a wheel, trackpad, touch, scrollbar press or scrolling key is the viewer moving, never pinned back', () => {
  for (const type of ['wheel', 'touchstart', 'touchmove', 'pointerdown', 'mousedown']) expect(viewerScrollIntent({ type })).toBe(true);
  for (const key of ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ']) expect(viewerScrollIntent({ type: 'keydown', key })).toBe(true);
  expect(viewerScrollIntent({ type: 'keydown', key: 'a' })).toBe(false);
  expect(viewerScrollIntent({ type: 'keydown', key: 'Tab' })).toBe(false);
  // The scroll event itself says nothing about who moved the page: focus scrolls too.
  expect(viewerScrollIntent({ type: 'scroll' })).toBe(false);
  expect(viewerScrollIntent({ type: 'focus' })).toBe(false);
  // Within the settle, viewer input ends the pin at once.
  expect(pinOpeningScroll(1_000, 1_200, viewerScrollIntent({ type: 'wheel' }))).toBe(false);
});
