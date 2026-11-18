import { searchControls, searchPaging } from './vela-base/search';
// Route-level inheritance (docs/skin-schema.md, renderer 15): every document draws on top of the
// Vela base (base.ts), the built-in routes and slots in the document's own `ui` look. A slot or
// route the document defines replaces the base's; templates, motion, keyframes, fonts, tokens and
// strings merge by name, the document's winning.
import type { BoxNode, Node, SkinDocument } from '../../../protocol/skin';
import { libraryBelowHeader } from './vela-base/library';
import { personContent } from './vela-base/person';

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

/** A skin's library-name/kind bar precedes the shared view tabs and browse controls. */
function libraryHeaderOrder(node: Node): Node {
  if (node.type !== 'box') return node;
  const children = (node.children ?? []).map(libraryHeaderOrder);
  const views = children.findIndex(child => child.type === 'use' && child.template === 'velaLibraryViews');
  const header = children.findIndex(child => child.type === 'box' && child.role === 'tablist' && child.label === '{library.name}');
  if (views >= 0 && header > views) {
    const [switcher] = children.splice(views, 1);
    children.splice(header, 0, switcher!);
  } else if (views >= 0) {
    // Plain list skins keep the library heading inside their catalogue block. Lift that
    // heading above the controls while keeping its typography and page gutter.
    const catalogue = children.findIndex((child, index) => index > views && child.type === 'box'
      && child.children?.some(part => part.type === 'text' && part.text === '{library.name}')
      && child.children.some(part => part.type === 'repeat' && part.over === 'library.items'));
    const content = children[catalogue];
    if (content?.type === 'box') {
      const heading = content.children!.find(part => part.type === 'text' && part.text === '{library.name}')!;
      children[catalogue] = { ...content, children: content.children!.filter(part => part !== heading) };
      children.splice(views, 0, { type: 'box', when: content.when?.filter(test => test.test !== 'library.view'),
        style: { ...content.style, 'padding-bottom': '0px' }, children: [heading] });
    }
  }
  return { ...node, children };
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

/** All documents share the same accessible cast control and capability rule. */
function sharedCast(node: Node): Node {
  if (node.type === 'repeat') return node.over === 'detail.cast'
    ? { ...node, item: { type: 'use', template: 'velaCastPerson' } }
    : { ...node, item: sharedCast(node.item) };
  if (node.type === 'box') return { ...node, children: (node.children ?? []).map(sharedCast) };
  return node;
}

function titleClose(node: Node | undefined): Node | undefined {
  if (!node) return undefined;
  if (node.type === 'box' && (node.testId === 'detail-close' || node.testId === 'detail-back')) return node;
  if (node.type === 'box') for (const child of node.children ?? []) { const found = titleClose(child); if (found) return found; }
  if (node.type === 'repeat') return titleClose(node.item);
  return undefined;
}

/** Reuse the title's own modal frame and close button, replacing only its scroll contents. */
function personFrame(node: Node, content: Node): Node {
  if (node.type !== 'box') return node;
  const children = node.children ?? [];
  const direct = children.find(child => child.type === 'box' && (child.testId === 'detail-close' || child.testId === 'detail-back'));
  const strip = children.find(child => child.type === 'box' && child.role === 'navigation' && titleClose(child));
  if (direct || strip) {
    const close = direct?.type === 'box' && direct.style?.left && !direct.style.right
      ? { ...direct, style: { ...direct.style, right: direct.style.left, left: 'auto' } } as Node : direct ?? strip!;
    return { ...node, children: [close, content] };
  }
  const containing = children.find(child => titleClose(child));
  return containing ? { ...node, children: [personFrame(containing, content)] } : node;
}

/** Take the library's actual grid/list and card, including its breakpoint geometry. */
function libraryLayout(node: Node | undefined): { box: BoxNode; item: Node } | undefined {
  if (!node || node.type !== 'box') return undefined;
  const layouts: { box: BoxNode; item: Node }[] = [];
  const walk = (box: BoxNode) => {
    for (const child of box.children ?? []) {
      if (child.type === 'repeat' && child.over === 'library.items') layouts.push({ box, item: child.item });
      else if (child.type === 'box') walk(child);
    }
  };
  walk(node);
  return layouts.find(layout => layout.box.style?.display === 'grid') ?? layouts[0];
}

function fillPersonFrame(node: Node): Node {
  if (node.type !== 'box' || node.style?.position !== 'absolute') return node;
  return { ...node, children: (node.children ?? []).map(child => child.type === 'box' && child.style?.flex && !child.style.height
    ? { ...child, style: { ...child.style, 'min-height': '100vh' } } : child) };
}

/** The document over the base: what the document defines wins, the base fills the rest. */
export function withBase(doc: SkinDocument, base: SkinDocument): InheritedDocument {
  const ownHome = homeOf(doc);
  const home = ownHome ?? homeOf(base);
  const routes = { ...base.routes, ...doc.routes };
  delete routes.home;
  if (routes.search) routes.search = { type: 'box', style: { display: 'flex', 'flex-direction': 'column', gap: '18px' }, children: [searchControls, routes.search, searchPaging] };
  if (routes.title) routes.title = sharedCast(routes.title);
  if (!doc.routes?.library && hasFlowHeader(doc.slots?.shell)) routes.library = libraryBelowHeader;
  if (routes.library) routes.library = withLibraryViews(libraryHeaderOrder(routes.library));
  const layout = libraryLayout(doc.routes?.library ?? base.routes?.library);
  const personCard = layout?.item ?? doc.templates?.gridCard ?? doc.templates?.gridPoster ?? doc.templates?.poster ?? doc.templates?.card ?? base.templates!.velaCard!;
  const title = doc.routes?.title ?? base.routes?.title;
  if (title && titleClose(title)) routes.person = fillPersonFrame(personFrame(title, personContent(layout?.box)));
  const slots = { ...base.slots, ...doc.slots };
  delete slots.home;
  // Home's bar mask is its drawer's: a document that draws its own home does not take the base's.
  const barMask = ownHome ? doc.traits?.barMask : doc.traits?.barMask ?? base.traits?.barMask;
  return {
    ...doc,
    slots: home ? { ...slots, home } : slots,
    routes,
    templates: { ...merged(base.templates, doc.templates),
      velaPersonCard: personCard,
    },
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
