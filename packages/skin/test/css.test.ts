import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Measure } from '../src/css';

// css.ts asks react-native which platform it draws on; the real package is Flow source Bun
// cannot load, so provide the platform here.
const platform = { OS: 'ios' as string, isTV: false };
mock.module('react-native', () => ({ Platform: platform }));
const { colour, length, linearGradient, points, pxText, radialGradient, splitTop, withTokens } = await import('../src/css');

afterEach(() => { platform.OS = 'ios'; platform.isTV = false; });

const measure = (width = 1000, height = 800, fontSize = 20, axis: 'x' | 'y' = 'x'): Measure =>
  ({ viewport: { width, height, insets: { top: 47, right: 0, bottom: 34, left: 0 } }, fontSize, axis });
const m = measure();

describe('length units', () => {
  test.each([
    ['12', 12], ['12px', 12], ['-4px', -4], ['.5px', 0.5], ['1.5rem', 24], ['2em', 40], ['3ch', 30], ['2ex', 20],
    ['10vw', 100], ['50vh', 400], ['50dvh', 400], ['50svh', 400], ['50lvh', 400], ['10dvw', 100],
    ['10vmin', 80], ['10vmax', 100], ['33.333px', 33.33], ['1e1px', 10],
  ])('%s → %p', (raw, expected) => {
    expect(length(raw, m)).toBe(expected);
  });

  test('a plain percentage stays a percentage', () => {
    expect(length('50%', m)).toBe('50%');
    expect(length(' -12.5% ', m)).toBe('-12.5%');
  });

  test.each(['auto', 'none', 'garbage', '10px 5px', '10qq', '', 'calc(10px +)', 'calc(1px / 0)', 'min(10px, auto)'])('%p is not a length', raw => {
    expect(length(raw, m)).toBeUndefined();
  });
});

describe('length expressions', () => {
  test('calc with operator precedence and parentheses', () => {
    expect(length('calc(100vh - 2rem)', m)).toBe(768);
    expect(length('calc(10px + 2 * 5px)', m)).toBe(20);
    expect(length('calc((10px + 2px) * 2)', m)).toBe(24);
    expect(length('calc(100vw / 3)', m)).toBe(333.33);
    expect(length('calc(-1 * 8px)', m)).toBe(-8);
  });

  test('clamp keeps the preferred value between its bounds', () => {
    const at = (width: number) => length('clamp(12px, 2vw, 24px)', measure(width));
    expect(at(400)).toBe(12);
    expect(at(1000)).toBe(20);
    expect(at(2000)).toBe(24);
  });

  test('min and max, nested inside calc', () => {
    expect(length('min(10vw, 80px)', m)).toBe(80);
    expect(length('max(10vw, 80px)', m)).toBe(100);
    expect(length('calc(min(10vw, 80px) * 2)', m)).toBe(160);
    expect(length('max(1rem, min(5vh, 3em))', m)).toBe(40);
  });

  test('safe-area insets', () => {
    expect(length('env(safe-area-inset-top)', m)).toBe(47);
    expect(length('calc(env(safe-area-inset-bottom) + 8px)', m)).toBe(42);
    expect(length('max(env(safe-area-inset-left), 16px)', m)).toBe(16);
  });

  test('em follows the font size in force', () => {
    expect(length('calc(1em + 1rem)', measure(1000, 800, 10))).toBe(26);
  });
});

describe('percentages mixed with other units', () => {
  test('natively, calc(P% ± …) keeps the percentage', () => {
    expect(length('calc(100% - 20px)', m)).toBe('100%');
    expect(length('calc(50% + 1rem)', m)).toBe('50%');
  });

  test('natively, min() and max() keep the winning argument in its own unit', () => {
    expect(length('min(50%, 300px)', measure(1000))).toBe(300);
    expect(length('min(50%, 300px)', measure(400))).toBe('50%');
    expect(length('max(50%, 300px)', measure(1000))).toBe('50%');
    // A percentage measured on the vertical axis.
    expect(length('min(50%, 300px)', measure(1000, 500, 16, 'y'))).toBe('50%');
  });

  test('natively, other mixes take the percentage of the viewport axis', () => {
    expect(length('calc(20px + 10%)', m)).toBe(120);
    expect(length('calc(20px + 10%)', measure(1000, 800, 16, 'y'))).toBe(100);
  });

  test('on the web the browser computes the mix itself', () => {
    platform.OS = 'web';
    expect(length('calc(100% - 20px)', m) as string).toBe('calc(100% - 20px)');
    expect(length('min(50%, 300px)', m) as string).toBe('min(50%, 300px)');
    // Unmixed values are still evaluated.
    expect(length('2rem', m)).toBe(32);
  });
});

describe('points', () => {
  test('resolves a percentage against the base', () => {
    expect(points('50%', m, 200)).toBe(100);
    expect(points('50%', m)).toBe(0);
    expect(points('2rem', m, 200)).toBe(32);
    expect(points('auto', m, 200)).toBeUndefined();
  });
});

describe('free text', () => {
  test('pxText rewrites relative lengths and expressions in px', () => {
    expect(pxText('0 0 1rem 2vw rgba(0,0,0,.5)', m)).toBe('0 0 16px 20px rgba(0,0,0,.5)');
    expect(pxText('0 clamp(4px, 1vw, 8px) 0 black', m)).toBe('0 8px 0 black');
    expect(pxText('0 calc(1rem + min(1vw, 2px)) red', m)).toBe('0 18px red');
    expect(pxText('2px 50% 10deg', m)).toBe('2px 50% 10deg');
  });

  test('splitTop splits outside parentheses only', () => {
    expect(splitTop('a, rgb(1, 2, 3) 10%, calc(1px + 2px)', 'comma')).toEqual(['a', 'rgb(1, 2, 3) 10%', 'calc(1px + 2px)']);
    expect(splitTop('  0 2px  rgba(0, 0, 0, 0.5) ', 'space')).toEqual(['0', '2px', 'rgba(0, 0, 0, 0.5)']);
  });
});

