import { expect, test } from 'bun:test';
import { guideBand, guideTop } from '../src/widgets/guide/geometry';
import { resolveDocument } from '../src/resolve';
import { cinematicDoc } from '../../protocol/fixtures/skins/cinematic';
import { velaBase } from '../src/resolve/base';

test('floating navigation clears both phone rows and desktop header, flow headers add no gap', () => {
  expect(guideTop(false, true, 62)).toBe(170);
  expect(guideTop(false, false, 0)).toBe(68);
  expect(guideTop(true, false, 24)).toBe(0);
});

test('wide bands contain a 16:9 preview and leave most of the route for the grid', () => {
  for (const [width, height] of [[1920, 1080], [1440, 900], [1024, 768], [852, 393]]) {
    const top = guideTop(false, false, 0);
    const band = guideBand(width!, height!, top, width! * 0.04);
    expect(band.stacked).toBe(false);
    expect(band.pictureHeight + band.gap * 2).toBeLessThanOrEqual(band.height);
    expect(band.pictureHeight * 16 / 9).toBeLessThanOrEqual(width! * 0.46);
    expect(band.height).toBeLessThan((height! - top) * 0.4);
  }
});

test('portrait stacks a wider preview with copy space and keeps controls/grid below', () => {
  const band = guideBand(393, 852, 170, 16);
  expect(band.stacked).toBe(true);
  expect(band.pictureHeight * 16 / 9).toBeGreaterThan(300);
  expect(band.pictureHeight + 88).toBeLessThanOrEqual(band.height);
  expect(852 - 170 - band.height).toBeGreaterThan(350);
});

test('Cinematic opts in through its guide document; other documents retain compact proportions', () => {
  expect(resolveDocument(cinematicDoc, 1440).guideLayout).toBe('cinematic');
  expect(resolveDocument({ ...cinematicDoc, id: 'other', routes: undefined }, 1440).guideLayout).toBeUndefined();
  expect(resolveDocument(velaBase, 1440).guideLayout).toBeUndefined();
});
