import { expect, test } from 'bun:test';
import { railWidth, rowHeight, nowPillOffset, programmeFocusFrame, rulerLabelVisible } from '../src/widgets/guide/geometry';

test('TV guide gives channels more room without changing desktop or phone geometry', () => {
  expect(rowHeight(false, true)).toBeGreaterThan(rowHeight(false));
  expect(railWidth(false, true)).toBeGreaterThan(railWidth(false));
  expect(rowHeight(true)).toBe(68);
  expect(railWidth(true)).toBe(84);
});
test('only programmes crossing the viewport edge animate their labels', async () => {
  const { labelFollows } = await import('../src/widgets/guide/geometry');
  expect(labelFollows(60, 90, 100)).toBe(true);
  expect(labelFollows(110, 30, 100)).toBe(true);
  expect(labelFollows(160, 30, 100)).toBe(false);
  expect(labelFollows(40, 30, 100)).toBe(false);
});
test('empty intervals retain their time between channels instead of choosing a distant programme', async () => {
  const { programmeGap, programmeOverlapping } = await import('../src/widgets/guide/geometry');
  const channel = { programmes: [{ at: 60, span: 60 }, { at: 480, span: 60 }] } as import('@vela/core').GuideChannel;
  expect(programmeOverlapping(channel, 300)).toBeUndefined();
  expect(programmeGap(channel, 300, 1440)).toEqual({ at: 120, span: 360 });
  expect(programmeGap(channel, 540, 1440)).toEqual({ at: 540, span: 900 });
  expect(programmeGap(channel, 0, 1440)).toEqual({ at: 0, span: 60 });
  expect(programmeGap(channel, 90, 1440)).toBeUndefined();
});
test('gap targets cannot collide with programme targets on another channel', async () => {
  const { cellId, gapId } = await import('../src/widgets/guide/geometry');
  expect(cellId('120', 'gap-one')).not.toBe(gapId('one', 120));
});

test('the now clock stays complete at either ruler edge without moving the time coordinate', () => {
  expect(nowPillOffset(1, 400, 80)).toBe(4);
  expect(nowPillOffset(399, 400, 80)).toBe(316);
  expect(nowPillOffset(200, 400, 80)).toBe(160);
  expect(nowPillOffset(150, 400, 80)).toBe(110);
});
test('a ruler still measuring its viewport never produces a negative pill position', () => {
  expect(nowPillOffset(0, 0, 80)).toBe(4);
  expect(nowPillOffset(20, 60, 80)).toBe(4);
});

test('the ruler hides only time labels covered by the now chip', () => {
  expect(rulerLabelVisible(100, 70, 120, 88)).toBe(false);
  expect(rulerLabelVisible(20, 70, 120, 88)).toBe(true);
  expect(rulerLabelVisible(220, 70, 120, 88)).toBe(true);
});


test('focus crops a programme crossing the rail and leaves a shadow gutter on both edges', () => {
  for (const [left, width] of [[-500, 800], [0, 180], [300, 400], [-500, 2000]]) {
    for (const lift of [1, 1.02, 1.045, 1.08]) {
      const frame = programmeFocusFrame(left!, width!, 0, 600, lift);
      const centre = frame.left + frame.width / 2 + frame.translateX;
      expect(centre - frame.width * frame.scaleX / 2).toBeGreaterThanOrEqual(6 - 0.00001);
      expect(centre + frame.width * frame.scaleX / 2).toBeLessThanOrEqual(594.00001);
      expect(frame.scaleY).toBeLessThanOrEqual(1.045);
    }
  }
});
test('cropping follows a scrolled time window and handles narrow visible tails', () => {
  const frame = programmeFocusFrame(100, 410, 500, 600, 1.045);
  expect(frame.left).toBe(506);
  expect(frame.width).toBe(4);
  const wide = programmeFocusFrame(100, 2000, 500, 600, 1.045);
  expect(wide.left).toBe(506);
  expect(wide.width).toBe(588);
  expect(wide.scaleX).toBe(1);
});

test('the capped vertical lift leaves room for the compact shadow at the first and last row', () => {
  for (const height of [68, 72, 96]) {
    const body = height - 11;
    const expansion = body * (programmeFocusFrame(0, 200, 0, 600, 1.1).scaleY - 1) / 2;
    expect(5 - expansion - 2).toBeGreaterThan(0);
    expect(5 + body + expansion + 2).toBeLessThan(height);
  }
});

test('offscreen slots collapse without removing the keyboard focus target', () => {
  expect(programmeFocusFrame(-300, 100, 0, 600, 1.045).scaleX).toBe(0);
  expect(programmeFocusFrame(900, 100, 0, 600, 1.045).scaleX).toBe(0);
  expect(programmeFocusFrame(0, 100, 0, 0, 1.045).width).toBe(0);
});

test('partially scrolled boundary rows lift inside the vertical viewport', () => {
  for (const top of [-80, -30, 5, 450, 490]) {
    const frame = programmeFocusFrame(top, 85, 0, 500, 1.045, 3);
    const centre = frame.left + frame.width / 2 + frame.translateX;
    expect(centre - frame.width * frame.scaleX / 2).toBeGreaterThanOrEqual(2.99999);
    expect(centre + frame.width * frame.scaleX / 2).toBeLessThanOrEqual(497.00001);
  }
});
