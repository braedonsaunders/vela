// Live watch, for the player chrome: the keys that flick channels and the surface that keeps
// listings fresh while a channel plays. What the viewer is told about delivery is live-notices.ts;
// the player bar draws both inline with its other controls (widgets/player/live).
import type { LiveController } from './controller';
import { useLiveSurface } from './live';

const ZAP_KEYS: Record<string, -1 | 1> = {
  ArrowUp: -1,
  PageUp: -1,
  ChannelUp: -1,
  ArrowDown: 1,
  PageDown: 1,
  ChannelDown: 1,
};

/**
 * Live watch's keys: up and down (and the remote's channel keys) dial a channel, Enter tunes the
 * dialled one at once and Escape forgets it. Returns whether the key was taken. The watch screen
 * holds its surface open with useLiveWatch while it is focused.
 */
export function liveWatchKey(controller: LiveController, key: string, playingId: string, dialling: boolean): boolean {
  const step = ZAP_KEYS[key];
  if (step !== undefined) {
    controller.zapWatch(step, playingId);
    return true;
  }
  if (dialling && key === 'Enter') {
    controller.commitWatchZap();
    return true;
  }
  if (dialling && key === 'Escape') {
    controller.cancelWatchZap();
    return true;
  }
  return false;
}

/** Keeps live watch's surface open (clock, listings, flicking) while the watch screen is focused. */
export function useLiveWatch(focused: boolean): void {
  useLiveSurface('watch', focused);
}
