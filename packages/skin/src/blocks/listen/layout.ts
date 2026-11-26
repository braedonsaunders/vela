// Which form the music app takes: TV (a remote and a focus engine, read from across the room),
// compact (phones, tablets upright: touch), or wide (Your Library beside the page: pointer and
// keyboard, a landscape tablet, an unfolded iPhone Duo).
import { Platform } from 'react-native';
import type { MediaLook } from '../../widgets/media/parts';
import { wideMusic } from '../../widgets/media/window-layout';

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

/** Compact layouts (phones, tablets upright, a folded iPhone Duo) stack headers and drop the album
 * column; a landscape window from 840 px (an unfolded iPhone Duo) or any from 980 px is wide. */
export const compactMusic = (m: MediaLook) => !musicTV() && !wideMusic(m.width, m.height);
