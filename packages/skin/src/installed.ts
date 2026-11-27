import type { SkinDocument } from '../../protocol/skin';
import type { AppearanceModel, PackEntryModel } from '../../core/src/appearance';
import { uiDefaults } from './resolve/ui-defaults';
import { resolveDocument } from './resolve';
import { portabilityReport } from './resolve/portability';

/** Owner assets never escape the selected server's appearance tree. */
export function appearanceAsset(value: string, origin: string): string {
  const url = new URL(value, `${origin}/`);
  if (url.origin !== origin || !/^\/vela\/v0\/appearance\/(skins|packs)\//.test(url.pathname) || url.search || url.hash || /%|\\/.test(url.pathname) || !/\.(json|svg|png|jpe?g|webp|avif|ttf|otf|woff2?)$/i.test(url.pathname)) throw new Error('Unsafe skin asset');
  return url.href;
}

/** A digest of an installed skin's JSON for a renderer version (FNV-1a): a document this device has
 * already resolved need not be resolved at every width again on each launch. */
export function installedDigest(json: string, rendererVersion: number): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${rendererVersion}.${json.length}.${hash.toString(36)}`;
}

/** An installed skin, made safe. Unless `resolved` (this device resolved this very document
 * before, installedDigest), it is also resolved at a phone's, a desktop's and a TV's width: a
 * TV box spent most of a second of its launch doing that for each installed skin. */
export function installedDocument(value: unknown, origin: string, resolved = false): SkinDocument {
  if (!value || typeof value !== 'object' || JSON.stringify(value).length > 1024 * 1024) throw new Error('Invalid skin');
  // JSON data only. Static image/font sources are scoped; renderer bindings continue to use
  // trusted catalogue artwork. CSS URLs are forbidden (images belong in image nodes).
  const visit = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') {
      if (/url\s*\(|javascript:|@import/i.test(v)) throw new Error('Unsafe skin value');
      if (['src', 'url', 'preview'].includes(key)) {
        // A data binding (catalogue artwork); the skin's own name is text, never an image source.
        if (key === 'src' && /^\{[a-zA-Z][a-zA-Z0-9.]*\}$/.test(v) && v !== '{env.skinName}') return v;
        return appearanceAsset(v, origin);
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(item => visit(item));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, item]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(k)) throw new Error('Unsafe skin key');
      return [k, visit(item, k)];
    }));
    return v;
  };
  const doc = visit(value) as SkinDocument;
  if (doc.schema !== 1 || !doc.id || !doc.name || !Array.isArray(doc.swatches) || !Number.isInteger(doc.renderer)) throw new Error('Invalid skin metadata');
  if (resolved) return doc;
  for (const width of [390, 1440, 1920]) resolveDocument(doc, width, 'en');
  if (portabilityReport(doc).some(f => f.level === 'error')) throw new Error('Nonportable skin');
  return doc;
}

export function chosenSkin(ids: string[], choice: string, appearance?: AppearanceModel): string {
  const requested = appearance?.force ? appearance.defaultSkinId : choice || appearance?.defaultSkinId;
  const wanted = requested === 'cinematic' && ids.includes('cinematic-doc') ? 'cinematic-doc' : requested;
  return ids.includes(wanted ?? '') ? wanted! : ids[0]!;
}

export function packDocument(base: SkinDocument, pack: PackEntryModel): SkinDocument {
  const data = JSON.parse(pack.packJson);
  const doc = { ...base, id: pack.id, name: pack.name, tagline: pack.tagline, preview: pack.preview, swatches: pack.swatches,
    ui: { ...base.ui, ...(data.fonts?.display ? { fontDisplay: data.fonts.display.family } : {}), ...(data.fonts?.text ? { font: data.fonts.text.family } : {}), ...Object.fromEntries(Object.entries(data.palette).filter(([key]) => Object.hasOwn(uiDefaults, key))), ...(data.radius?.card !== undefined ? { radiusCard: data.radius.card } : {}), ...(data.radius?.panel !== undefined ? { radiusPanel: data.radius.panel } : {}) }, tokens: { ...base.tokens, ...data.tokens }, fonts: { ...base.fonts, ...data.fonts } } as SkinDocument;
  return doc;
}
