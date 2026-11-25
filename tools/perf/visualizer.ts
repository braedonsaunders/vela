// Summarize one isolated Android TV run. See README.md for the three capture windows.
import { readFileSync } from 'node:fs';
import { parseGfxinfoFramestats, summarizeFrames } from './gfxinfo';
import { PERF_BUDGETS } from './tv-route';

export function visualizerPerf(log: string, focusDump: string, steadyDump: string) {
  const presentations = Array.from(log.matchAll(/\bfirstFrame scene=([\w-]+) elapsedMs=(\d+(?:\.\d+)?)/g),
    match => ({ scene: match[1]!, elapsedMs: Number(match[2]) }));
  const focusFrames = parseGfxinfoFramestats(focusDump);
  const steadyFrames = parseGfxinfoFramestats(steadyDump);
  const focus = summarizeFrames(focusFrames);
  const all = [...focusFrames, ...steadyFrames];
  const uiMaxMs = all.length ? Math.max(...all.map(frame => frame.uiMs)) : null;
  const longUiFrames = all.filter(frame => frame.uiMs > 1000 / 60).length;
  const measured = presentations.length > 0 && focus.count > 0 && steadyFrames.length > 0;
  return {
    measured, presentations, focusFrames: focus.count, focusP95Ms: focus.count ? focus.p95Ms : null,
    steadyUiFrames: steadyFrames.length, uiMaxMs, longUiFrames,
    pass: measured && presentations.every(p => p.elapsedMs <= PERF_BUDGETS.firstFrameMs)
      && focus.p95Ms <= PERF_BUDGETS.focusMoveP95Ms && longUiFrames === 0,
  };
}

if (import.meta.main) {
  const files = process.argv.slice(2);
  if (files.length !== 3) throw new Error('Usage: bun tools/perf/visualizer.ts first-frame.log focus.gfxinfo steady.gfxinfo');
  const [log, focus, steady] = files.map(file => readFileSync(file, 'utf8')) as [string, string, string];
  const result = visualizerPerf(log, focus, steady);
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
}
