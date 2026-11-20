/** Pixel offsets for measured rows, with the same gap between measured and estimated rows. */
export function gridOffsets(rows: number, heights: ReadonlyMap<number, number>, estimate: number, gap: number): number[] {
  const offsets = [0];
  for (let i = 0; i < rows; i++) {
    offsets.push(offsets[i]! + (heights.get(i) ?? estimate) + (i + 1 < rows ? gap : 0));
  }
  return offsets;
}

export function gridRowAt(offsets: readonly number[], y: number): number {
  let lo = 0, hi = Math.max(0, offsets.length - 2);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid]! <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function gridWindow(offsets: readonly number[], top: number, height: number, buffer = 2) {
  const rows = offsets.length - 1;
  if (!rows || top + height < 0 || top > offsets[rows]!) return { start: 0, end: 0 };
  return {
    start: Math.max(0, gridRowAt(offsets, top) - buffer),
    end: Math.min(rows, gridRowAt(offsets, top + height) + buffer + 1),
  };
}
