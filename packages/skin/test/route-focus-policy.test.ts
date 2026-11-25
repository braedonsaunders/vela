import { expect, test } from 'bun:test';
import { restoreRouteFocus, returnFocusTarget } from '../src/route-focus-policy';

test('native touch navigation does not restore TV focus over the keyboard', () => {
  expect(restoreRouteFocus('android', false)).toBe(false);
  expect(restoreRouteFocus('ios', false)).toBe(false);
});

test('TV and web keep route opener focus restoration', () => {
  expect(restoreRouteFocus('android', true)).toBe(true);
  expect(restoreRouteFocus('ios', true)).toBe(true);
  expect(restoreRouteFocus('web', false)).toBe(true);
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
