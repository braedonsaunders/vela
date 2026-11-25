import { useEffect, useRef } from 'react';
import { entryBudget, softwareRenderer } from '../../../../packages/visualizer/web/frame-budget';
import type { SceneRenderer } from '../../../../packages/visualizer/web/renderer';
import { musicOutput, observeMusicOutput, subscribeMusicOutput } from './music-output.web';
import type { StageProps } from './stage-types';

let gpuUnavailable = false;
const gpuListeners = new Set<() => void>();
const overEntryBudget = entryBudget();
export function canVisualize() {
  return typeof WebGL2RenderingContext !== 'undefined' && !gpuUnavailable && musicOutput().kind === 'ready';
}
export const canOpenVisualizer = canVisualize;
export function beginVisualizerFullscreen() {}
export function subscribeVisualizerAvailability(listener: () => void) {
  const unsubscribe = subscribeMusicOutput(listener);
  gpuListeners.add(listener);
  return () => { unsubscribe(); gpuListeners.delete(listener); };
}

type Surface = { canvas: HTMLCanvasElement; renderer: SceneRenderer; cancelEntry(): void; close(): void };
let diagnostics: (() => unknown) | undefined;
function webVisualizerDiagnostics() { return diagnostics?.() ?? null; }

function tint(value?: string) {
  if (!value || !/^#[\da-f]{6}$/i.test(value)) return null;
  return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
}

/** Poll without blocking the application thread. Page suspension or loss of visibility invalidates
 * the measurement. The clock starts after the scene module is in memory. */
function timeFirstFrame(gl: WebGL2RenderingContext, started: number, visible: () => boolean, measured: (ms: number) => void) {
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!fence) return () => {};
  gl.flush();
  let id = 0, last = performance.now(), finished = false;
  function cancel() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(id);
    gl.deleteSync(fence);
  }
  function poll() {
    const now = performance.now();
    if (!visible() || now - last > 250) { cancel(); return; }
    last = now;
    const state = gl.clientWaitSync(fence!, 0, 0);
    const elapsed = now - started;
    if (state === gl.TIMEOUT_EXPIRED && elapsed <= 1600) {
      id = requestAnimationFrame(poll);
      return;
    }
    cancel();
    if (state !== gl.WAIT_FAILED) measured(elapsed);
  }
  id = requestAnimationFrame(poll);
  return cancel;
}

