// vela-engine: the in-app half of per-engine builds. It keeps the loader's two keys
// current (the viewer's pick and the server default) and, in a single-engine build,
// hands the page to the engine the viewer or server now wants: it saves the route's
// scroll positions, dissolves to the page colour, and reloads the same URL, which the
// loader (tools/release) answers with the wanted engine's build. The arriving build
// restores those scroll positions and dissolves back in. A development build (empty
// `build`) only keeps the keys.

export interface EngineHandle { engine: true; overlay?: HTMLElement; leaving: boolean; disposed: boolean; restoring?: number }

const CHOSEN = 'vela.engine', DEFAULT = 'vela.engine.default', HANDOFF = 'vela.handoff';
const ENGINE = /^[a-z][a-z0-9-]{0,31}$/;
/** A hand-off record older than this is not this navigation's. */
const FRESH_MS = 15_000;

interface Props { build?: string; wanted?: string; chosen?: string; fallback?: string; settled?: boolean | string; still?: boolean | string }
interface Handoff { from: string; to: string; at: number; url: string; scroll: Record<string, number>; window: number }

const installed = (): string[] => {
  const list = (window as Window & { velaEngines?: unknown }).velaEngines;
  return Array.isArray(list) ? list.filter((e): e is string => typeof e === 'string' && ENGINE.test(e)) : [];
};
function store(key: string, value: string) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); } catch { /* Private mode: the loader falls back to cinematic. */ }
}
function readHandoff(): Handoff | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(HANDOFF) ?? 'null') as Handoff | null;
    return value && Date.now() - value.at < FRESH_MS ? value : undefined;
  } catch { return undefined; }
}
/** Every scrolled container that can be found again by its id. */
function scrollPositions(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[id]'))) if (el.scrollTop > 0 && el.id.length <= 80) out[el.id] = Math.round(el.scrollTop);
  return out;
}
function veil(still: boolean, from: number, to: number): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = `position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:${getComputedStyle(document.body).backgroundColor || '#090b0e'};opacity:${from}`;
  document.body.append(el);
  if (!still) el.animate([{ opacity: from }, { opacity: to }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
  else el.style.opacity = String(to);
  return el;
}

/** Hand-offs this tab made within the last minute; a third one is a loop, and the page stays put. */
const HOPS = 'vela.handoff.hops', HOP_WINDOW_MS = 60_000, MAX_HOPS = 2;
function recentHops(): number[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(HOPS) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((t): t is number => typeof t === 'number' && Date.now() - t < HOP_WINDOW_MS) : [];
  } catch { return []; }
}

function leave(handle: EngineHandle, from: string, to: string, still: boolean) {
  const earlier = readHandoff();
  // Never bounce straight back to the engine that just handed this page over.
  if (earlier && earlier.from === to && earlier.to === from) return;
  const hops = recentHops();
  if (hops.length >= MAX_HOPS) return;
  try { sessionStorage.setItem(HOPS, JSON.stringify([...hops, Date.now()])); } catch { /* Without session storage the bounce guard above still holds. */ }
  handle.leaving = true;
  const record: Handoff = { from, to, at: Date.now(), url: location.href, scroll: scrollPositions(), window: Math.round(scrollY) };
  try { sessionStorage.setItem(HANDOFF, JSON.stringify(record)); } catch { /* The new engine opens at the top. */ }
  handle.overlay = veil(still, 0, 1);
  setTimeout(() => location.replace(location.href), still ? 0 : 280);
}

/** The arriving engine: put each saved scroll back as its container appears, then dissolve in. */
function arrive(handle: EngineHandle, build: string, still: boolean) {
  const record = readHandoff();
  if (!record || record.to !== build || record.url !== location.href) return;
  handle.overlay = veil(true, 1, 1);
  const pending = new Map(Object.entries(record.scroll));
  const started = performance.now();
  const step = () => {
    if (handle.disposed) return;
    for (const [id, top] of pending) {
      const el = document.getElementById(id);
      if (el && el.scrollHeight - el.clientHeight >= top) { el.scrollTop = top; pending.delete(id); }
    }
    if (record.window && document.documentElement.scrollHeight - innerHeight >= record.window) { scrollTo(0, record.window); record.window = 0; }
    // Content arrives with the server's answers; stop waiting after two seconds.
    if ((pending.size || record.window) && performance.now() - started < 2000) { handle.restoring = requestAnimationFrame(step); return; }
    const overlay = handle.overlay;
    handle.overlay = undefined;
    if (!overlay) return;
    if (still) overlay.remove();
    else overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 320, easing: 'ease-out', fill: 'forwards' }).finished.then(() => overlay.remove(), () => overlay.remove());
  };
  handle.restoring = requestAnimationFrame(step);
}

function apply(handle: EngineHandle, json: string, first: boolean) {
  if (handle.leaving || handle.disposed) return;
  const p = JSON.parse(json) as Props;
  const build = ENGINE.test(p.build ?? '') ? p.build! : '';
  const still = p.still === true || p.still === 'true';
  if (first && build) arrive(handle, build, still);
  if (p.settled !== true && p.settled !== 'true') return;
  // The loader reads these on the next cold start, before any engine runs.
  store(CHOSEN, ENGINE.test(p.chosen ?? '') ? p.chosen! : '');
  if (ENGINE.test(p.fallback ?? '')) store(DEFAULT, p.fallback!);
  const wanted = p.wanted ?? '';
  if (build && ENGINE.test(wanted) && wanted !== build && installed().includes(wanted)) leave(handle, build, wanted, still);
}

export function createEngine(json: string): EngineHandle {
  const handle: EngineHandle = { engine: true, leaving: false, disposed: false };
  apply(handle, json, true);
  return handle;
}
export const setEngine = (handle: EngineHandle, json: string) => apply(handle, json, false);
export function destroyEngine(handle: EngineHandle) {
  handle.disposed = true;
  if (handle.restoring) cancelAnimationFrame(handle.restoring);
  if (!handle.leaving) handle.overlay?.remove();
}
