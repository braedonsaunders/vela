// The sleep timer's rules, shared by spoken audio and the video player.
import { expect, test } from 'bun:test';
import { AWAKE, chapterEnd, holdsNext, sleepDue, sleepFrom, sleepLeftMs } from '../src/sleep';

const chapters = [{ startSeconds: 0, endSeconds: 60, title: 'One' }, { startSeconds: 60, title: 'Two' }, { startSeconds: 110, title: 'Three' }] as never[];

test('a timer pauses once its minutes have passed, and says what is left until then', () => {
  const sleep = sleepFrom('timer', 15, 1_000, 42);
  expect(sleep).toEqual({ mode: 'timer', endsAt: 1_000 + 15 * 60_000, minutes: 15 });
  expect(sleepDue(sleep, 1_000 + 14 * 60_000, 900)).toBe(false);
  expect(sleepLeftMs(sleep, 1_000 + 14 * 60_000)).toBe(60_000);
  expect(sleepDue(sleep, 1_000 + 15 * 60_000, 901)).toBe(true);
  expect(sleepLeftMs(sleep, 1_000 + 16 * 60_000)).toBe(0);
});

test('the end of this episode never pauses mid-play; it holds back whatever would start next', () => {
  const sleep = sleepFrom('item', 0, 1_000, 42);
  expect(sleepDue(sleep, Number.MAX_SAFE_INTEGER, 1e6)).toBe(false);
  expect(holdsNext(sleep)).toBe(true);
  expect(holdsNext(sleepFrom('timer', 30, 0, 0))).toBe(false);
  expect(holdsNext(AWAKE)).toBe(false);
});

test('a chapter sleep ends with the chapter it was set in, not the next', () => {
  const sleep = sleepFrom('chapter', 0, 0, 70);
  expect(chapterEnd(chapters, 70)).toBe(110);
  expect(sleepDue(sleep, 0, 100, chapters)).toBe(false);
  expect(sleepDue(sleep, 0, 109.8, chapters)).toBe(true);
  expect(sleepDue(sleep, 0, 109.8, [])).toBe(false);
});

test('off is never due', () => {
  expect(sleepDue(AWAKE, Number.MAX_SAFE_INTEGER, 1e6, chapters)).toBe(false);
});
