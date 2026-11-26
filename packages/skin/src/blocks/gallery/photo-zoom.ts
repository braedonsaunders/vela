export interface PhotoPoint { x: number; y: number }
export interface PhotoSize { width: number; height: number }
export interface PhotoZoom extends PhotoPoint { scale: number }

export const FIT_PHOTO: PhotoZoom = Object.freeze({ scale: 1, x: 0, y: 0 });
const MAX_ZOOM = 5;

export function fitPhoto(viewport: PhotoSize, ratio: number | undefined): PhotoSize {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return viewport;
  const width = Math.min(viewport.width, viewport.height * ratio);
  return { width, height: width / ratio };
}

function clamp(value: number, limit: number): number {
  return limit > 0 ? Math.min(limit, Math.max(-limit, value)) : 0;
}

/** Letterboxed axes stay centred until the enlarged photo can fill them. */
export function clampPhotoZoom(pose: PhotoZoom, viewport: PhotoSize, ratio: number | undefined): PhotoZoom {
  const scale = Number.isFinite(pose.scale) ? Math.min(MAX_ZOOM, Math.max(1, pose.scale)) : 1;
  if (scale === 1) return FIT_PHOTO;
  const fit = fitPhoto(viewport, ratio);
  return {
    scale,
    x: clamp(pose.x, (fit.width * scale - viewport.width) / 2),
    y: clamp(pose.y, (fit.height * scale - viewport.height) / 2),
  };
}

/** Keep the image pixel under the original focal point under the new focal point, where bounds allow. */
export function zoomPhoto(pose: PhotoZoom, scale: number, from: PhotoPoint, to: PhotoPoint, viewport: PhotoSize, ratio?: number): PhotoZoom {
  const factor = Math.min(MAX_ZOOM, Math.max(1, scale)) / pose.scale;
  const centerX = viewport.width / 2;
  const centerY = viewport.height / 2;
  return clampPhotoZoom({
    scale,
    x: to.x - centerX - (from.x - centerX - pose.x) * factor,
    y: to.y - centerY - (from.y - centerY - pose.y) * factor,
  }, viewport, ratio);
}

export function doubleTapPhoto(pose: PhotoZoom, point: PhotoPoint, viewport: PhotoSize, ratio?: number): PhotoZoom {
  return pose.scale > 1 ? FIT_PHOTO : zoomPhoto(pose, 2, point, point, viewport, ratio);
}

export function photoCanSwipe(start: PhotoZoom, current: PhotoZoom, pinched: boolean): boolean {
  return !pinched && start.scale === 1 && current.scale === 1;
}
