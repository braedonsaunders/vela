/** Leave most of a short clip intact, while skipping a normal trailer's rating card/logos. */
export function previewStart(requested: number | undefined, duration: number): number {
  const offset = requested !== undefined && Number.isFinite(requested) ? Math.max(0, requested) : 0;
  return Number.isFinite(duration) && duration > 0 ? Math.min(offset, duration / 4) : offset;
}
