import { describe, expect, test } from 'bun:test';
import { authLayout } from '../src/widgets/auth/layout';

const viewport = (width: number, height: number) => ({ width, height, insets: { top: 47, bottom: 34, left: 0, right: 0 } });
describe('auth stage budget', () => {
  test.each([[320, 568], [375, 667], [393, 852], [440, 956], [568, 320], [852, 393], [956, 440], [951, 669]])('fits safe area at %ix%i', (w, h) => {
    const v = viewport(w, h);
    const layout = authLayout(v);
    expect(layout.compact).toBe(true);
    expect(layout.cardHeight + 2 * layout.padding + (layout.logoHeight ? layout.logoHeight + layout.gap : 0)).toBe(h - 81);
    expect(layout.cardHeight).toBeGreaterThan(0);
    if (h < 580) expect(layout.logoHeight).toBe(0);
  });
  test('keyboard height removes decoration and reserves only the visible region', () => {
    const layout = authLayout(viewport(393, 852), 420);
    expect(layout.logoHeight).toBe(0);
    expect(layout.cardHeight).toBe(323);
  });
  test('collapses visual headings and labels in the smallest keyboard area', () => {
    expect(authLayout(viewport(393, 852), 320).minimal).toBe(true);
    expect(authLayout(viewport(393, 852)).minimal).toBe(false);
    expect(authLayout(viewport(1920, 1080), 320, true).minimal).toBe(false);
  });
  test('leaves spacious tablets and TV alone', () => {
    expect(authLayout(viewport(768, 1024)).compact).toBe(false);
    expect(authLayout(viewport(1920, 1080), 1080, true).compact).toBe(false);
  });
  test('rotation recomputes the short-height treatment', () => {
    expect(authLayout(viewport(393, 852)).logoHeight).toBeGreaterThan(0);
    expect(authLayout(viewport(852, 393)).landscape).toBe(true);
    expect(authLayout(viewport(852, 393)).logoHeight).toBe(0);
  });
});
