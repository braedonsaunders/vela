import { expect, test } from 'bun:test';
import { sectionDirection, sceneMotion } from '../../../apps/vela/src/section-motion';

test('section motion follows the destination order in either direction', () => {
  expect(sectionDirection(3, 1)).toBe(1);
  expect(sectionDirection(1, 3)).toBe(-1);
});

test('section motion treats a stable or unknown order as forward', () => {
  expect(sectionDirection(2, 2)).toBe(1);
  expect(sectionDirection(-1, -1)).toBe(1);
});


test('a retained scene returns to zero without borrowing another scene’s value', () => {
  const home = { section: 'home', current: true, visible: true, width: 1280 };
  expect(sceneMotion({ ...home, section: 'movies', current: false, visible: false }, home, true, -1)).toEqual({ from: -1280, to: 0 });
  expect(sceneMotion(home, { ...home, width: 800 }, true, 1)).toEqual({ from: 0, to: 0 });
  expect(sceneMotion(home, home, true, 1)).toEqual({ from: 0, to: 0 });
  expect(sceneMotion(null, home, false, 1)).toEqual({ from: 0, to: 0 });
});
