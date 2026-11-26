const MARGIN = 16;

export function revealOffset(y: number, targetHeight: number, offset: number, height: number, topBar: number, full: boolean): number | undefined {
  const clear = topBar + MARGIN;
  if (y - offset < clear) return Math.max(0, y - clear);
  const bottom = y + targetHeight + MARGIN;
  if (full && bottom > offset + height) return Math.min(y - clear, bottom - height);
  return undefined;
}
