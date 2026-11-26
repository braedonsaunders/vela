import { describe, expect, test } from 'bun:test';
import { authLayout, keyboardAvoidanceEnabled } from '../src/widgets/auth/layout';

const viewport = (width: number, height: number) => ({ width, height, insets: { top: 47, bottom: 34, left: 0, right: 0 } });
describe('auth stage budget', () => {
  test('leaves Android TV IME resizing to the native window', () => {
    expect(keyboardAvoidanceEnabled('android', true)).toBe(false);
    expect(keyboardAvoidanceEnabled('android', false)).toBe(true);
    expect(keyboardAvoidanceEnabled('ios', true)).toBe(true);
    expect(keyboardAvoidanceEnabled('web', false)).toBe(false);
  });
  test.each([[320, 568], [375, 667], [393, 852], [440, 956], [568, 320], [852, 393], [956, 440]])('fits safe area at %ix%i', (w, h) => {
    const v = viewport(w, h);
    const layout = authLayout(v, v.height, false, true);
    expect(layout.compact).toBe(true);
    expect(layout.cardHeight + 2 * layout.padding + (layout.logoHeight ? layout.logoHeight + layout.gap : 0)).toBe(h - 81);
    expect(layout.cardHeight).toBeGreaterThan(0);
    if (h < 580) expect(layout.logoHeight).toBe(0);
  });
  test('keyboard height removes decoration and reserves only the visible region', () => {
    const layout = authLayout(viewport(393, 852), 420, false, true);
    expect(layout.logoHeight).toBe(0);
    expect(layout.cardHeight).toBe(323);
  });
  test('collapses visual headings and labels in the smallest keyboard area', () => {
    expect(authLayout(viewport(393, 852), 320, false, true).minimal).toBe(true);
    expect(authLayout(viewport(393, 852)).minimal).toBe(false);
    expect(authLayout(viewport(1920, 1080), 320, true).minimal).toBe(false);
  });
  test('leaves spacious tablets and TV alone', () => {
    expect(authLayout(viewport(768, 1024)).compact).toBe(false);
    expect(authLayout(viewport(1920, 1080), 1080, true).compact).toBe(false);
  });
  test('rotation recomputes the short-height treatment', () => {
    expect(authLayout(viewport(393, 852)).logoHeight).toBeGreaterThan(0);
    expect(authLayout(viewport(852, 393), 393, false, true).landscape).toBe(true);
    expect(authLayout(viewport(852, 393), 393, false, true).logoHeight).toBe(0);
  });
});

// Height alone never changes the card or credential column layout.
describe('pointer and form-factor boundaries', () => {
  test.each([[1280,720], [1440,900], [1920,1080], [1024,768], [1366,1024], [951,669], [1398,2034], [852,393], [1280,320]])('mouse keeps one column at %ix%i', (w,h) => {
    const layout = authLayout(viewport(w,h));
    expect(layout.compact).toBe(false);
    expect(layout.landscape).toBe(false);
    expect(layout.minimal).toBe(false);
  });
  test.each([[1024,768], [1366,1024], [951,669], [1398,2034]])('large touch viewport keeps one column at %ix%i', (w,h) => {
    expect(authLayout(viewport(w,h),h,false,true).compact).toBe(false);
  });
  test('short desktop reduces decoration while keeping the column', () => {
    const short = authLayout(viewport(1280,720));
    const tall = authLayout(viewport(1440,900));
    expect(short.logoHeight).toBeLessThan(tall.logoHeight);
    expect(short.gap).toBeLessThan(tall.gap);
  });
  test('a short pointer window keeps the fields stacked and fits the alternative sign-in buttons beside each other', () => {
    const short = authLayout(viewport(669, 360));
    expect(short.landscape).toBe(false);
    expect(short.logoHeight).toBe(0);
    expect(short.inlineAlternatives).toBe(true);
    expect(authLayout(viewport(430, 360)).inlineAlternatives).toBe(false);
    expect(authLayout(viewport(669, 360), 360, false, true).inlineAlternatives).toBe(false);
  });
});
