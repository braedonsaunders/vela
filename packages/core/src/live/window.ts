/** Fixed windows let adjacent viewports reuse both completed and in-flight requests. */
export function guideWindows(from: number, until: number, start: number, end: number, step = 3 * 3600000) {
  const windows: { from: number; until: number }[] = [];
  for (let at = Math.max(start, start + Math.floor((from - start) / step) * step); at < Math.min(end, until); at += step)
    windows.push({ from: at, until: Math.min(end, at + step) });
  return windows;
}
