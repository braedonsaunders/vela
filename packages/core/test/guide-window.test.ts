import { test, expect } from 'bun:test';
import { guideWindows } from '../src/live/window';
test('adjacent viewport requests reuse fixed time windows in both directions', () => {
  expect(guideWindows(130, 460, 0, 1000, 180)).toEqual([{ from: 0, until: 180 }, { from: 180, until: 360 }, { from: 360, until: 540 }]);
  expect(guideWindows(190, 520, 0, 1000, 180)).toEqual([{ from: 180, until: 360 }, { from: 360, until: 540 }]);
  expect(guideWindows(950, 1200, 0, 1000, 180)).toEqual([{ from: 900, until: 1000 }]);
});
