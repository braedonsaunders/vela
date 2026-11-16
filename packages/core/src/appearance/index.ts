// The server's appearance as the foundation sees it: the default skin, the owner's
// force flag and each installed runtime skin pack, validated here so nothing a pack
// carries reaches the page except colours, lengths and same-origin asset URLs.
import type { Appearance, PackFont, ServerEvent, SkinDocumentRef, SkinPack } from '../wire';
import type { EventHandler } from '../protocol/sse';

/** Compiled engines a pack may style. A pack for any other engine is not offered. */
const ENGINES = ['cinematic'];
const COLOUR = /^#[0-9a-f]{6}([0-9a-f]{2})?$/;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const TOKEN = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/;
const MAX_PACK_BYTES = 65536;

export interface PackEntryModel { id: string; name: string; tagline: string; engine: string; preview: string; backdrop: string; wordmark: string; swatches: string[]; packJson: string }
export interface DocEntryModel { id: string; name: string; tagline: string; url: string; preview: string; swatches: string[] }
export interface AppearanceModel { revision: number; defaultSkinId: string; defaultEngineId: string; force: boolean; packs: PackEntryModel[]; docs: DocEntryModel[] }

const text = (v: unknown, max: number): string => typeof v === 'string' && v.length <= max ? v : '';
const colour = (v: unknown): string | undefined => typeof v === 'string' && COLOUR.test(v) ? v : undefined;
function colours(v: unknown, max: number, keys: RegExp): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, c] of Object.entries(v).slice(0, max)) { const ok = colour(c); if (ok && keys.test(k)) out[k] = ok; }
  return out;
}
/** A pack asset: same origin, under the appearance tree, nothing else. */
function asset(v: unknown, origin: string, ext: RegExp): string {
  if (typeof v !== 'string' || v.length > 300) return '';
  let url: URL;
  try { url = new URL(v, `${origin}/`); } catch { return ''; }
  return url.origin === origin && url.pathname.startsWith('/vela/v0/appearance/') && ext.test(url.pathname) && !url.search && !url.hash ? url.href : '';
}
const length = (v: unknown, max: number): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : undefined;
function font(v: PackFont | undefined, origin: string) {
  if (!v || typeof v.family !== 'string' || !/^[A-Za-z0-9 ]{1,48}$/.test(v.family) || !Array.isArray(v.files)) return undefined;
  const files = v.files.slice(0, 4).flatMap(f => {
    const url = asset(f?.url, origin, /\.(woff2|woff|ttf|otf)$/);
    const weight = length(f?.weight, 1000);
    return url && weight && (f.style === 'normal' || f.style === 'italic') ? [{ url, weight, style: f.style }] : [];
  });
  const sizeAdjust = typeof v.sizeAdjust === 'number' && v.sizeAdjust >= 50 && v.sizeAdjust <= 150 ? Math.round(v.sizeAdjust) : 100;
  return files.length ? { family: v.family, files, sizeAdjust } : undefined;
}

/** A built-in skin document's file: same origin, under /vela/skins/. */
function builtInAsset(v: unknown, origin: string, ext: RegExp): string {
  if (typeof v !== 'string' || v.length > 300) return '';
  let url: URL;
  try { url = new URL(v, `${origin}/`); } catch { return ''; }
  return url.origin === origin && url.pathname.startsWith('/vela/skins/') && ext.test(url.pathname) && !url.search && !url.hash ? url.href : '';
}

