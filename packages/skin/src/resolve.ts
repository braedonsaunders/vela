import { withHeroArtwork } from './resolve/hero-artwork';
// A skin document resolved for the React renderer: inherited over the Vela base, templates
// inlined, viewport variants applied for the current width class, tokens substituted, client
// and document strings filled, templates and conditions compiled to accessors. Done once per
// document, viewport width and locale; drawing never re-parses a document.
import type { Action, Condition, Node, SkinDocument, Style } from '../../protocol/skin';
import { velaBase } from './resolve/base';
import { withBase } from './resolve/inherit';
import { resolveUi, withUi } from './resolve/ui';
import { mixColours } from './resolve/colour-mix';
import { withClientStrings } from './resolve/client-strings';
import { documentKeyframes, type Motion } from './keyframes';
import { accessor, type Accessor, type Ctx, type Env } from './vocabulary';

/** The highest document renderer version this renderer draws (docs/skin-schema.md). */
export const RENDERER_VERSION = 16;

const MAX_NODES = 4000;
const MAX_DEPTH = 32;

/** A template: literal text, or text with compiled holes. */
export type Template = string | { parts: (string | Accessor)[] };
export type CssT = Record<string, Template>;

export interface Test { read: Accessor | ((c: Ctx, e: Env) => string); is: NonNullable<Condition['is']>; value: string; not: boolean }

export interface Layer { style: CssT; hover?: CssT; focus?: CssT; groupHover?: CssT; groupFocus?: CssT; label?: Template }

interface Common {
  when: Test[];
  base: Layer;
  states: { when: Test[]; layer: Layer }[];
  active?: CssT;
  disabled?: Test[];
  disabledStyle?: CssT;
  motion?: Motion;
  stagger?: { step: number; cap: number };
  role?: string;
  label?: Template;
  /** The brand mark's home press (labelled with the Vela home string): a pointer shortcut that
   * takes no keyboard or TV focus. */
  brand?: boolean;
  level?: number;
  testId?: Template;
  id?: Template;
  hidden?: boolean;
  a11y?: { selected?: Test[]; expanded?: Test[]; current?: Test[]; pressed?: Test[]; checked?: Test[] };
  group: boolean;
  /** Flags Escape closes while open (`escape: "menu drawer"`), and the element id focus returns to. */
  escape?: string[];
  returnFocus?: Template;
  /** The static `order` row, used to reorder siblings. */
  order: number;
}

export type RNode = Common & (
  | { kind: 'box'; children: RNode[]; press?: { action: Action; arg?: Template; focus?: Template }; pager?: { inset?: number; peek?: number }; controlStates: boolean }
  | { kind: 'text'; text: Template; summary?: boolean }
  | { kind: 'image'; src: Template; alt?: Template; fade: boolean }
  | { kind: 'icon'; symbol?: string; paths?: string[]; viewBox?: string; fillRule?: 'nonzero' | 'evenodd' }
  | { kind: 'repeat'; over: string; limit: number; item: RNode }
  | { kind: 'slot'; slot: 'children' | 'searchField'; inner?: CssT }
  | { kind: 'widget'; widget: string; params: Record<string, string> }
);

export type RouteName = 'home' | 'title' | 'person' | 'search' | 'collection' | 'library' | 'live' | 'watch' | 'auth';

export interface ResolvedDocument {
  id: string;
  name: string;
  document: SkinDocument;
  shell?: RNode;
  /** The shared library switch, also available while a route is still loading. */
  libraryViews?: RNode;
  /** Every route the document draws (home from slots.home or routes.home), resolved. */
  routes: Partial<Record<RouteName, RNode>>;
  motion: Record<string, Motion>;
  keyframes: ReturnType<typeof documentKeyframes>;
  /** Rows the style matrix refuses, named once per document. */
  unsupported: string[];
}

