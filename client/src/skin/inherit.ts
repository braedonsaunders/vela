// Route-level inheritance (docs/skin-schema.md, renderer 15): every document draws on top of the
// Vela base (base.ts), the built-in routes and slots in the document's own `ui` look. A slot or
// route the document defines replaces the base's; templates, motion, keyframes, fonts, tokens and
// strings merge by name, the document's winning.
import type { Node, SkinDocument } from '../../wire/v0/skin';

type Named<T> = Record<string, T> | undefined;

function merged<T>(base: Named<T>, own: Named<T>): Record<string, T> {
  return { ...base, ...own };
}

function mergedStrings(base: SkinDocument['strings'], own: SkinDocument['strings']): SkinDocument['strings'] {
  const locales = new Set([...Object.keys(base ?? {}), ...Object.keys(own ?? {})]);
  const out: Record<string, Record<string, string>> = {};
  for (const locale of locales) out[locale] = { ...base?.[locale], ...own?.[locale] };
  return out;
}

/** Home is a slot in older documents (slots.home) and a route in newer ones (routes.home). */
function homeOf(doc: SkinDocument): Node | undefined {
  return doc.slots.home ?? doc.routes?.home;
}

/** The document over the base: what the document defines wins, the base fills the rest. */
export function withBase(doc: SkinDocument, base: SkinDocument): SkinDocument {
  const ownHome = homeOf(doc);
  const home = ownHome ?? homeOf(base);
  const routes = { ...base.routes, ...doc.routes };
  delete routes.home;
  const slots = { ...base.slots, ...doc.slots };
  delete slots.home;
  return {
    ...doc,
    slots: home ? { ...slots, home } : slots,
    routes,
    templates: merged(base.templates, doc.templates),
    motion: merged(base.motion, doc.motion),
    keyframes: merged(base.keyframes, doc.keyframes),
    fonts: merged(base.fonts, doc.fonts),
    tokens: merged(base.tokens, doc.tokens),
    strings: mergedStrings(base.strings, doc.strings),
    // Home draws its own loading and failure states when whoever draws home says so.
    status: ownHome ? doc.status : base.status,
    // The title page's presentation belongs to whoever draws the title page.
    detail: doc.routes?.title ? doc.detail : base.detail ?? doc.detail,
    traits: { ...base.traits, ...doc.traits },
  };
}
