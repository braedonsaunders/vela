import { expect, test } from 'bun:test';
import type { Viewport } from '../src/css';
import { watchFrames, watchPictureBounds } from '../src/widgets/player/fold-layout';

// The iPhone Duo's inner display upright (669×951 pt): the Dynamic Island's 82 pt at the top, the
// home indicator's 34 at the bottom, and iOS's division across the middle when partly open.
const upright: Viewport = { width: 669, height: 951, insets: { top: 82, right: 0, bottom: 34, left: 0 }, sides: { left: 0, right: 0 } };
const across = { x: 0, y: 455.5, width: 669, height: 40 };

test('flat, the picture fills the stage and the controls keep to the safe area', () => {
  expect(watchFrames(upright)).toEqual({
    picture: { top: 0, right: 0, bottom: 0, left: 0 },
    chrome: { top: 82, right: 0, bottom: 34, left: 0 },
  });
  expect(watchFrames({ ...upright, fold: { posture: 'flat' } })).toEqual(watchFrames(upright));
});

test('on a tabletop the picture takes the upper half and the controls the lower, clear of the fold', () => {
  const frames = watchFrames({ ...upright, fold: { posture: 'tabletop', division: across } });
  // Picture: from under the status bar down to the fold's margin.
  expect(frames.picture).toEqual({ top: 82, right: 0, bottom: 951 - 455.5, left: 0 });
  // Controls: from below the fold's margin to above the home indicator.
  expect(frames.chrome).toEqual({ top: 495.5, right: 0, bottom: 34, left: 0 });
});

test('held like a book the picture spans both halves while chrome avoids the hinge', () => {
  const landscape: Viewport = { width: 867, height: 669, insets: { top: 0, right: 0, bottom: 34, left: 0 }, sides: { left: 0, right: 84 } };
  const frames = watchFrames({ ...landscape, fold: { posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } } });
  expect(frames.picture).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(frames.chrome).toEqual({ top: 0, right: 495.5, bottom: 34, left: 0 });
  const reversed = { ...landscape, sides: { left: 84, right: 0 } };
  expect(watchFrames({ ...reversed, fold: { posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } } }).chrome)
    .toEqual({ top: 0, right: 0, bottom: 34, left: 495.5 });
});

test('a fold too near an edge to leave two usable halves is drawn flat', () => {
  expect(watchFrames({ ...upright, fold: { posture: 'tabletop', division: { x: 0, y: 200, width: 669, height: 40 } } })).toEqual(watchFrames(upright));
  expect(watchFrames({ ...upright, fold: { posture: 'tabletop', division: { x: 0, y: 760, width: 669, height: 40 } } })).toEqual(watchFrames(upright));
});

const hd = { width: 1920, height: 1080 };
const phone: Viewport = { width: 360, height: 800, insets: { top: 0, right: 0, bottom: 0, left: 0 } };

test('a contained picture excludes the black bars in portrait and landscape', () => {
  expect(watchPictureBounds(phone, watchFrames(phone), hd, false)).toEqual({ left: 0, right: 0, top: 298.75, bottom: 298.75 });
  const landscape = { ...phone, width: 844, height: 390 };
  const fit = watchPictureBounds(landscape, watchFrames(landscape), hd, false);
  expect(fit.left).toBeCloseTo(75.333);
  expect(fit.right).toBeCloseTo(75.333);
  expect(fit.top).toBe(0);
  expect(fit.bottom).toBe(0);
});

test('cover and unknown video sizes use the safe part of the whole picture', () => {
  const safe = { ...phone, width: 324, sides: { left: 36, right: 0 }, insets: { ...phone.insets, bottom: 20 } };
  expect(watchPictureBounds(safe, watchFrames(safe), hd, true)).toEqual({ left: 36, right: 0, top: 0, bottom: 20 });
  expect(watchPictureBounds(safe, watchFrames(safe), { width: 0, height: 0 }, false)).toEqual(watchFrames(safe).chrome);
});

test('a tabletop picture stays above the fold even while the controls are below it', () => {
  const tabletop: Viewport = { ...upright, fold: { posture: 'tabletop', division: across } };
  const picture = watchPictureBounds(tabletop, watchFrames(tabletop), hd, false);
  expect(picture.top).toBe(82);
  expect(picture.bottom).toBe(495.5);
  expect(picture.left).toBeCloseTo(2.5);
});
