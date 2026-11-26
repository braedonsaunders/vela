// The pure half of ./platform.ts (tested without React Native).
import type { Platform } from '../../../protocol/skin';
import type { Viewport } from '../css';

/** A device's one platform: a TV first, then iOS and Android, then a desktop app or a browser. */
export function platformOf(os: string, isTV: boolean, desktop: boolean): Platform {
  if (isTV) return 'tv';
  if (os === 'ios') return 'ios';
  if (os === 'android') return 'android';
  return desktop ? 'desktop' : 'web';
}

/** Whether a foldable is held partly open (the `fold` form and variants). */
export const foldOpen = (viewport: Pick<Viewport, 'fold'>): boolean => !!viewport.fold && viewport.fold.posture !== 'flat';
