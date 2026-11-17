import { expect, test } from 'bun:test';
import { playerPalette, playerContrast } from '../src/widgets/player/palette';

const p = playerPalette({});
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (rgb: number[]) => rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i]!, 0);
function contrast(a: number[], b: number[]) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('player text, focus and timeline stay legible over black and white video', () => {
  const alpha = parseInt(p.scrim.slice(7), 16) / 255;
  for (const video of [0, 1]) {
    const background = rgb(p.scrim).map(c => c * alpha + video * (1 - alpha));
    for (const ink of [p.ink, p.inkSecondary, p.inkQuiet, p.accent]) {
      expect(contrast(rgb(ink), background)).toBeGreaterThanOrEqual(4.5);
    }
    const trackAlpha = parseInt(p.track.slice(7), 16) / 255;
    const track = rgb(p.track).map((c, i) => c * trackAlpha + background[i]! * (1 - trackAlpha));
    expect(contrast(track, background)).toBeGreaterThanOrEqual(3);
  }
  expect(contrast(rgb(p.ink), rgb(p.inkInverse))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(rgb(p.accent), rgb(p.onAccent))).toBeGreaterThanOrEqual(4.5);
});

test('keeps legible skin inks and replaces dark, translucent and unknown inks', () => {
  const good = playerPalette({ ink: '#f5f1e9', accent: '#f2c27e' });
  expect(good.ink).toBe('#f5f1e9');
  expect(good.accent).toBe('#f2c27e');
  for (const ink of ['#1b2550', '#41245c', '#ffffff20', 'transparent']) {
    const safe = playerPalette({ ink, inkSecondary: ink, inkQuiet: ink, accent: ink });
    for (const key of ['ink', 'inkSecondary', 'inkQuiet', 'accent']) {
      expect(playerContrast(safe[key]!, '#0d0d0d')).toBeGreaterThanOrEqual(4.5);
    }
  }
});
