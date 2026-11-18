import { expect, test } from 'bun:test';
import { railWidth, rowHeight } from '../src/widgets/guide/geometry';

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
