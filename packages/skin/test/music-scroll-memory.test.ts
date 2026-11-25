import { expect, test } from 'bun:test';
import { canResume, createScrollMemory } from '../src/blocks/listen/scroll-end';

test('the page in view resumes where it was when its shell is replaced (a fold or a resize)', () => {
  const memory = createScrollMemory();
  memory.keep('title:album-1', 840);
  expect(memory.resume('title:album-1')).toBe(840);
});

test('opening another page, or coming back to one visited earlier, starts at the top', () => {
  const memory = createScrollMemory();
  memory.keep('title:album-1', 840);
  expect(memory.resume('home')).toBe(0);
  memory.keep('home', 120);
  expect(memory.resume('title:album-1')).toBe(0);
});

test('nonsense offsets (overscroll, NaN) are kept as the top', () => {
  const memory = createScrollMemory();
  memory.keep('home', -60);
  expect(memory.resume('home')).toBe(0);
  memory.keep('home', Number.NaN);
  expect(memory.resume('home')).toBe(0);
  expect(memory.resume('')).toBe(0);
});

test('a page resumes only once its scroller is measured and its content reaches that far', () => {
  expect(canResume(840, { offset: 0, viewport: 0, content: 2000 })).toBe(false);
  expect(canResume(840, { offset: 0, viewport: 600, content: 1200 })).toBe(false);
  expect(canResume(840, { offset: 0, viewport: 600, content: 1440 })).toBe(true);
  expect(canResume(0, { offset: 0, viewport: 600, content: 1440 })).toBe(false);
});
