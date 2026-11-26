import { expect, test } from 'bun:test';
import { NOW_PLAYING_PLAY, nowPlayingFirstFocus } from '../src/widgets/media/now-playing-focus';

test('a TV opening waits for the transport and then targets Play', () => {
  expect(nowPlayingFirstFocus({ tv: true, open: true, laidOut: false, entered: false })).toBeUndefined();
  expect(nowPlayingFirstFocus({ tv: true, open: true, laidOut: true, entered: false })).toBe(NOW_PLAYING_PLAY);
});

test('closed and non-TV players do not request focus', () => {
  expect(nowPlayingFirstFocus({ tv: true, open: false, laidOut: true, entered: false })).toBeUndefined();
  expect(nowPlayingFirstFocus({ tv: false, open: true, laidOut: true, entered: false })).toBeUndefined();
});

test('a later layout leaves focus alone until the next opening', () => {
  const laidOut = { tv: true, laidOut: true };
  expect(nowPlayingFirstFocus({ ...laidOut, open: true, entered: true })).toBeUndefined();
  expect(nowPlayingFirstFocus({ ...laidOut, open: false, entered: true })).toBeUndefined();
  expect(nowPlayingFirstFocus({ ...laidOut, open: true, entered: false })).toBe(NOW_PLAYING_PLAY);
});
