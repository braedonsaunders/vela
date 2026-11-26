import type { CaptionInsets } from '@vela/player-api';

export interface CaptionRect { left: number; top: number; right: number; bottom: number }

const GAP = 10;

/** Keep the full line box out of the chrome, including its outline or background. Coordinates
 * are relative to the stage. A narrow side panel leaves a column; a wide panel leaves a band. */
export function captionInsets(
  picture: CaptionRect, visibleVideo: CaptionRect, controlsTop: number, panels: readonly CaptionRect[] = [],
): CaptionInsets {
  const video = { ...visibleVideo, bottom: Math.min(visibleVideo.bottom, controlsTop - GAP) };
  // The controls may start in the lower half of a tabletop, wholly outside the picture.
  video.bottom = Math.max(video.top + 1, video.bottom);
  for (const panel of panels) {
    if (panel.top >= video.bottom || panel.bottom <= video.top ||
        panel.left >= video.right || panel.right <= video.left) continue;
    const leading = panel.left - GAP - video.left;
    const trailing = video.right - panel.right - GAP;
    const width = video.right - video.left;
    if (leading >= width * 0.45 && leading >= trailing) video.right = panel.left - GAP;
    else if (trailing >= width * 0.45) video.left = panel.right + GAP;
    else if (panel.top - video.top >= video.bottom - panel.bottom) {
      video.bottom = Math.max(video.top + 1, panel.top - GAP);
    } else {
      video.top = Math.min(video.bottom - 1, panel.bottom + GAP);
    }
  }
  return {
    left: Math.max(0, video.left - picture.left),
    right: Math.max(0, picture.right - video.right),
    top: Math.max(0, video.top - picture.top),
    bottom: Math.max(0, picture.bottom - video.bottom),
  };
}

export const CAPTION_MOVE_MS = 520;

export function moveCaptionInsets(from: CaptionInsets, to: CaptionInsets, progress: number): CaptionInsets {
  const t = 1 - (1 - Math.max(0, Math.min(1, progress))) ** 3;
  return {
    left: from.left + (to.left - from.left) * t,
    right: from.right + (to.right - from.right) * t,
    top: from.top + (to.top - from.top) * t,
    bottom: from.bottom + (to.bottom - from.bottom) * t,
  };
}