/** Image URLs (Plex puts a short-lived token in them) may be read only by an image source or a background image. */
const URL_KEYS = /^(card|hero|detail|dest|person|personPage|ch|tile|hit)\.(poster|backdrop|logo|portrait|nowArt|artwork)$/;
const UNSAFE = /expression\(|javascript:|@import|[;{}<>\\]/i;

interface Context {
  doc: SkinDocument;
  ui: ReturnType<typeof resolveUi>;
  strings: Record<string, string>;
  width: number;
  count: number;
  unsupported: Set<string>;
}

/** Client strings (`{t:…}`), the document's own (`{s:…}`) and its name, filled for the viewer's locale. */
function strings(text: string, r: Context): string {
  return withClientStrings(text)
    .replace(/\{s:([a-zA-Z0-9.-]+)\}/g, (_, key: string) => r.strings[key] ?? '')
    .replace(/\{env\.skinName\}/g, () => r.doc.name);
}

function compile(text: string | undefined, r: Context, urls = false): Template | undefined {
  if (text === undefined) return undefined;
  const filled = strings(text, r);
  const parts: (string | Accessor)[] = [];
  let at = 0;
  for (const m of filled.matchAll(/\{([a-zA-Z.:-]+)\}/g)) {
    const key = m[1];
    if (!urls && URL_KEYS.test(key)) throw new Error(`${key} is an image URL: only an image src or background-image may bind it`);
    if (m.index! > at) parts.push(filled.slice(at, m.index));
    parts.push(read(key));
    at = m.index! + m[0].length;
  }
  if (at < filled.length) parts.push(filled.slice(at));
  const literal = parts.every(p => typeof p === 'string');
  return literal ? (parts as string[]).join('').replace(/\{\{/g, '{') : { parts };
}

function read(key: string): Accessor {
  if (key.startsWith('flag:')) {
    const flag = key.slice(5);
    return (_, e) => (e.flags.includes(flag) ? 'true' : 'false');
  }
  const found = accessor(key);
  if (!found) throw new Error(`Unknown binding ${key}`);
  return found;
}

export function fill(template: Template | undefined, c: Ctx, e: Env): string {
  if (template === undefined) return '';
  if (typeof template === 'string') return template;
  return template.parts.map(p => (typeof p === 'string' ? p : p(c, e))).join('');
}

function tests(list: Condition[] | undefined): Test[] {
  return (list ?? []).map(k => ({ read: read(k.test), is: k.is ?? 'set', value: k.value ?? '', not: k.not ?? false }));
}

export function holds(list: Test[] | undefined, c: Ctx, e: Env): boolean {
  for (const k of list ?? []) {
    const v = k.read(c, e);
    const num = (s: string) => Number(s) || 0;
    let ok: boolean;
    switch (k.is) {
      case 'eq': ok = v === k.value; break;
      case 'ne': ok = v !== k.value; break;
      case 'gt': ok = num(v) > num(k.value); break;
      case 'lt': ok = num(v) < num(k.value); break;
      case 'mod': { const [n, rem] = k.value.split(':').map(Number); ok = n ? num(v) % n === rem : false; break; }
      default: ok = !['', 'false', '0'].includes(v);
    }
    if (ok === k.not) return false;
  }
  return true;
}

/** Style values with tokens, `$ui.*` and document tokens substituted; bound values compiled. */
function css(style: Style | undefined, r: Context): CssT {
  const out: CssT = {};
  for (const [row, raw] of Object.entries(style ?? {})) {
    if (raw === undefined) continue;
    const text = mixColours(withUi(String(raw), r.ui)
      .replace(/\$([A-Za-z0-9_-]+)/g, (_, name: string) => {
        const v = r.doc.tokens?.[name];
        if (v === undefined) throw new Error(`Unknown token $${name}`);
        return v;
      }));
    if (UNSAFE.test(text.replace(/\{[a-zA-Z.:-]+\}/g, ''))) throw new Error(`Unsafe style value: ${row}: ${raw}`);
    out[row] = compile(text, r, row === 'background-image')!;
  }
  return out;
}

/** The node's style for this width: `style`, then the variants in force (as the compiled resolver orders them). */
function variant(node: Node & { below?: Record<string, Style>; above?: Record<string, Style> }, r: Context, base: Style | undefined): Style {
  const marks = [
    ...(node.small ? [{ px: 640, below: true, style: node.small }] : []),
    ...(node.wide ? [{ px: 1200, below: false, style: node.wide }] : []),
    ...Object.entries(node.below ?? {}).map(([px, style]) => ({ px: Number(px), below: true, style })),
    ...Object.entries(node.above ?? {}).map(([px, style]) => ({ px: Number(px), below: false, style })),
  ];
  const applied = [
    ...marks.filter(m => !m.below && m.px <= r.width).sort((a, b) => a.px - b.px),
    ...marks.filter(m => m.below && m.px > r.width).sort((a, b) => b.px - a.px),
  ];
  return Object.assign({}, base, ...applied.map(m => m.style));
}

/** A node's states, at most 16 (docs/skin-schema.md): more is refused, never silently cut. */
function statesOf(node: Node): NonNullable<Node['states']> {
  const states = node.states ?? [];
  if (states.length > 16) throw new Error(`A node has at most 16 states (${states.length})`);
  return states;
}

function convert(node: Node, depth: number, r: Context): RNode {
  if (++r.count > MAX_NODES) throw new Error(`A skin document draws at most ${MAX_NODES} nodes`);
  if (depth > MAX_DEPTH) throw new Error(`A skin document nests at most ${MAX_DEPTH} deep`);
  if (node.type === 'use') {
    const template = r.doc.templates?.[node.template];
    if (!template) throw new Error(`Unknown template ${node.template}`);
    // A shared part keeps the caller's typography, viewport variants and interaction states.
    const { type: _type, template: _name, ...overrides } = node;
    const breakpoints = (a?: Record<string, Style>, b?: Record<string, Style>) => Object.fromEntries(
      [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].map(key => [key, { ...a?.[key], ...b?.[key] }]));
    return convert({ ...template, ...overrides, style: { ...template.style, ...node.style },
      small: { ...template.small, ...node.small }, wide: { ...template.wide, ...node.wide },
      below: breakpoints(template.below, node.below), above: breakpoints(template.above, node.above),
      when: [...(template.when ?? []), ...(node.when ?? [])],
      motion: node.motion ?? template.motion, stagger: node.stagger ?? template.stagger } as Node, depth, r);
  }
  const n = node as Node & { below?: Record<string, Style>; above?: Record<string, Style> };
  const style = variant(n, r, node.style);
  const layer = (s: Style, extra: { hover?: Style; focus?: Style; groupHover?: Style; groupFocus?: Style; label?: string }): Layer => ({
    style: css(s, r),
    hover: extra.hover && css(extra.hover, r),
    focus: extra.focus && css(extra.focus, r),
    groupHover: extra.groupHover && css(extra.groupHover, r),
    groupFocus: extra.groupFocus && css(extra.groupFocus, r),
    label: compile(extra.label, r),
  });
  const motion = node.motion ? r.doc.motion?.[node.motion] as Motion | undefined : undefined;
  if (node.motion && !motion) throw new Error(`Unknown motion ${node.motion}`);
  const common: Common = {
    when: tests(node.when),
    base: layer(style, node),
    states: statesOf(node).map(s => ({ when: tests(s.when), layer: layer({ ...style, ...s.style }, s) })),
    active: node.active && css(node.active, r),
    disabled: node.disabled && tests(node.disabled),
    disabledStyle: node.disabledStyle && css(node.disabledStyle, r),
    motion,
    stagger: node.stagger,
    role: node.role ?? node.a11y?.role,
    label: compile(node.label, r),
    brand: 'press' in node && node.press?.action === 'home' && typeof node.label === 'string' && /\{[st]:(ui\.)?velaHome\}/.test(node.label),
    level: node.level,
    testId: compile(node.testId, r),
    id: compile(node.id, r),
    hidden: node.a11y?.hidden,
    a11y: node.a11y && { selected: node.a11y.selected && tests(node.a11y.selected), expanded: node.a11y.expanded && tests(node.a11y.expanded),
      current: node.a11y.current && tests(node.a11y.current), pressed: node.a11y.pressed && tests(node.a11y.pressed), checked: node.a11y.checked && tests(node.a11y.checked) },
    group: node.group === true,
    escape: node.escape ? node.escape.split(/\s+/).filter(Boolean) : undefined,
    returnFocus: compile(node.returnFocus, r),
    order: Number(style.order) || 0,
  };
  for (const row of ['grid-row', 'grid-column', 'grid-template-rows', '-webkit-text-stroke']) if (style[row as keyof Style]) r.unsupported.add(row);
  if (style['box-sizing'] === 'content-box') r.unsupported.add('box-sizing: content-box');
  if (style.display === 'block' || style.display === 'contents') r.unsupported.add(`display: ${style.display}`);

  switch (node.type) {
    case 'box': {
      const children = (node.children ?? []).map(child => convert(child, depth + 1, r));
      if (children.some(child => child.order !== 0)) children.sort((a, b) => a.order - b.order);
      return { ...common, kind: 'box', children, controlStates: node.controlStates !== false,
        press: node.press && { action: node.press.action, arg: compile(node.press.arg, r), focus: compile(node.press.focus, r) }, pager: node.pager };
    }
    // Legacy and new documents get the same safe synopsis control from this binding.
    case 'text': return { ...common, kind: 'text', text: compile(node.text, r)!, summary: ['{detail.summary}', '{personPage.biography}'].includes(node.text.trim()) };
    case 'image': return { ...common, kind: 'image', src: compile(node.src, r, true)!, alt: compile(node.alt, r), fade: node.fade === true };
    case 'icon': return { ...common, kind: 'icon', symbol: node.symbol, paths: node.paths, viewBox: node.viewBox, fillRule: node.fillRule };
    case 'repeat': return { ...common, kind: 'repeat', over: node.over, limit: node.limit ?? 1000, item: convert(node.item, depth + 1, r) };
    case 'slot': return { ...common, kind: 'slot', slot: node.slot, inner: node.inner && css(node.inner, r) };
    case 'widget': {
      // Parameters are text: client and document strings are filled now; holes (`{value}`, bindings) stay for the widget.
      const params = Object.fromEntries(Object.entries(node.params ?? {}).map(([k, v]) => [k, strings(v, r)]));
      return { ...common, kind: 'widget', widget: node.widget, params };
    }
  }
}

/** Resolve a document for a viewport width and locale. A document that needs a newer renderer
 * is refused on its version, never half-drawn. */
export function resolveDocument(own: SkinDocument, width: number, locale = 'en'): ResolvedDocument {
  if (own.schema !== 1) throw new Error(`Skin document schema ${String(own.schema)} is not supported`);
  if (own.renderer > RENDERER_VERSION) throw new Error(`${own.name} needs renderer ${own.renderer}; this client draws ${RENDERER_VERSION}`);
  const doc = own.id === velaBase.id ? own : withBase(own, velaBase);
  const strings = { ...doc.strings?.en, ...doc.strings?.[locale.split('-')[0]], ...doc.strings?.[locale] };
  const r: Context = { doc, ui: resolveUi(doc.ui), strings, width, count: 0, unsupported: new Set() };
  const home = doc.slots?.home ?? doc.routes?.home;
  return {
    id: doc.id,
    name: doc.name,
    document: doc,
    shell: doc.slots?.shell && convert(doc.slots.shell, 1, r),
    libraryViews: doc.templates?.velaLibraryViews && convert({ type: 'use', template: 'velaLibraryViews' }, 1, r),
    routes: Object.fromEntries([
      ...(home ? [['home', convert(withHeroArtwork(home), 1, r)]] : []),
      ...Object.entries(doc.routes ?? {}).filter(([name, tree]) => name !== 'home' && tree).map(([name, tree]) => [name, convert(tree as Node, 1, r)]),
    ]) as ResolvedDocument['routes'],
    motion: (doc.motion ?? {}) as Record<string, Motion>,
    keyframes: documentKeyframes(doc.keyframes),
    unsupported: [...r.unsupported],
  };
}
