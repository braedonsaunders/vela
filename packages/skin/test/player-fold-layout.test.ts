import { expect, test } from 'bun:test';
import type { Viewport } from '../src/css';
import { watchFrames } from '../src/widgets/player/fold-layout';

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

test('held like a book the picture spans both halves, as fully open', () => {
  const landscape: Viewport = { width: 867, height: 669, insets: { top: 0, right: 0, bottom: 34, left: 0 }, sides: { left: 0, right: 84 } };
  const frames = watchFrames({ ...landscape, fold: { posture: 'book', division: { x: 455.5, y: 0, width: 40, height: 669 } } });
  expect(frames.picture).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  expect(frames.chrome).toEqual({ top: 0, right: 84, bottom: 34, left: 0 });
});

test('a fold too near an edge to leave two usable halves is drawn flat', () => {
  expect(watchFrames({ ...upright, fold: { posture: 'tabletop', division: { x: 0, y: 200, width: 669, height: 40 } } })).toEqual(watchFrames(upright));
  expect(watchFrames({ ...upright, fold: { posture: 'tabletop', division: { x: 0, y: 760, width: 669, height: 40 } } })).toEqual(watchFrames(upright));
});
