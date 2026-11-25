import { expect, test } from 'bun:test';
import { liveReturnsToEdge, stopsInBackground } from '../src/widgets/player/background';

test('a playing iPhone or iPad watch keeps its session in the background; a paused one stops', () => {
  expect(stopsInBackground({ os: 'ios', tv: false }, false)).toBe(false);
  expect(stopsInBackground({ os: 'ios', tv: false }, true)).toBe(true);
});

test('Apple TV and Android stop as they leave the foreground, playing or not; the web never does', () => {
  for (const paused of [false, true]) {
    expect(stopsInBackground({ os: 'ios', tv: true }, paused)).toBe(true);
    expect(stopsInBackground({ os: 'android', tv: false }, paused)).toBe(true);
    expect(stopsInBackground({ os: 'android', tv: true }, paused)).toBe(true);
    expect(stopsInBackground({ os: 'web', tv: false }, paused)).toBe(false);
  }
});

test('a live channel back in the foreground plays at the live edge; one the viewer paused waits where it was', () => {
  expect(liveReturnsToEdge(false)).toBe(true);
  expect(liveReturnsToEdge(true)).toBe(false);
});