describe('colours', () => {
  test('theme tokens and var() resolve; unknown names stay', () => {
    expect(withTokens('var(--ink.primary)')).toBe('#f5f1e9');
    expect(withTokens('var(--x-ink.primary)')).toBe('#f5f1e9');
    expect(withTokens('var(--nope)')).toBe('var(--nope)');
    expect(withTokens('0 1px ink.quiet, surface.page')).toBe('0 1px #858d98, #090b0e');
    expect(withTokens('not.a.token')).toBe('not.a.token');
    expect(colour(' ink.inverse ')).toBe('#111419');
  });

  test('colours React Native cannot draw are dropped', () => {
    for (const value of ['', 'none', 'currentColor', 'currentcolor', 'color-mix(in srgb, red, blue)', 'oklch(0.7 0.1 30)', 'lab(50% 0 0)']) {
      expect(colour(value)).toBeUndefined();
    }
    expect(colour('#ff000080')).toBe('#ff000080');
    expect(colour('rgba(0, 0, 0, 0.5)')).toBe('rgba(0, 0, 0, 0.5)');
  });
});

describe('gradients', () => {
  test('a linear gradient by side, with spread and explicit stops', () => {
    const g = linearGradient('linear-gradient(to right, red, black 80%)')!;
    expect(g.colors).toEqual(['red', '#000']);
    expect(g.locations).toEqual([0, 0.8]);
    expect(g.start.x).toBeCloseTo(0);
    expect(g.start.y).toBeCloseTo(0.5);
    expect(g.end.x).toBeCloseTo(1);
    expect(g.end.y).toBeCloseTo(0.5);
  });

  test('a linear gradient defaults to top-to-bottom and reads angles', () => {
    const down = linearGradient('linear-gradient(#000, #fff, #000)')!;
    expect(down.locations).toEqual([0, 0.5, 1]);
    expect(down.start.y).toBeCloseTo(0);
    expect(down.end.y).toBeCloseTo(1);
    const diagonal = linearGradient('linear-gradient(45deg, red, blue)')!;
    expect(diagonal.end.x).toBeCloseTo(0.5 + Math.SQRT1_2 / 2);
    expect(diagonal.end.y).toBeCloseTo(0.5 - Math.SQRT1_2 / 2);
  });

  test('a linear gradient needs two colours', () => {
    expect(linearGradient('linear-gradient(to top, red)')).toBeUndefined();
    expect(linearGradient('radial-gradient(red, blue)')).toBeUndefined();
  });

  test('a radial gradient as an ellipse over the box', () => {
    const closest = radialGradient('radial-gradient(closest-side at 25% 50%, red, transparent)')!;
    expect(closest.centre).toEqual({ x: 0.25, y: 0.5 });
    expect(closest.radius).toEqual({ x: 0.25, y: 0.5 });
    const farthest = radialGradient('radial-gradient(red, transparent 70%)')!;
    expect(farthest.centre).toEqual({ x: 0.5, y: 0.5 });
    expect(farthest.radius.x).toBeCloseTo(0.5 * Math.SQRT2);
    expect(farthest.locations).toEqual([0, 0.7]);
  });
});

test('explicit inherit keeps the parent text rows', async () => {
  const { inheritRows } = await import('../src/inherit-rows');
  expect(inheritRows({ color: '#eee', 'font-weight': '600' }, { color: 'inherit', 'font-weight': '700' })).toEqual({ color: '#eee', 'font-weight': '700' });
});


test('nested inherited font sizes stay in points on TV instead of scaling at each box', async () => {
  const { inheritText } = await import('../src/text-inheritance');
  platform.OS = 'android'; platform.isTV = true;
  const viewport = measure(960, 540).viewport;
  const first = inheritText({ rows: {}, fontSize: 16 }, { 'font-size': '20px' }, viewport);
  const second = inheritText(first, { color: 'red' }, viewport);
  const third = inheritText(second, { 'font-size': 'inherit' }, viewport);
  expect(first.fontSize).toBe(12.5);
  expect(second.fontSize).toBe(first.fontSize);
  expect(third.fontSize).toBe(first.fontSize);
  expect(inheritText(third, { 'font-size': '150%' }, viewport).fontSize).toBe(first.fontSize * 1.5);
});

test('equal inherited text from the same parent is the same value, so boxes below need not redraw', async () => {
  const { inheritText } = await import('../src/text-inheritance');
  platform.OS = 'web'; platform.isTV = false;
  const viewport = measure(1440, 900).viewport;
  const parent = { rows: {}, fontSize: 16 };
  const first = inheritText(parent, { color: '#eee', 'font-size': '18px' }, viewport);
  expect(inheritText(parent, { 'font-size': '18px', color: '#eee' }, viewport)).toBe(first);
  expect(inheritText(parent, { color: '#fff', 'font-size': '18px' }, viewport)).not.toBe(first);
  expect(inheritText(parent, { color: '#eee', 'font-size': '18px' }, measure(800, 600).viewport)).not.toBe(first);
  expect(inheritText(first, {}, viewport)).toBe(first);
});
