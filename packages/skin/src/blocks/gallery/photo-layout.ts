/** Keep the preferred stage height while leaving enough room for the whole caption. */
export function photoStageHeight(preferred: number, gap: number, viewport?: number, caption?: number): number {
  if (viewport === undefined || caption === undefined) return preferred;
  return Math.min(preferred, Math.max(0, Math.floor(viewport - caption - gap - 12)));
}
