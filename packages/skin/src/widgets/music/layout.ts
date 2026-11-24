// Which form the music app takes: TV (a remote and a focus engine, read from across the room),
// compact (phones, tablets upright: touch), or wide (pointer and keyboard).
import { Platform } from 'react-native';
import type { MediaLook } from '../media/parts';

/** Previewing the TV form in a development web build: `?musictv=1` (kept for the tab; `?musictv=0`
 * ends it). Layout only. */
function previewTV(): boolean {
  if (Platform.OS !== 'web' || typeof __DEV__ === 'undefined' || !__DEV__) return false;
  if (typeof location === 'undefined' || typeof sessionStorage === 'undefined') return false;
  const asked = new URLSearchParams(location.search).get('musictv');
  if (asked !== null) sessionStorage.setItem('vela.musictv', asked);
  return sessionStorage.getItem('vela.musictv') === '1';
}

/** A TV: decided by the platform, never by width (an Android TV is ~960dp wide). */
export function musicTV(): boolean {
  return Platform.isTV || previewTV();
}

/** Compact layouts (phones, tablets upright) stack headers and drop the album column. */
export const compactMusic = (m: MediaLook) => !musicTV() && m.width < 980;
