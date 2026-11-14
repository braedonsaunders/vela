// The server's appearance: its default skin, the owner's force flag and its installed
// runtime skin packs, with the viewer-level event stream that pushes changes live.
// Ether's equivalent is the Vela Apps card (docs/skin-distribution.md, "Ether side").
import type * as V from '../protocol/v0/types';

const harbor: V.SkinPack = {
  schema: 1, id: 'harbor', version: '1.0.0', name: 'Harbor', tagline: 'Sea-glass light over a night harbour.', engine: 'cinematic',
  palette: { page: '#06121a', raised: '#0e1c26', ink: '#eaf4f5', inkSecondary: '#a6bbc3', inkQuiet: '#7a8f99', inkInverse: '#08131a',
    accent: '#7fd6cb', ember: '#2a78a8', tide: '#139c8f', dusk: '#2f3c78', live: '#ff6b5e' },
  fonts: { display: { family: 'Harbor Display', sizeAdjust: 78, files: [{ url: '/vela/v0/appearance/packs/harbor/1.0.0/display.ttf', weight: 400, style: 'normal' }] } },
  radius: { card: 20, panel: 36, pill: 999 },
  images: { preview: '/vela/v0/appearance/packs/harbor/1.0.0/preview.svg', backdrop: '/vela/v0/appearance/packs/harbor/1.0.0/backdrop.svg', wordmark: '/vela/v0/appearance/packs/harbor/1.0.0/wordmark.svg' },
  swatches: ['#06121a', '#eaf4f5', '#7fd6cb', '#2a78a8', '#139c8f'],
};
const packs = [harbor];
const engines = ['cinematic', 'index', 'jellytwin', 'mochi', 'marquee', 'example'];
let state: V.Appearance = { revision: 1, defaultSkinId: 'cinematic', defaultEngineId: 'cinematic', force: false, packs };
const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
const encode = (a: V.Appearance) => new TextEncoder().encode(`id: ${a.revision}\ndata: ${JSON.stringify({ type: 'appearance', cursor: String(a.revision), appearance: a } satisfies V.ServerEvent)}\n\n`);

export const appearance = () => state;

/** The owner's change (Ether: the Apps card). Every connected viewer hears it at once. */
export function setAppearance(change: { defaultSkinId?: unknown; force?: unknown }): V.Appearance {
  const id = typeof change.defaultSkinId === 'string' ? change.defaultSkinId : state.defaultSkinId;
  const pack = packs.find(p => p.id === id);
  if (!pack && !engines.includes(id)) throw Response.json({ error: { class: 'request', code: 'unknown_skin', message: 'Not an installed engine or pack', retry: { allowed: false } } }, { status: 400 });
  state = { ...state, revision: state.revision + 1, defaultSkinId: id, defaultEngineId: pack ? pack.engine : id, force: typeof change.force === 'boolean' ? change.force : state.force };
  const frame = encode(state);
  for (const c of listeners) try { c.enqueue(frame); } catch { listeners.delete(c); }
  return state;
}

/** `GET /events`: the current appearance on connect, then each change. */
export function serverEvents(req: Request, authorized: () => boolean): Response {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const close = () => { if (heartbeat) clearInterval(heartbeat); if (controller) { listeners.delete(controller); try { controller.close(); } catch {} } };
  const stream = new ReadableStream<Uint8Array>({ start(c) {
    controller = c; listeners.add(c); c.enqueue(encode(state));
    heartbeat = setInterval(() => { if (!authorized()) close(); else c.enqueue(new TextEncoder().encode(': keepalive\n\n')); }, 15000);
    req.signal.addEventListener('abort', close, { once: true });
  }, cancel: close });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
}

const fontFile = new URL('../client/assets/fonts/mochi/Fredoka.ttf', import.meta.url);
const svg = (body: string, w: number, h: number) => new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000, immutable' } });
const sea = `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b2a3a"/><stop offset="1" stop-color="#06121a"/></linearGradient><radialGradient id="m" cx=".72" cy=".22" r=".5"><stop offset="0" stop-color="#7fd6cb" stop-opacity=".55"/><stop offset="1" stop-color="#7fd6cb" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><rect width="1600" height="1000" fill="url(#m)"/>${[0, 1, 2, 3, 4].map(i => `<path d="M0 ${620 + i * 70} C 300 ${580 + i * 70}, 500 ${680 + i * 70}, 800 ${630 + i * 70} S 1300 ${590 + i * 70}, 1600 ${640 + i * 70} V 1000 H 0 Z" fill="#139c8f" fill-opacity="${0.08 + i * 0.05}"/>`).join('')}`;

/** Pack assets: immutable per pack version, public like the appearance itself. */
export async function packAsset(path: string): Promise<Response | undefined> {
  const m = /^\/vela\/v0\/appearance\/packs\/([a-z0-9-]+)\/([0-9.]+)\/([a-z]+\.(?:svg|ttf))$/.exec(path);
  const pack = m && packs.find(p => p.id === m[1] && p.version === m[2]);
  if (!m || !pack) return undefined;
  if (m[3] === 'display.ttf') return new Response(Bun.file(fontFile), { headers: { 'Content-Type': 'font/ttf', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  if (m[3] === 'preview.svg') return svg(sea + `<rect x="90" y="120" width="620" height="44" rx="22" fill="#eaf4f5" fill-opacity=".9"/><rect x="90" y="190" width="420" height="22" rx="11" fill="#a6bbc3" fill-opacity=".7"/><rect x="90" y="250" width="180" height="56" rx="28" fill="#7fd6cb"/>${[0, 1, 2, 3, 4].map(i => `<rect x="${90 + i * 290}" y="720" width="260" height="160" rx="20" fill="#0e1c26" stroke="#7fd6cb" stroke-opacity=".25"/>`).join('')}`, 1600, 1000);
  if (m[3] === 'backdrop.svg') return svg(sea, 1600, 1000);
  if (m[3] === 'wordmark.svg') return svg(`<circle cx="40" cy="40" r="26" fill="none" stroke="#7fd6cb" stroke-width="6"/><path d="M40 18 V 62 M24 46 C 30 58, 50 58, 56 46" fill="none" stroke="#7fd6cb" stroke-width="6" stroke-linecap="round"/><text x="88" y="56" font-family="Georgia, serif" font-size="46" fill="#eaf4f5" letter-spacing="2">Harbor</text>`, 300, 80);
  return undefined;
}
