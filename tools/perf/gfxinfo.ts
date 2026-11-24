// Parse Android `dumpsys gfxinfo <package> framestats` (`PROFILEDATA` CSV blocks) and compute
// frame-time statistics (`p50`, `p95`, `max`, jank count > 16.67 ms at 60 Hz) for the TV perf
// harness (`tools/perf/tv-route.ts`).

export interface FrameSample {
  flags: number;
  intendedVsyncNs: number;
  vsyncNs: number;
  handleInputStartNs: number;
  animationStartNs: number;
  performTraversalsStartNs: number;
  drawStartNs: number;
  syncQueuedNs: number;
  syncStartNs: number;
  issueDrawCommandsStartNs: number;
  swapBuffersNs: number;
  frameCompletedNs: number;
  /** Total frame duration: `(FrameCompleted - IntendedVsync) / 1e6` in milliseconds. */
  totalMs: number;
  /** UI/traversal + draw duration: `(SyncQueued - HandleInputStart) / 1e6` in milliseconds. */
  uiMs: number;
  /** RenderThread / GPU duration: `(FrameCompleted - SyncStart) / 1e6` in milliseconds. */
  renderMs: number;
}

export interface FrameStatsSummary {
  count: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  meanMs: number;
  /** Frames exceeding the 60 Hz 16.67 ms budget. */
  jankCount: number;
  jankRatio: number;
  durationsMs: number[];
}

const NS_PER_MS = 1_000_000;
const JANK_BUDGET_MS = 16.67;

export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1));
  return Number(sortedValues[idx]!.toFixed(2));
}

/**
 * Parse the `---PROFILEDATA---` sections from `adb shell dumpsys gfxinfo <pkg> framestats`.
 *
 * Supports both the 14-column API 23+ `PROFILEDATA` layout and the 24-column Android 12+ / API 36
 * `FrameTimelineVsyncId` layout by matching column names from the `Flags,...` header line.
 */
export function parseGfxinfoFramestats(output: string): FrameSample[] {
  const lines = output.split(/\r?\n/);
  const samples: FrameSample[] = [];
  let inProfileData = false;
  let colMap: Record<string, number> | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '---PROFILEDATA---') {
      inProfileData = !inProfileData;
      if (!inProfileData) colMap = null;
      continue;
    }
    if (!inProfileData || !line) continue;

    const parts = line.split(',');
    if (parts[0] === 'Flags') {
      colMap = {};
      for (let i = 0; i < parts.length; i++) {
        const key = parts[i]!.trim();
        if (key) colMap[key] = i;
      }
      continue;
    }

    const idx = (name: string, fallback: number) => (colMap && colMap[name] !== undefined ? colMap[name]! : fallback);
    if (parts.length < 14) continue;

    const flags = Number(parts[idx('Flags', 0)]);
    const intendedVsyncNs = Number(parts[idx('IntendedVsync', 1)]);
    const vsyncNs = Number(parts[idx('Vsync', 2)]);
    const handleInputStartNs = Number(parts[idx('HandleInputStart', 5)]);
    const animationStartNs = Number(parts[idx('AnimationStart', 6)]);
    const performTraversalsStartNs = Number(parts[idx('PerformTraversalsStart', 7)]);
    const drawStartNs = Number(parts[idx('DrawStart', 8)]);
    const syncQueuedNs = Number(parts[idx('SyncQueued', 9)]);
    const syncStartNs = Number(parts[idx('SyncStart', 10)]);
    const issueDrawCommandsStartNs = Number(parts[idx('IssueDrawCommandsStart', 11)]);
    const swapBuffersNs = Number(parts[idx('SwapBuffers', 12)]);
    const frameCompletedNs = Number(parts[idx('FrameCompleted', 13)]);

    if (!Number.isFinite(flags) || !Number.isFinite(intendedVsyncNs) || !Number.isFinite(frameCompletedNs)) continue;
    if (intendedVsyncNs <= 0 || frameCompletedNs <= 0 || frameCompletedNs <= intendedVsyncNs) continue;
    const totalMs = (frameCompletedNs - intendedVsyncNs) / NS_PER_MS;
    if (totalMs <= 0 || totalMs > 5000) continue;

    const uiStart = handleInputStartNs > 0 ? handleInputStartNs : vsyncNs;
    const uiEnd = syncQueuedNs >= uiStart ? syncQueuedNs : frameCompletedNs;
    const uiMs = Math.max(0, (uiEnd - uiStart) / NS_PER_MS);
    const renderMs = syncStartNs > 0 && frameCompletedNs >= syncStartNs ? (frameCompletedNs - syncStartNs) / NS_PER_MS : 0;

    samples.push({
      flags,
      intendedVsyncNs,
      vsyncNs,
      handleInputStartNs,
      animationStartNs,
      performTraversalsStartNs,
      drawStartNs,
      syncQueuedNs,
      syncStartNs,
      issueDrawCommandsStartNs,
      swapBuffersNs,
      frameCompletedNs,
      totalMs: Number(totalMs.toFixed(2)),
      uiMs: Number(uiMs.toFixed(2)),
      renderMs: Number(renderMs.toFixed(2)),
    });
  }

  // Deduplicate identical (intendedVsyncNs, frameCompletedNs) if multiple windows report the same frame,
  // and sort chronologically by intendedVsyncNs.
  const seen = new Set<string>();
  const unique: FrameSample[] = [];
  for (const s of samples.sort((a, b) => a.intendedVsyncNs - b.intendedVsyncNs)) {
    const key = `${s.intendedVsyncNs}:${s.frameCompletedNs}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(s);
  }
  return unique;
}

export function summarizeFrames(samples: FrameSample[]): FrameStatsSummary {
  if (samples.length === 0) {
    return {
      count: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
      minMs: 0,
      meanMs: 0,
      jankCount: 0,
      jankRatio: 0,
      durationsMs: [],
    };
  }
  const durations = samples.map(s => s.totalMs);
  const sorted = [...durations].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const jankCount = sorted.filter(v => v > JANK_BUDGET_MS).length;
  return {
    count: sorted.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted[sorted.length - 1]!,
    minMs: sorted[0]!,
    meanMs: Number((sum / sorted.length).toFixed(2)),
    jankCount,
    jankRatio: Number((jankCount / sorted.length).toFixed(4)),
    durationsMs: durations,
  };
}

/**
 * Parse high-level `dumpsys gfxinfo <package>` summary lines when `PROFILEDATA` is empty
 * (e.g. `Total frames rendered: N`, `50th percentile: Xms`, `95th percentile: Yms`).
 */
export function parseGfxinfoSummaryFallback(output: string): { totalFrames: number; p50Ms: number; p95Ms: number; jankCount: number } {
  const totalMatch = /Total frames rendered:\s*(\d+)/i.exec(output);
  const jankMatch = /Janky frames:\s*(\d+)/i.exec(output);
  const p50Match = /50th percentile:\s*([\d.]+)ms/i.exec(output);
  const p95Match = /95th percentile:\s*([\d.]+)ms/i.exec(output);
  return {
    totalFrames: totalMatch ? Number(totalMatch[1]) : 0,
    jankCount: jankMatch ? Number(jankMatch[1]) : 0,
    p50Ms: p50Match ? Number(p50Match[1]) : 0,
    p95Ms: p95Match ? Number(p95Match[1]) : 0,
  };
}
