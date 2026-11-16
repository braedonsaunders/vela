// A skin document resolved for the React renderer: inherited over the Vela base, templates
// inlined, viewport variants applied for the current width class, tokens substituted, client
// and document strings filled, templates and conditions compiled to accessors. Done once per
// document, viewport width and locale; drawing never re-parses a document.
import type { Action, Condition, Node, SkinDocument, Style } from '../../../protocol/v0/skin';
import { velaBase } from '../../../client/src/skin/base';
import { withBase } from '../../../client/src/skin/inherit';
import { resolveUi, uiValue } from '../../../client/src/skin/ui';
import { withClientStrings } from '../../../client/src/skin/client-strings';
import { documentKeyframes, type Motion } from './motion';
import { accessor, type Accessor, type Ctx, type Env } from './vocabulary';

/** The highest document renderer version this renderer draws (docs/skin-schema.md). */
export const RENDERER_VERSION = 15;

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
  level?: number;
  testId?: Template;
  id?: Template;
  hidden?: boolean;
  a11y?: { selected?: Test[]; expanded?: Test[]; current?: Test[]; pressed?: Test[]; checked?: Test[] };
  group: boolean;
  /** The static `order` row, used to reorder siblings. */
  order: number;
}

export type RNode = Common & (
  | { kind: 'box'; children: RNode[]; press?: { action: Action; arg?: Template; focus?: Template }; pager?: { inset?: number; peek?: number }; controlStates: boolean }
  | { kind: 'text'; text: Template }
  | { kind: 'image'; src: Template; alt?: Template; fade: boolean }
  | { kind: 'icon'; symbol?: string; paths?: string[]; viewBox?: string; fillRule?: 'nonzero' | 'evenodd' }
  | { kind: 'repeat'; over: string; limit: number; item: RNode }
  | { kind: 'slot'; slot: 'children' | 'searchField'; inner?: CssT }
  | { kind: 'widget'; widget: string; params: Record<string, string> }
);

export interface ResolvedDocument {
  id: string;
  name: string;
  document: SkinDocument;
  shell?: RNode;
  /** `search` is drawn in home's view, after home's nodes, while a query is open. */
  routes: Partial<Record<'home' | 'title' | 'search', RNode>>;
  motion: Record<string, Motion>;
  keyframes: ReturnType<typeof documentKeyframes>;
  /** Rows the style matrix refuses, named once per document. */
  unsupported: string[];
}

/** Image URLs (Plex puts a short-lived token in them) may be read only by an image source or a background image. */
const URL_KEYS = /^(card|hero|detail|dest|person|ch|tile|hit)\.(poster|backdrop|logo|portrait|nowArt|artwork)$/;
const UNSAFE = /expression\(|javascript:|@import|[;{}<>\\]/i;

interface Context {
  doc: SkinDocument;
  ui: ReturnType<typeof resolveUi>;
  strings: Record<string, string>;
  width: number;
  count: number;
  unsupported: Set<string>;
}

function compile(text: string | undefined, r: Context, urls = false): Template | undefined {
  if (text === undefined) return undefined;
  const filled = withClientStrings(text)
    .replace(/\{s:([a-zA-Z0-9.-]+)\}/g, (_, key: string) => r.strings[key] ?? '')
    .replace(/\{env\.skinName\}/g, () => r.doc.name);
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
    const text = String(raw)
      .replace(/\$ui\.([A-Za-z]+)/g, (_, name: string) => uiValue(r.ui, name))
      .replace(/\$([A-Za-z0-9_-]+)/g, (_, name: string) => {
        const v = r.doc.tokens?.[name];
        if (v === undefined) throw new Error(`Unknown token $${name}`);
        return v;
      });
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
    // The use node's own style, conditions and motion wrap the template's.
    return convert({ ...template, style: { ...template.style, ...node.style }, when: [...(template.when ?? []), ...(node.when ?? [])],
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
    level: node.level,
    testId: compile(node.testId, r),
    id: compile(node.id, r),
    hidden: node.a11y?.hidden,
    a11y: node.a11y && { selected: node.a11y.selected && tests(node.a11y.selected), expanded: node.a11y.expanded && tests(node.a11y.expanded),
      current: node.a11y.current && tests(node.a11y.current), pressed: node.a11y.pressed && tests(node.a11y.pressed), checked: node.a11y.checked && tests(node.a11y.checked) },
    group: node.group === true,
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
    case 'text': return { ...common, kind: 'text', text: compile(node.text, r)! };
    case 'image': return { ...common, kind: 'image', src: compile(node.src, r, true)!, alt: compile(node.alt, r), fade: node.fade === true };
    case 'icon': return { ...common, kind: 'icon', symbol: node.symbol, paths: node.paths, viewBox: node.viewBox, fillRule: node.fillRule };
    case 'repeat': return { ...common, kind: 'repeat', over: node.over, limit: node.limit ?? 1000, item: convert(node.item, depth + 1, r) };
    case 'slot': return { ...common, kind: 'slot', slot: node.slot, inner: node.inner && css(node.inner, r) };
    case 'widget': {
      // Parameters are text: client and document strings are filled now; a bound parameter stays as written.
      const params = Object.fromEntries(Object.entries(node.params ?? {}).map(([k, v]) => {
        const t = compile(v, r);
        return [k, typeof t === 'string' ? t : v];
      }));
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
    routes: {
      home: home && convert(home, 1, r),
      title: doc.routes?.title && convert(doc.routes.title, 1, r),
      search: doc.routes?.search && convert(doc.routes.search, 1, r),
    },
    motion: (doc.motion ?? {}) as Record<string, Motion>,
    keyframes: documentKeyframes(doc.keyframes),
    unsupported: [...r.unsupported],
  };
}
