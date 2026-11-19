/** Diagnostics are opt-in for device verification and do not schedule renders. */
export function previewFailure(operation: 'tune' | 'stop', error: unknown) {
  const value = error as { status?: number; detail?: { code?: string } };
  const code = value?.detail?.code;
  console.warn('Vela preview', operation, typeof value?.status === 'number' ? value.status : 0,
    typeof code === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(code) ? code : 'unknown');
}

export function guideRender(part: 'grid' | 'row' | 'marker' | 'cell' | 'drawing') {
  if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return '';
  const root = globalThis as typeof globalThis & { __velaGuideRenders?: Record<string, number> };
  const counts = root.__velaGuideRenders ??= {};
  counts[part] = (counts[part] ?? 0) + 1;
  return part === 'marker' ? JSON.stringify(counts) : '';
}

/** JS animation-frame intervals; these are not compositor/GPU frame timings. */
export function startGuideFrames() {
  if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return;
  let frame = 0, last = 0;
  const intervals: number[] = [];
  const sample = (now: number) => {
    if (last && intervals.length < 12000) intervals.push(now - last);
    last = now;
    frame = requestAnimationFrame(sample);
  };
  frame = requestAnimationFrame(sample);
  const native = (globalThis as typeof globalThis & { __velaGuideUIFrames?: (enabled: boolean) => Promise<unknown> }).__velaGuideUIFrames;
  void native?.(true);
  const timer = setInterval(async () => {
    const sorted = intervals.splice(0).sort((a, b) => a - b);
    const root = globalThis as typeof globalThis & { __velaGuideRenders?: Record<string, number> };
    const metrics = JSON.stringify({ frames: sorted.length, p95: sorted[Math.floor(sorted.length * .95)] ?? 0,
      max: sorted.at(-1) ?? 0, over33: sorted.filter(ms => ms > 33.4).length, renders: root.__velaGuideRenders,
      selection: (globalThis as typeof globalThis & { __velaGuideSelection?: object }).__velaGuideSelection,
      focus: (globalThis as typeof globalThis & { __velaGuideFocus?: string }).__velaGuideFocus,
      requests: (globalThis as typeof globalThis & { __velaGuideQueries?: number }).__velaGuideQueries ?? 0,
      ui: await native?.(true) });
    console.info('Vela guide metrics', metrics);
    const report = process.env.EXPO_PUBLIC_VELA_GUIDE_REPORT_URL;
    if (report) void fetch(report, { method: 'POST', body: metrics }).catch(() => {});
  }, 10000);
  return () => { clearInterval(timer); cancelAnimationFrame(frame); void native?.(false); };
}

export function guideSelection(channel: string, programme: string) {
  if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return;
  (globalThis as typeof globalThis & { __velaGuideSelection?: object }).__velaGuideSelection = { channel, programme, at: Date.now() };
}

/** Only transport codes and safe property names leave the device; never a request or credential. */
export function guideFailure(error: unknown) {
  if (process.env.EXPO_PUBLIC_VELA_GUIDE_DIAGNOSTICS !== '1') return;
  const value = error as { name?: string; message?: string; status?: number; detail?: { code?: string } };
  const property = value?.name === 'TypeError' ? /(?:reading|property) ['"]([a-zA-Z][a-zA-Z0-9_]*)['"]/.exec(value.message ?? '')?.[1] : undefined;
  const safe = (text: unknown) => typeof text === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(text) ? text : undefined;
  const failure = { name: safe(value?.name), status: typeof value?.status === 'number' ? value.status : undefined, code: safe(value?.detail?.code), property };
  const report = process.env.EXPO_PUBLIC_VELA_GUIDE_REPORT_URL;
  if (report) void fetch(report, { method: 'POST', body: JSON.stringify({ failure }) }).catch(() => {});
}
