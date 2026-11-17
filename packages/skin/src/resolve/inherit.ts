// Route-level inheritance (docs/skin-schema.md, renderer 15): every document draws on top of the
// Vela base (base.ts), the built-in routes and slots in the document's own `ui` look. A slot or
// route the document defines replaces the base's; templates, motion, keyframes, fonts, tokens and
// strings merge by name, the document's winning.
import type { Node, SkinDocument } from '../../../protocol/skin';
import { libraryBelowHeader } from './vela-base/library';

/** A document with the base under it: every table filled, slots always present. */
export type InheritedDocument = SkinDocument & Required<Pick<SkinDocument, 'slots'>>;

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
  return doc.slots?.home ?? doc.routes?.home;
}

/** Older or third-party library routes still receive the shared view switch. */
function hasLibraryViews(node: Node): boolean {
  if (node.type === 'use' && node.template === 'velaLibraryViews') return true;
  if (node.type === 'box') return (node.children ?? []).some(hasLibraryViews);
  if (node.type === 'repeat') return hasLibraryViews(node.item);
  return false;
}

function withLibraryViews(node: Node): Node {
  if (hasLibraryViews(node)) return node;
  const switcher: Node = { type: 'use', template: 'velaLibraryViews' };
  const libraryOnly: Node = { ...node, when: [...(node.when ?? []), { test: 'library.view', is: 'eq', value: 'library' }] };
  return { type: 'box', style: { display: 'flex', 'flex-direction': 'column' }, children: [switcher, { type: 'use', template: 'velaLibraryAlternative' }, libraryOnly] };
}

/** Whether a shell reserves space for navigation before its route content. */
export function hasFlowHeader(shell: Node | undefined): boolean {
  let navigation = false;
  const walk = (node: Node, inFlow: boolean): boolean => {
    if (node.type === 'slot' && node.slot === 'children') return true;
    if (node.type !== 'box') return false;
    const flow = inFlow && node.style?.position !== 'absolute';
    if (flow && node.role === 'navigation') navigation = true;
    for (const child of node.children ?? []) if (walk(child, flow)) return true;
    return false;
  };
  return !!shell && walk(shell, true) && navigation;
}

/** The document over the base: what the document defines wins, the base fills the rest. */
export function withBase(doc: SkinDocument, base: SkinDocument): InheritedDocument {
  const ownHome = homeOf(doc);
  const home = ownHome ?? homeOf(base);
  const routes = { ...base.routes, ...doc.routes };
  delete routes.home;
  if (!doc.routes?.library && hasFlowHeader(doc.slots?.shell)) routes.library = libraryBelowHeader;
  if (routes.library) routes.library = withLibraryViews(routes.library);
  const slots = { ...base.slots, ...doc.slots };
  delete slots.home;
  // Home's bar mask is its drawer's: a document that draws its own home does not take the base's.
  const barMask = ownHome ? doc.traits?.barMask : doc.traits?.barMask ?? base.traits?.barMask;
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
    // Home's loading and failure states belong to whoever draws home.
    status: ownHome ? doc.status : base.status,
    // The title page's presentation belongs to whoever draws the title page.
    detail: doc.routes?.title ? doc.detail : base.detail ?? doc.detail,
    traits: { ...base.traits, ...doc.traits, barMask },
  };
}