/** One pack as the page may apply it, or nothing when any required part is invalid. */
function pack(p: SkinPack, origin: string): PackEntryModel | undefined {
  if (!p || p.schema !== 1 || typeof p.id !== 'string' || !NAME.test(p.id) || ENGINES.includes(p.id) || !ENGINES.includes(p.engine)) return undefined;
  if (JSON.stringify(p).length > MAX_PACK_BYTES) return undefined;
  const name = text(p.name, 40);
  const palette = colours(p.palette, 32, /^[a-zA-Z]{1,24}$/);
  if (!name || !Object.keys(palette).length) return undefined;
  const radius = { card: length(p.radius?.card, 48), panel: length(p.radius?.panel, 48), pill: length(p.radius?.pill, 999) };
  const fonts = { display: font(p.fonts?.display, origin), text: font(p.fonts?.text, origin) };
  const image = /\.(svg|png|jpe?g|webp|avif)$/;
  const swatches = (Array.isArray(p.swatches) ? p.swatches : []).slice(0, 5).flatMap(c => colour(c) ?? []);
  const canonical = { id: p.id, origin, version: text(p.version, 32), engine: p.engine, palette, tokens: colours(p.tokens, 256, TOKEN), fonts, radius };
  return { id: p.id, name, tagline: text(p.tagline, 120), engine: p.engine, preview: asset(p.images?.preview, origin, image), backdrop: asset(p.images?.backdrop, origin, image),
    wordmark: asset(p.images?.wordmark, origin, image), swatches, packJson: JSON.stringify(canonical) };
}

/** The release's own skin documents (/vela/skins/catalog.json): none in a development build.
 * A document needing a newer renderer than this client draws is not offered. */
let builtIn: Promise<SkinDocumentRef[]> | undefined;
let builtInList: SkinDocumentRef[] = [];
export function builtInDocuments(origin: string, rendererVersion: number): Promise<SkinDocumentRef[]> {
  type Listed = SkinDocumentRef & { renderer?: number };
  builtIn ??= fetch(`${origin}/vela/skins/catalog.json`)
    .then(response => (response.ok ? response.json() : { documents: [] }))
    .then((catalog: { documents?: Listed[] }) => {
      const listed = Array.isArray(catalog?.documents) ? catalog.documents : [];
      return listed.filter(d => typeof d?.renderer === 'number' && d.renderer <= rendererVersion).slice(0, 32);
    })
    .catch(() => [])
    .then(list => (builtInList = list));
  return builtIn;
}

export function appearanceModel(a: Appearance, origin: string, builtInDocs: SkinDocumentRef[] = []): AppearanceModel {
  if (!a || typeof a.revision !== 'number' || typeof a.defaultSkinId !== 'string') throw new Error('Invalid appearance');
  const packs = (Array.isArray(a.packs) ? a.packs.slice(0, 32) : []).flatMap(p => pack(p, origin) ?? []);
  // The server's documents, then the release's built-ins it does not replace.
  const server = Array.isArray(a.documents) ? a.documents.slice(0, 32) : [];
  const docs = [...server, ...builtInDocs.filter(b => !server.some(d => d?.id === b.id))].flatMap(d => {
    const url = asset(d?.url, origin, /\.json$/) || builtInAsset(d?.url, origin, /\/document\.json$/);
    return d && typeof d.id === 'string' && NAME.test(d.id) && !ENGINES.includes(d.id) && url ? [{ id: d.id, name: text(d.name, 40), tagline: text(d.tagline, 120), url,
      preview: asset(d.preview, origin, /\.(svg|png|jpe?g|webp|avif)$/) || builtInAsset(d.preview, origin, /\.(svg|png|jpe?g|webp|avif)$/), swatches: (Array.isArray(d.swatches) ? d.swatches : []).slice(0, 5).flatMap(c => colour(c) ?? []) }] : [];
  });
  return { revision: a.revision, defaultSkinId: text(a.defaultSkinId, 64), defaultEngineId: text(a.defaultEngineId, 64), force: a.force === true, packs, docs };
}

/** One connection to the viewer's events: each `appearance` event's model goes to `onAppearance`;
 * an older revision than the newest seen (or `floor`) is ignored. */
export function followAppearance(
  origin: string,
  open: (onEvent: EventHandler) => Promise<void>,
  floor: number,
  onAppearance: (model: AppearanceModel) => void,
): Promise<void> {
  let newest = floor;
  return open(event => {
    const value = JSON.parse(event.data) as ServerEvent;
    if (value.type !== 'appearance') return;
    const next = appearanceModel(value.appearance, origin, builtInList);
    if (next.revision < newest) return;
    newest = next.revision;
    onAppearance(next);
  });
}
