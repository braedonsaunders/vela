/** Android TV uses density-independent points (often 960×540), while tvOS uses
 * a 1920×1080 canvas. Keep the skin's fixed lengths at the same fraction of the screen. */
export function tvPixelScale(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1.25;
  return 1.25 * Math.min(width / 1920, height / 1080);
}
