import { expect, test } from 'bun:test';
import { stickyOffset } from '../src/sticky-layout';

test('a sticky header follows flow, then stays at the scroll top', () => {
  const layout = { y: 120, height: 40 };
  expect(stickyOffset(-20, layout)).toBe(0);
  expect(stickyOffset(80, layout)).toBe(0);
  expect(stickyOffset(120, layout)).toBe(0);
  expect(stickyOffset(300, layout)).toBe(180);
});

test('the next header pushes the current header away without a jump', () => {
  const layout = { y: 120, height: 40 };
  expect(stickyOffset(200, layout, 300)).toBe(80);
  expect(stickyOffset(260, layout, 300)).toBe(140);
  expect(stickyOffset(400, layout, 300)).toBe(140);
  expect(stickyOffset(400, layout, 150)).toBe(0);
});

test('a decorative backdrop with zero flow height stays pinned', () => {
  expect(stickyOffset(500, { y: 0, height: 0 })).toBe(500);
});