function attachStage(container: HTMLDivElement, options: StageProps) {
  let closed = false;
  let current: Surface | undefined, retiring: Surface | undefined;
  let frame = 0, finish = 0, previous = 0, generation = 0;
  let creating = false, failed = false, onscreen = true, suspended = false;
  let tap: ReturnType<typeof observeMusicOutput> | undefined, tapped: AudioNode | null = null;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = matchMedia('(pointer: coarse)');
  const constrained = () => options.mode === 'background' || coarse.matches || (navigator as Navigator & { connection?: { saveData: boolean } }).connection?.saveData === true;
  let limit30 = false;
  const period = () => 1000 / (constrained() || limit30 ? 30 : 60);
  let rect = container.getBoundingClientRect();
  function size() {
    const pixels = options.mode === 'background' ? 600_000 : constrained() ? 900_000 : 2_073_600;
    const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(pixels / Math.max(1, rect.width * rect.height)));
    return [Math.max(2, Math.round(rect.width * ratio)), Math.max(2, Math.round(rect.height * ratio))] as const;
  }
  function stop() {
    cancelAnimationFrame(frame); frame = 0; previous = 0;
    tap?.close(); tap = undefined; tapped = null;
    current?.renderer.resetBudget();
  }
  function report() {
    stop();
    if (failed || closed) return;
    failed = true;
    gpuUnavailable = true;
    for (const listener of gpuListeners) listener();
    retire(); current?.close(); current = undefined;
    options.onUnavailable();
  }
  function tick(now: number) {
    frame = 0;
    if (!current || !tap || closed) return;
    if (!previous || now - previous >= period() - 1.2) {
      const dt = previous ? (now - previous) / 1000 : period() / 1000;
      previous = now;
      try {
        const decision = current.renderer.frame(dt, tap.sample(performance.now()), period() / 1000);
        if (decision === 'disable') { report(); return; }
        if (decision === 'limit30') limit30 = true;
      } catch { report(); return; }
    }
    frame = requestAnimationFrame(tick);
  }
  const visible = () => options.active && !document.hidden && !suspended && onscreen && rect.width > 1 && rect.height > 1;
  function retire() {
    clearTimeout(finish); retiring?.close(); retiring = undefined;
  }
  async function create() {
    const token = ++generation;
    creating = true;
    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', position: 'absolute', inset: '0', display: 'block', pointerEvents: 'none' });
    canvas.setAttribute('aria-hidden', 'true');
    let gl: WebGL2RenderingContext | null = null;
    const lose = () => gl?.getExtension('WEBGL_lose_context')?.loseContext();
    const lost = () => { if (!closed && current?.canvas === canvas) report(); };
    try {
      const { createRenderer } = await import('../../../../packages/visualizer/web/renderer');
      if (closed || token !== generation || !visible()) return;
      const started = performance.now();
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false, failIfMajorPerformanceCaveat: true, powerPreference: constrained() ? 'low-power' : 'high-performance' });
      if (!gl || !gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('OES_texture_float_linear')) {
        throw new Error('WebGL2 floating-point targets unavailable');
      }
      const adapter = gl.getExtension('WEBGL_debug_renderer_info');
      if (adapter && softwareRenderer(String(gl.getParameter(adapter.UNMASKED_RENDERER_WEBGL)))) throw new Error('Software rendering');
      const [width, height] = size();
      const renderer = createRenderer(canvas, gl, { width, height, sceneId: options.sceneId, constrained: constrained(),
        measure: typeof __DEV__ !== 'undefined' && __DEV__, analysisRange: { minDecibels: -92, maxDecibels: -18 } });
      renderer.tint(tint(options.artworkTint) ?? tint(options.accent));
      renderer.frame(1 / 60, null, period() / 1000);
      const cancelEntry = timeFirstFrame(gl, started, visible, milliseconds => {
        if (current?.canvas === canvas && overEntryBudget(milliseconds)) report();
      });
      current = { canvas, renderer, cancelEntry, close() { cancelEntry(); canvas.removeEventListener('webglcontextlost', lost); canvas.remove(); lose(); } };
      canvas.addEventListener('webglcontextlost', lost);
      container.appendChild(canvas);
      if (retiring && !options.still && !motion.matches) {
        canvas.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 240 });
        finish = window.setTimeout(retire, 260);
      } else retire();
    } catch { lose(); if (token === generation) report(); }
    finally { if (token === generation) { creating = false; if (!closed && current && !failed) sync(); } }
  }
  function sync() {
    if (closed || failed) return;
    const output = musicOutput();
    if (!visible() || output.kind !== 'ready') { current?.cancelEntry(); stop(); return; }
    if (!current) { if (!creating) void create(); return; }
    if (options.still || motion.matches || !output.playing || !output.node) { stop(); return; }
    if (tapped !== output.node) {
      stop();
      try { tap = observeMusicOutput(output.node); tapped = output.node; }
      catch { report(); return; }
    }
    if (!frame) frame = requestAnimationFrame(tick);
  }
  const resize = () => {
    rect = container.getBoundingClientRect();
    if (current && visible()) {
      try {
        current.renderer.resize(...size());
        if (!frame) current.renderer.frame(0, null, period() / 1000);
      } catch { report(); return; }
    }
    sync();
  };
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(container);
  const intersection = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
    onscreen = entry?.isIntersecting ?? false; sync();
  }) : null;
  intersection?.observe(container);
  window.addEventListener('resize', resize);
  const suspend = () => { suspended = true; sync(); };
  const resume = () => { suspended = false; sync(); };
  document.addEventListener('freeze', suspend);
  document.addEventListener('resume', resume);
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  const unsubscribe = subscribeMusicOutput(sync);
  const stats = () => ({ ...current?.renderer.stats(), animating: !!frame, observingAudio: !!tap,
    visible: visible(), targetFps: 1000 / period() });
  diagnostics = stats;
  if (typeof __DEV__ !== 'undefined' && __DEV__) Object.assign(window, { __velaVisualizer: webVisualizerDiagnostics });
  sync();
  return {
    update(next: StageProps) {
      const changed = next.sceneId !== options.sceneId || next.mode !== options.mode;
      const recolor = next.accent !== options.accent || next.artworkTint !== options.artworkTint;
      options = next;
      if (changed) {
        generation++; creating = false; failed = false; limit30 = false; stop();
        if (current) { current.cancelEntry(); retire(); retiring = current; current = undefined; }
      } else if (recolor && current) {
        current.renderer.tint(tint(options.artworkTint) ?? tint(options.accent));
        if (!frame && visible()) current.renderer.frame(0, null, period() / 1000);
      }
      sync();
    },
    close() {
      closed = true; generation++;
      unsubscribe(); observer?.disconnect(); intersection?.disconnect();
      window.removeEventListener('resize', resize); document.removeEventListener('visibilitychange', sync);
      document.removeEventListener('freeze', suspend); document.removeEventListener('resume', resume);
      motion.removeEventListener('change', sync);
      stop(); retire(); current?.close(); current = undefined;
      if (diagnostics === stats) {
        diagnostics = undefined;
        if (typeof __DEV__ !== 'undefined' && __DEV__) delete (window as Window & { __velaVisualizer?: unknown }).__velaVisualizer;
      }
    },
  };
}

export function VisualizerStage(props: StageProps) {
  const element = useRef<HTMLDivElement>(null);
  const controller = useRef<ReturnType<typeof attachStage> | null>(null);
  const initial = useRef(props);
  useEffect(() => {
    if (!element.current) return;
    const stage = attachStage(element.current, initial.current);
    controller.current = stage;
    return () => { stage.close(); controller.current = null; };
  }, []);
  useEffect(() => { controller.current?.update(props); }, [props]);
  return <div ref={element} aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />;
}
