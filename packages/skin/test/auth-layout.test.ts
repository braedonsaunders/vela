import { describe, expect, test } from 'bun:test';
import { authLayout, DISPLAY_LINE_HEIGHT, horizonPlan, keyboardAvoidanceEnabled } from '../src/widgets/auth/layout';

const viewport = (width: number, height: number, top = 62, bottom = 34) => ({ width, height, insets: { top, bottom, left: 0, right: 0 } });
const phone = (width: number, height: number) => ({ viewport: viewport(width, height), height, keyboard: 0, content: 0, touch: true });

describe('auth layout', () => {
  test('leaves Android TV IME resizing to the native window', () => {
    expect(keyboardAvoidanceEnabled('android', true)).toBe(false);
    expect(keyboardAvoidanceEnabled('android', false)).toBe(true);
    expect(keyboardAvoidanceEnabled('ios', true)).toBe(true);
    expect(keyboardAvoidanceEnabled('web', false)).toBe(false);
  });
  test.each([[320, 568], [375, 667], [402, 874], [440, 956]])('a portrait phone at %ix%i is one column within its margins', (w, h) => {
    const layout = authLayout(viewport(w, h), h, false, true);
    expect(layout.compact).toBe(true);
    expect(layout.landscape).toBe(false);
    expect(layout.contentWidth).toBe(Math.min(440, w - 48));
    expect(layout.controlHeight).toBeGreaterThanOrEqual(46);
  });
  test('primary actions keep thumb size until height is scarce', () => {
    expect(authLayout(viewport(402, 874), 874, false, true).controlHeight).toBe(56);
    expect(authLayout(viewport(375, 667, 20, 0), 667, false, true).controlHeight).toBe(52);
    expect(authLayout(viewport(402, 874), 420, false, true).controlHeight).toBe(46);
  });
  test('a landscape phone typing keeps only its fields', () => {
    expect(authLayout(viewport(874, 402, 0, 21), 230, false, true).minimal).toBe(true);
    expect(authLayout(viewport(402, 874), 874, false, true).minimal).toBe(false);
    expect(authLayout(viewport(1920, 1080), 320, true).minimal).toBe(false);
  });
  test('tablets, desktops and TVs keep a reading measure', () => {
    expect(authLayout(viewport(768, 1024)).compact).toBe(false);
    expect(authLayout(viewport(1440, 900)).contentWidth).toBe(440);
    expect(authLayout(viewport(1920, 1080), 1080, true).contentWidth).toBe(600);
  });
  test('the display line box holds Instrument Serif’s ascender and descender', () => {
    // hhea ascent 990 + descent 310 per 1000 units: anything shorter clips the glyph tops on iOS.
    expect(DISPLAY_LINE_HEIGHT).toBeGreaterThanOrEqual(1.3);
  });
});

describe('horizon plan', () => {
  test('a short first step leaves a tall sky: the horizon at the hero line, a full sail', () => {
    const plan = horizonPlan({ ...phone(402, 874), content: 220 });
    expect(plan.horizon).toBe(Math.round(62 + (874 - 34 - 62) * 0.5));
    expect(plan.sail).toBe(172);
    expect(plan.split).toBe(false);
  });
  test('deeper steps raise the horizon and shrink the sail', () => {
    const first = horizonPlan({ ...phone(402, 874), content: 300 });
    const deep = horizonPlan({ ...phone(402, 874), content: 300, deep: true });
    expect(deep.horizon).toBeLessThan(first.horizon);
    expect(deep.sail).toBeLessThan(first.sail);
    expect(deep.sail).toBeGreaterThan(0);
  });
  test('content always fits below the horizon until the top band is reached', () => {
    for (const content of [200, 400, 520, 600, 640]) {
      const plan = horizonPlan({ ...phone(402, 874), content });
      expect(plan.contentTop + content).toBeLessThanOrEqual(874 - plan.contentBottom + 1);
      expect(plan.contentTop).toBeGreaterThan(plan.horizon);
    }
  });
  test('more content lifts the horizon continuously, never below the top band', () => {
    const heights = [100, 300, 450, 600, 900].map(content => horizonPlan({ ...phone(402, 874), content }).horizon);
    for (let i = 1; i < heights.length; i++) expect(heights[i]!).toBeLessThanOrEqual(heights[i - 1]!);
    expect(heights.at(-1)).toBe(62 + 64);
  });
  test('a small phone (iPhone SE) still shows a sail on its first step', () => {
    const plan = horizonPlan({ viewport: viewport(375, 667, 20, 0), height: 667, keyboard: 0, content: 260, touch: true });
    expect(plan.sail).toBeGreaterThan(80);
    expect(plan.contentTop + 260).toBeLessThanOrEqual(667 - plan.contentBottom + 1);
  });
  test('the keyboard lifts the horizon to the top and stands the content above it', () => {
    const typing = horizonPlan({ ...phone(402, 874), keyboard: 336, content: 300 });
    const resting = horizonPlan({ ...phone(402, 874), content: 300 });
    expect(typing.horizon).toBeLessThan(resting.horizon);
    expect(typing.contentBottom).toBe(336 + 12);
    expect(typing.contentTop + 300).toBeLessThanOrEqual(874 - typing.contentBottom + 1);
  });
  test('the keyboard hides the sail when it leaves no sky for it', () => {
    expect(horizonPlan({ ...phone(375, 667), keyboard: 260, content: 330 }).sail).toBe(0);
  });
  test('a landscape phone splits: the scene on the left, the step on the right', () => {
    const plan = horizonPlan({ viewport: viewport(874, 402, 0, 21), height: 402, keyboard: 0, content: 300, touch: true });
    expect(plan.split).toBe(true);
    expect(plan.pane).toBe(Math.round(874 * 0.42));
    expect(plan.sail).toBeGreaterThan(0);
  });
  test('a pointer window never splits, however short', () => {
    expect(horizonPlan({ viewport: viewport(1280, 400, 0, 0), height: 400, keyboard: 0, content: 200 }).split).toBe(false);
  });
  test('a table-top foldable puts the horizon on its fold', () => {
    const v = { ...viewport(669, 951), fold: { posture: 'tabletop' as const, division: { x: 0, y: 455.5, width: 669, height: 40 } } };
    const plan = horizonPlan({ viewport: v, height: 951, keyboard: 0, content: 300, touch: true });
    expect(plan.horizon).toBe(456);
    expect(plan.contentTop).toBe(496);
  });
  test('a book-held foldable splits at its fold', () => {
    const v = { ...viewport(951, 669), fold: { posture: 'book' as const, division: { x: 455.5, y: 0, width: 40, height: 669 } } };
    const plan = horizonPlan({ viewport: v, height: 669, keyboard: 0, content: 300, touch: true });
    expect(plan.split).toBe(true);
    expect(plan.pane).toBe(455.5);
  });
});
