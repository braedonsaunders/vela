import { expect, test } from 'bun:test';
import { phoneControlLayout, watchSideInsets } from '../src/widgets/player/phone-layout';

test('the full touch targets fit on one row from 320 through 669 points', () => {
  for (const width of [320, 360, 375, 390, 430, 466, 669]) {
    for (const native of [true, false]) {
      const layout = phoneControlLayout(width, 844, native, false);
      expect(layout.compact).toBe(true);
      expect(layout.showSteps).toBe(true);
      expect(layout.rowWidth + layout.gutter * 2).toBeLessThanOrEqual(width);
    }
  }
});

test('native phone landscape uses a compact row even on the wide Duo display', () => {
  expect(phoneControlLayout(951 - 84, 669 - 34, true, false, 951, 669).compact).toBe(true);
  expect(phoneControlLayout(844 - 59 * 2, 390 - 21, true, false, 844, 390).short).toBe(true);
  expect(phoneControlLayout(1280, 800, false, false).compact).toBe(false);
  expect(phoneControlLayout(540, 480, true, true).compact).toBe(false);
});

test('narrow safe areas or book panes move both seek buttons into the menu', () => {
  const layout = phoneControlLayout(260, 800, true, false);
  expect(layout.showSteps).toBe(false);
  expect(layout.rowWidth + layout.gutter * 2).toBeLessThanOrEqual(260);
});

test('portrait iPhone watch discards the side status strip and landscape keeps its cutout', () => {
  expect(watchSideInsets(466, 678, true, 0, 84)).toEqual({ left: 0, right: 0 });
  expect(watchSideInsets(669, 951, true, 0, 84)).toEqual({ left: 0, right: 0 });
  expect(watchSideInsets(951, 669, true, 0, 84)).toEqual({ left: 0, right: 84 });
  expect(watchSideInsets(360, 800, false, 12, 8)).toEqual({ left: 12, right: 8 });
});
