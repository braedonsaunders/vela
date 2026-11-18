/** Diagnostics are opt-in for device verification and do not schedule renders. */
export function guideRender(part: 'grid' | 'row' | 'marker') {
  if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return '';
  const root = globalThis as typeof globalThis & { __velaGuideRenders?: Record<string, number> };
  const counts = root.__velaGuideRenders ??= {};
  counts[part] = (counts[part] ?? 0) + 1;
  return JSON.stringify(counts);
}

