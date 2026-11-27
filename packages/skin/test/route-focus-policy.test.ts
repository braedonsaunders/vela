import { expect, test } from 'bun:test';
import { openingFocusPriority, openingWindowOpen, takesOpeningFocus, readLibraryOpeningFocus, restoreRouteFocus, returnFocusTarget } from '../src/route-focus-policy';

test('native touch navigation does not restore TV focus over the keyboard', () => {
  expect(restoreRouteFocus('android', false)).toBe(false);
  expect(restoreRouteFocus('ios', false)).toBe(false);
});

test('TV and web keep route opener focus restoration', () => {
  expect(restoreRouteFocus('android', true)).toBe(true);
  expect(restoreRouteFocus('ios', true)).toBe(true);
  expect(restoreRouteFocus('web', false)).toBe(true);
});

test('Read All books leaves opening focus with TV navigation', () => {
  expect(readLibraryOpeningFocus(true, 'all-books')).toBe(false);
  expect(readLibraryOpeningFocus(true, 'series')).toBe(true);
  expect(readLibraryOpeningFocus(false, 'all-books')).toBe(true);
});

test('Back from playback prefers the pressed hero button even if another button plays the same title', () => {
  const opener = { target: 'hero-resume', does: 'play:t1' };
  const buttons = new Map([['nav-home', 'home:'], ['another-play', 'play:t1'], ['hero-resume', 'play:t1']]);
  expect(returnFocusTarget(opener, buttons)).toBe('hero-resume');
});

test('a redraw while the player closes can replace the hero Resume control with Play', () => {
  const opener = { target: 'old-resume', does: 'play:t1' };
  const buttons = new Map([['nav-home', 'home:'], ['restart', 'play:t1|||0']]);
  expect(returnFocusTarget(opener, buttons)).toBeUndefined();
  buttons.set('new-play', 'play:t1');
  expect(returnFocusTarget(opener, buttons)).toBe('new-play');
});

test('a delayed series action takes precedence over trailer and episode-row focus', () => {
  const trailer = openingFocusPriority('playExtra');
  const episode = openingFocusPriority('play');
  const primary = openingFocusPriority('play', true);
  expect(takesOpeningFocus(trailer, 0, false)).toBe(true);
  expect(takesOpeningFocus(episode, trailer, false)).toBe(true);
  expect(takesOpeningFocus(primary, episode, false)).toBe(true);
  expect(takesOpeningFocus(trailer, primary, false)).toBe(false);
  expect(takesOpeningFocus(primary, trailer, true)).toBe(false);
  expect(takesOpeningFocus(openingFocusPriority('toggle'), 0, false)).toBe(false);
});

test('a route that has placed no focus may still take it after its window; one that has, may not', () => {
  // Within the window, either way.
  expect(openingWindowOpen(1000, 5000, 0)).toBe(true);
  expect(openingWindowOpen(1000, 5000, 2)).toBe(true);
  // A slow box drew Home's hero after the window: nothing was focused, so the hero still takes focus.
  expect(openingWindowOpen(12000, 5000, 0)).toBe(true);
  // A page already focused keeps it when better content arrives late.
  expect(openingWindowOpen(12000, 5000, 1)).toBe(false);
});
