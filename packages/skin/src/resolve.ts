import { flagBinding } from './route-host';
import { selectEnv } from './host-source';
import { brandDocument } from './branding';
import type { Branding } from '../../protocol/types';
import { withRowLinks } from './resolve/row-links';
import { withLibraryPresentation } from './resolve/library-presentation';
import { withHeroArtwork } from './resolve/hero-artwork';
import { inlineMediaTitleTree, mediaTitleTree } from './resolve/media-title';
// A skin document resolved for the React renderer: inherited over the Vela base, templates
// inlined, viewport variants applied for the current width class, tokens substituted, client
// and document strings filled, templates and conditions compiled to accessors. Done once per
// document, viewport width and locale; drawing never re-parses a document.
import type { Action, BoxNode, Condition, Node, PartLayers, PartStyle, PerClass, Platform, PlayerNode, RichNode, SkinDocument, SlotNode, Style, TabsNode, UseNode, VisualizerNode } from '../../protocol/skin';
import { slotSpec } from '../../protocol/experiences';
import { RICH_BLOCKS, type RichBlockName, type RichBlockSpec } from '../../protocol/rich-blocks';
import { SCREEN_LIMITS } from '../../protocol/screen';
import { kitDefaults } from './screen/kit';
import { velaBase } from './resolve/base';
import { withBase } from './resolve/inherit';
import { resolveUi, withUi } from './resolve/ui';
import { mixColours } from './resolve/colour-mix';
import { withClientStrings } from './resolve/client-strings';
import { documentKeyframes, type Motion } from './keyframes';
import { accessor, type Accessor, type Ctx, type Env } from './vocabulary';
import { compileTemplate, holeValue, makeArg, pathField, singleHole, type Arg, type HoleScope, type Value } from './screen/holes';
import { text as valueText } from './screen/scope';
import type { Items } from './screen/items';
import { fold, halfPoints, lineHeightPoints, pointsToPx, screenStyleRow } from './resolve/screen-style';
import { takesDirectionalFocus } from './focus-stop-policy';

import { RENDERER_VERSION } from './resolve/version';
export { RENDERER_VERSION };

/** The renderer 19 blocks (docs/plugin-screens.md: Building blocks), drawn by ./blocks. */
export const BLOCK_KINDS = ['sections', 'shelf', 'grid', 'tabs', 'table', 'lineGraph', 'player', 'paramInput', 'titleCard', 'marquee'] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

const MAX_NODES = 4000;
/** Items one screen collection draws at most. */
const SCREEN_ARRAY_ITEMS = SCREEN_LIMITS.arrayItems;
const MAX_DEPTH = 32;

/** A template: literal text, or text with compiled holes. */
export type Template = string | { parts: (string | Accessor)[] };
export type CssT = Record<string, Template>;

export interface Test { read: Accessor | ((c: Ctx, e: Env) => string); is: NonNullable<Condition['is']>; value: string; not: boolean;
  /** Screens: a `value` holding holes (`channel:{src.game.event.watch.primary.channelId}`), filled when tested. */
  valueHole?: (c: Ctx, e: Env) => string }

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
  /** False for pointer conveniences that never enter keyboard, D-pad or remote focus order. */
  directionalFocus?: false;
  level?: number;
  testId?: Template;
  id?: Template;
  hidden?: boolean;
  a11y?: { selected?: Test[]; expanded?: Test[]; current?: Test[]; pressed?: Test[]; checked?: Test[]; haspopup?: string; title?: Template };
  group: boolean;
  /** Flags Escape closes while open (`escape: "menu drawer"`), and the element id focus returns to. */
  escape?: string[];
  returnFocus?: Template;
  /** The static `order` row, used to reorder siblings. */
  order: number;
  /** Screens: play a motion when the filled value changes (a score pops). */
  onChange?: { value: Template; motion: Motion };
  /** Screens: lazy sources to read when this node is about to draw. */
  needs?: string[];
  /** Drawn only while a navigation row has destinations it cannot fit (`when` holds `nav.more`): the
   * row's More control, which its measuring copy counts as shown. */
  navMore?: boolean;
}

/** A press: an action and its argument, or (screens) named arguments and an optimistic patch. */
export interface RPress {
  action: Action; arg?: Template; focus?: Template;
  args?: Record<string, Template>;
  /** Screens: the raw value of each argument written as one hole (`{t.favourite|not}` is false, not
   * 'false'), so typed plugin action arguments keep their type. */
  argValues?: Record<string, Value>;
  optimistic?: { record?: Template; source?: string; path: string; value: Template; raw?: Value };
}

export type RNode = Common & (
  | { kind: 'box'; children: RNode[]; press?: RPress; pager?: { inset?: number; peek?: number }; fit?: 'nav'; readingStop?: true;
    /** Screens: a reading stop only while these hold (`vela:panel` with a bound `focusable`). */
    readingStopWhen?: Test[]; controlStates: boolean }
  | { kind: 'text'; text: Template; summary?: boolean; avatar?: boolean;
    /** Renderer 20: inline runs after the text, each with its own text rows. */
    spans?: { text: Template; style: CssT; when: Test[] }[] }
  | { kind: 'image'; src: Template; alt?: Template; fade: boolean; /** Screens: drawn until the image loads, and instead of an empty, refused or failed one. */ fallback?: RNode }
  | { kind: 'icon'; symbol?: string; paths?: string[]; viewBox?: string; fillRule?: 'nonzero' | 'evenodd' }
  | { kind: 'repeat'; over: string; limit: number; implicitLimit?: boolean; item: RNode; /** Screens: a data collection (screen/items.ts). */ items?: Items }
  | { kind: 'slot'; slot: SlotNode['slot'] | 'mediaTitleActions'; inner?: CssT;
    /** A plugin slot (`plugin:<slot id>`): the context its surfaces read, and at most this many of them. */
    context?: Record<string, Template>; limit?: number }
  | { kind: 'widget'; widget: string; params: Record<string, string> }
  // Renderer 19 blocks (docs/plugin-screens.md), drawn by ./blocks. Per-class values are already
  // picked for the viewport; `Value`s read raw data (record references followed).
  | { kind: 'sections'; children: RNode[]; gap?: string }
  | { kind: 'shelf'; items: Items; item: RNode; itemWidth?: string; gap?: string; stableOrder: boolean; empty?: RNode }
  | { kind: 'grid'; items: Items; item: RNode; columns: number; gap?: string }
  | { kind: 'marquee'; items: Items; item: RNode; gap?: string; speed?: number }
  | { kind: 'tabs'; items: Items; value: Template; label: Template; count?: Template; bind: { param?: string; state?: string; clear?: string[] };
    default?: Template; all?: Template; /** The chip each option is drawn with (a box, its args bound to `{$tab.*}`). */ chip: RNode; small: boolean;
    /** Drawn after the options in the same scroll and focus row. */ after?: RNode[];
    /** An empty bound param takes the shown default on first draw. */ pin?: boolean }
  | { kind: 'table'; data: Value; compact: boolean; focusRows?: number; /** false: rows' highlight is ignored. */ highlight?: false }
  | { kind: 'lineGraph'; series: Value; sides?: Value; subject?: Template; live?: Template; height?: string }
  | { kind: 'player'; channel: Template }
  | { kind: 'paramInput'; param: string; placeholder?: Template }
  | { kind: 'titleCard'; item: Template }
  // Renderer 20: a rich native block (rich-blocks.ts), drawn by its engine. Props are compiled
  // arguments (a single hole keeps its raw value); parts and part templates are already merged
  // (the document's, the node's, then the skin's) and picked for the viewport.
  | { kind: 'rich'; block: RichBlockName; props: Record<string, Arg>; parts: Record<string, RPart>; templates: Record<string, RNode>; fallback?: RNode }
);

/** A rich block's part, resolved: its style for this viewport and its interaction layers. */
export interface RPart { style: CssT; hover?: CssT; focus?: CssT; active?: CssT }

export type RouteName = 'home' | 'title' | 'person' | 'search' | 'collection' | 'library' | 'live' | 'watch' | 'auth'
  /** A plugin screen (Sports), drawn natively inside the shell. */
  | 'screen';

export interface ResolvedDocument {
  id: string;
  name: string;
  document: SkinDocument;
  shell?: RNode;
  /** The live route can opt into the spacious preview/details band. */
  guideLayout?: 'cinematic';
  /** The shared library switch, also available while a route is still loading. */
  libraryViews?: RNode;
  /** Every route the document draws (home from slots.home or routes.home), resolved. */
  routes: Partial<Record<RouteName, RNode>>;
  /** The title page with the media page in its scroll region, for music, book and audiobook
   * titles (resolve/media-title.ts); none when the title page has no such region. */
  mediaTitle?: RNode;
  /** The same frame with its scroll region hosting an inline built-in document. */
  mediaTitleSlot?: RNode;
  motion: Record<string, Motion>;
  keyframes: ReturnType<typeof documentKeyframes>;
  /** Rows the style matrix refuses, named once per document. */
  unsupported: string[];
}

/** Image URLs (Plex puts a short-lived token in them) may be read only by an image source or a background image. */
const URL_KEYS = /^(card|hero|detail|dest|person|personPage|ch|tile|hit)\.(poster|backdrop|logo|portrait|nowArt|artwork)$/;
const UNSAFE = /expression\(|javascript:|@import|[;{}<>\\]/i;

/** Resolving a screen or surface document (resolve/screen.ts): holes read its data, not the vocabulary. */
export interface ScreenMode {
  /** Strings, `{arg.*}`, item aliases and the page colour the holes compile against. */
  scope: HoleScope;
  /** The kit's templates in the skin's look (screen/kit.ts). */
  kit: Record<string, Node>;
  /** `$palette.<name>` values. */
  palette: Record<string, string>;
  /** Children of the `use` whose template is being resolved: they draw at its `children` slot. */
  slot?: RNode[];
  /** Problems that do not refuse the document: an unknown kit template, a refused literal colour. */
  warnings: Set<string>;
  /** Points per CSS px where lengths round to half points (TVs), else 1. */
  scale: number;
  /** The points lengths round to (0.5, or 1 for a host drawing in the player look). */
  step?: number;
  /** Renderer 20: rich-block part styles and part templates, the document's and the skin's (whose win
   * over a block's own). */
  parts?: { doc: Record<string, PartStyle>; skin: Record<string, PartStyle> };
  partTemplates?: { doc: Record<string, Node>; skin: Record<string, Node> };
}

export interface Context {
  doc: SkinDocument;
  ui: ReturnType<typeof resolveUi>;
  strings: Record<string, string>;
  width: number;
  /** The viewport is a TV: `tv` variants apply (after `small`, `wide` and breakpoints). */
  tv?: boolean;
  /** Renderer 20: a foldable held partly open (`fold` variants apply after `tv`), and the platform
   * (`platforms` variants apply last). */
  fold?: boolean;
  platform?: Platform;
  count: number;
  unsupported: Set<string>;
  screen?: ScreenMode;
}

/** Client strings (`{t:…}`), the document's own (`{s:…}`) and its name, filled for the viewer's locale. */
function strings(text: string, r: Context): string {
  return withClientStrings(text)
    .replace(/\{s:([a-zA-Z0-9.-]+)\}/g, (_, key: string) => r.strings[key] ?? '')
    .replace(/\{env\.skinName\}/g, () => r.doc.name);
}

function compile(text: string | undefined, r: Context, urls = false): Template | undefined {
  if (text === undefined) return undefined;
  if (r.screen) return compileTemplate(text, r.screen.scope);
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
    // A node redraws only when this flag goes up or down, not for every flag (selectEnv).
    return flagBinding<Accessor>((_, e) => (selectEnv(e, 'flags', `flag:${flag}`, flags => flags.includes(flag)) ? 'true' : 'false'), flag);
  }
  const found = accessor(key);
  if (!found) throw new Error(`Unknown binding ${key}`);
  return flagBinding(found, key === 'env.searchFocused' ? 'search-focused' : null);
}

export function fill(template: Template | undefined, c: Ctx, e: Env): string {
  if (template === undefined) return '';
  if (typeof template === 'string') return template;
  return template.parts.map(p => (typeof p === 'string' ? p : p(c, e))).join('');
}

function tests(list: Condition[] | undefined, r?: Context): Test[] {
  return (list ?? []).map(k => {
    const value = k.value ?? '';
    // A screen compares two values by writing the other as a hole in `value` (a surface's channel against an event's).
    const holed = r?.screen && /\{[^{]/.test(value) ? compileTemplate(value, r.screen.scope) : undefined;
    return { read: r?.screen ? screenRead(k.test, r.screen.scope) : read(k.test), is: k.is ?? 'set', value, not: k.not ?? false,
      ...(holed !== undefined && typeof holed !== 'string' ? { valueHole: (c: Ctx, e: Env) => fill(holed, c, e) } : {}) };
  });
}

/** A condition's key in a screen document: a binding path (pipes allowed, braces optional), read as text. */
function screenRead(key: string, scope: HoleScope): Accessor {
  // `{arg.loser}` reads as `arg.loser`: a test may be written as a hole.
  const value = holeValue(singleHole(key) ?? key, scope);
  return (c, e) => valueText(value(c, e), c.screen?.record);
}

export function holds(list: Test[] | undefined, c: Ctx, e: Env): boolean {
  for (const k of list ?? []) {
    const v = k.read(c, e);
    const value = k.valueHole ? k.valueHole(c, e) : k.value;
    const num = (s: string) => Number(s) || 0;
    let ok: boolean;
    switch (k.is) {
      case 'eq': ok = v === value; break;
      case 'ne': ok = v !== value; break;
      case 'gt': ok = num(v) > num(value); break;
      case 'lt': ok = num(v) < num(value); break;
      case 'mod': { const [n, rem] = value.split(':').map(Number); ok = n ? num(v) % n === rem : false; break; }
      case 'starts': ok = value !== '' && v.startsWith(value); break;
      case 'ends': ok = value !== '' && v.endsWith(value); break;
      default: ok = !['', 'false', '0'].includes(v);
    }
    if (ok === k.not) return false;
  }
  return true;
}

/** Concrete values shared by styles and colour-valued widget parameters. */
function tokenValue(raw: string, r: Context): string {
  if (r.screen) {
    const palette = r.screen.palette;
    raw = raw.replace(/\$palette\.([A-Za-z0-9_-]+)/g, (_, name: string) => {
      const value = palette[name];
      if (value === undefined) throw new Error(`Unknown palette colour $palette.${name}`);
      return value;
    });
  }
  const value = mixColours(withUi(raw, r.ui).replace(/\$([A-Za-z0-9_-]+)/g, (_, name: string) => {
    const value = r.doc.tokens?.[name];
    if (value === undefined) throw new Error(`Unknown token $${name}`);
    return value;
  }));
  // Screens: points (`8pt`) are never scaled; written as the px the renderer scales back to them.
  return r.screen ? pointsToPx(value, r.screen.scale) : value;
}

/** A `with` value that names a token (`ink: "$ui.ink"`) stands in a style as that token, so it resolves. */
function tokenArgs(text: string, scope: HoleScope): string {
  return text.replace(/\{arg\.(\^*\w+)\}/g, (hole, name: string) => {
    const arg = scope.args[name];
    return arg && typeof arg.template === 'string' && arg.template.includes('$') ? arg.template : hole;
  });
}

/** Style tokens substituted and bound values compiled. */
function css(style: Style | undefined, r: Context): CssT {
  const out: CssT = {};
  // Screens: a unitless line height beside a px font size becomes a half-point length (look.px).
  const line = r.screen && style?.['line-height'] && style['font-size']
    ? lineHeightPoints(tokenValue(style['font-size'], r), style['line-height'], r.screen.scale, r.screen.step) : undefined;
  if (line) style = { ...style, 'line-height': line };
  for (const [row, raw] of Object.entries(style ?? {})) {
    if (raw === undefined) continue;
    const text = tokenValue(r.screen ? tokenArgs(String(raw), r.screen.scope) : String(raw), r);
    if (r.screen) {
      // Any row may hold a hole; each is validated once filled (resolve/screen-style.ts).
      if (UNSAFE.test(text.replace(/\{[^{}]*\}/g, ''))) throw new Error(`Unsafe style value: ${row}: ${raw}`);
      out[row] = screenStyleRow(row, text, r.screen.scope, r.screen.scale, r.screen.step);
      continue;
    }
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
  // A TV is a class of its own (renderer 19); then a partly open foldable and the platform (renderer 20).
  return Object.assign({}, base, ...applied.map(m => m.style), r.tv && node.tv ? node.tv : {}, r.fold && node.fold ? node.fold : {},
    r.platform && node.platforms?.[r.platform] ? node.platforms[r.platform] : {});
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
  if (node.type === 'use' && r.screen) return useScreen(node, depth, r);
  if (node.type === 'use') {
    const template = r.doc.templates?.[node.template];
    if (!template) throw new Error(`Unknown template ${node.template}`);
    // A shared part keeps the caller's typography, viewport variants and interaction states.
    const { type: _type, template: _name, ...overrides } = node;
    const breakpoints = (a?: Record<string, Style>, b?: Record<string, Style>) => Object.fromEntries(
      [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].map(key => [key, { ...a?.[key], ...b?.[key] }]));
    return convert({ ...template, ...overrides, style: { ...template.style, ...node.style },
      small: { ...template.small, ...node.small }, wide: { ...template.wide, ...node.wide }, tv: { ...template.tv, ...node.tv },
      below: breakpoints(template.below, node.below), above: breakpoints(template.above, node.above),
      when: [...(template.when ?? []), ...(node.when ?? [])],
      motion: node.motion ?? template.motion, stagger: node.stagger ?? template.stagger } as Node, depth, r);
  }
  // The app's own rewrites of skin routes (row links, loaders, library guards) read the vocabulary:
  // a screen document has none of it.
  if (!r.screen) node = skinRewrites(node, r);
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
  const onChange = r.screen && node.onChange ? { value: compile(node.onChange.value, r)!, motion: r.doc.motion?.[node.onChange.motion] as Motion | undefined } : undefined;
  if (onChange && !onChange.motion) throw new Error(`Unknown motion ${node.onChange!.motion}`);
  // A tabs block's `label` and `testId` belong to each option's chip (screens: tabsNode()).
  const named = node.type === 'tabs' ? undefined : node.label;
  const testId = node.type === 'tabs' ? undefined : node.testId;
  const common: Common = {
    when: tests(node.when, r),
    base: layer(style, { ...node, label: named }),
    states: statesOf(node).map(s => ({ when: tests(s.when, r), layer: layer({ ...style, ...s.style }, s) })),
    active: node.active && css(node.active, r),
    disabled: node.disabled && tests(node.disabled, r),
    disabledStyle: node.disabledStyle && css(node.disabledStyle, r),
    motion,
    stagger: node.stagger,
    role: node.role ?? node.a11y?.role,
    label: compile(named, r),
    brand: 'press' in node && node.press?.action === 'home' && typeof node.label === 'string' && /\{[st]:(ui\.)?velaHome\}/.test(node.label),
    level: node.level,
    testId: compile(testId, r),
    id: compile(node.id, r),
    hidden: node.a11y?.hidden,
    a11y: node.a11y && { selected: node.a11y.selected && tests(node.a11y.selected, r), expanded: node.a11y.expanded && tests(node.a11y.expanded, r),
      current: node.a11y.current && tests(node.a11y.current, r), pressed: node.a11y.pressed && tests(node.a11y.pressed, r), checked: node.a11y.checked && tests(node.a11y.checked, r),
      haspopup: node.a11y.haspopup, title: compile(node.a11y.title, r) },
    group: node.group === true,
    ...('press' in node && node.press && !takesDirectionalFocus(node.press.action, node.press.arg) ? { directionalFocus: false as const } : {}),
    escape: node.escape ? node.escape.split(/\s+/).filter(Boolean) : undefined,
    returnFocus: compile(node.returnFocus, r),
    order: Number(style.order) || 0,
    ...(node.when?.some(test => test.test === 'nav.more' && !test.not && (test.is ?? 'set') === 'set') ? { navMore: true } : {}),
    ...(onChange ? { onChange: onChange as { value: Template; motion: Motion } } : {}),
    ...(r.screen && node.needs?.length ? { needs: [...node.needs] } : {}),
  };
  for (const row of ['grid-row', 'grid-column', 'grid-template-rows', '-webkit-text-stroke']) if (style[row as keyof Style]) r.unsupported.add(row);
  if (style['box-sizing'] === 'content-box') r.unsupported.add('box-sizing: content-box');
  if (style.display === 'block' || style.display === 'contents') r.unsupported.add(`display: ${style.display}`);

  switch (node.type) {
    case 'box': {
      const children = r.screen ? screenChildren(node.children ?? [], depth, r) : (node.children ?? []).map(child => convert(child, depth + 1, r));
      if (children.some(child => child.order !== 0)) children.sort((a, b) => a.order - b.order);
      return { ...common, kind: 'box', children, controlStates: node.controlStates !== false,
        press: node.press && pressOf(node.press, r), pager: node.pager,
        ...(node.fit === 'nav' ? { fit: 'nav' as const } : {}), ...(node.readingStop && !node.press ? { readingStop: true as const } : {}) };
    }
    // Legacy and new documents get the same safe synopsis control from this binding.
    // A text that is the viewer's initial is their badge: the renderer draws their avatar over it,
    // in whatever shape the skin gives the badge, so every document's profile control shows it.
    case 'text': return { ...common, kind: 'text', text: compile(node.text, r)!, summary: ['{detail.summary}', '{personPage.biography}'].includes(node.text.trim()),
      avatar: node.text.trim() === '{env.viewerInitial}',
      ...(node.spans?.length ? { spans: node.spans.map(span => ({ text: compile(span.text, r)!, style: css(span.style, r), when: tests(span.when, r) })) } : {}) };
    case 'image': return { ...common, kind: 'image', src: compile(node.src, r, true)!, alt: compile(node.alt, r), fade: node.fade === true,
      ...(r.screen && node.fallback ? { fallback: convert(node.fallback, depth + 1, r) } : {}) };
    case 'icon': return { ...common, kind: 'icon', symbol: r.screen ? screenSymbol(node.symbol, r) : node.symbol, paths: node.paths, viewBox: node.viewBox, fillRule: node.fillRule };
    case 'repeat': {
      if (r.screen) {
        const items = itemsOf(node, r);
        return { ...common, kind: 'repeat', over: items.path, limit: items.limit, items, item: withAlias(r, items.as, () => convert(node.item, depth + 1, r)) };
      }
      return { ...common, kind: 'repeat', over: node.over, limit: node.limit ?? 1000,
        ...(node.limit === undefined ? { implicitLimit: true } : {}), item: convert(node.item, depth + 1, r) };
    }
    case 'slot': return slotNode(node, common, r);
    case 'widget': {
      // Parameters are text: client and document strings are filled now; holes (`{value}`, bindings) stay for the widget.
      const params = Object.fromEntries(Object.entries(node.params ?? {}).map(([k, v]) => [k, strings(v, r)]));
      // Native TextInput takes a concrete colour, not a document's $token name.
      if (params.placeholderColor) params.placeholderColor = tokenValue(params.placeholderColor, r);
      return { ...common, kind: 'widget', widget: node.widget, params };
    }
    default:
      if (r.screen) return blockNode(node, common, depth, r);
      // Blocks read a screen's data: a skin document has none, so they draw nothing there (or their fallback).
      r.unsupported.add(`block ${(node as { type: string }).type}`);
      return { ...common, kind: 'box', children: fallbackOf(node, depth, r), controlStates: false };
  }
}

/** Rewrites the app applies to skin documents' routes (never to screen documents). */
function skinRewrites(node: Exclude<Node, UseNode>, r: Context): Exclude<Node, UseNode> {
  node = withRowLinks(node, r.doc.templates?.velaSeeAll);
  // Loading is app-owned across skins. Keep the document's condition and placement,
  // but use the same passive branded indicator for status surfaces.
  const waiting = node.when?.find(test => !test.not && (
    (test.test === 'env.load' || test.test === 'env.search') && test.is === 'eq' && test.value === 'loading'
    || ['env.libraryMoreLoading', 'env.collectionMoreLoading', 'env.homeMoreLoading'].includes(test.test)
  ));
  if (node.role === 'status' && waiting) {
    node = { type: 'widget', widget: 'contentLoader', when: node.when,
      params: { inline: waiting.test.endsWith('MoreLoading') ? 'true' : 'false' } };
  }
  // Legacy/custom skins may count items without guarding the active query's load.
  if (node.when?.some(test => test.test === 'library.itemCount' && test.is === 'eq' && test.value === '0' && !test.not)) {
    node = { ...node, when: [...node.when, { test: 'library.viewLoad', is: 'eq', value: 'ready' }] };
  }
  node = withLibraryPresentation(node, r.width);
  return node;
}

// Screens (docs/plugin-screens.md). Resolved with the same convert(), holes reading ScreenScope.

/** A press with its named arguments and optimistic patch compiled. */
function pressOf(press: NonNullable<BoxNode['press']>, r: Context): RPress {
  return {
    action: press.action, arg: compile(press.arg, r), focus: compile(press.focus, r),
    ...(r.screen && press.args ? { args: Object.fromEntries(Object.entries(press.args).map(([k, v]) => [k, compile(v, r)!])) } : {}),
    ...(r.screen && press.args ? { argValues: Object.fromEntries(Object.entries(press.args).flatMap(([k, v]) => {
      const hole = singleHole(v);
      return hole && !hole.startsWith('s:') ? [[k, holeValue(hole, r.screen!.scope)]] : [];
    })) } : {}),
    ...(r.screen && press.optimistic ? { optimistic: { record: compile(press.optimistic.record, r), source: press.optimistic.source,
      path: press.optimistic.path, value: compile(press.optimistic.value, r)!,
      ...(singleHole(press.optimistic.value) && !singleHole(press.optimistic.value)!.startsWith('s:') ? { raw: holeValue(singleHole(press.optimistic.value)!, r.screen.scope) } : {}) } } : {}),
  };
}

/** A box's children; a `children` slot inside a template draws the `use`'s children there. Outside
 * any template (renderer 20: an experience's shell) it is the host's slot, where the page draws. */
function screenChildren(children: Node[], depth: number, r: Context): RNode[] {
  return children.flatMap(child => child.type === 'slot' && child.slot === 'children' && r.screen!.slot
    ? r.screen!.slot
    : [convert(child, depth + 1, r)]);
}

/** An icon symbol; `{arg.glyph}` stands for a literal argument. */
function screenSymbol(symbol: string | undefined, r: Context): string | undefined {
  if (!symbol?.includes('{')) return symbol;
  const filled = compileTemplate(symbol, r.screen!.scope);
  if (typeof filled === 'string') return filled || undefined;
  r.screen!.warnings.add(`An icon symbol must be literal: ${symbol}`);
  return undefined;
}

/** Run with an item alias in scope (a repeat's or block's `as`). */
function withAlias<T>(r: Context, as: string, run: () => T): T {
  const screen = r.screen!;
  const saved = screen.scope;
  screen.scope = { ...saved, aliases: new Set([...saved.aliases, as]) };
  try { return run(); } finally { screen.scope = saved; }
}

const ROOTS = new Set(['src', 'param', 'state', 'context', 'env', 'arg', '$index', '$tab']);

/** A collection's fields compiled: `over` and `exclude` in the enclosing scope, `key` per item. */
function itemsOf(node: { over: string; as?: string; skip?: number; limit?: number; exclude?: string; key?: string; asOf?: { at: string; time: string } }, r: Context): Items {
  const scope = r.screen!.scope;
  const as = node.as ?? 'item';
  if (!/^[A-Za-z_]\w*$/.test(as) || ROOTS.has(as)) throw new Error(`A collection's "as" is a name that is not a binding root: ${as}`);
  const limit = Math.min(node.limit ?? SCREEN_ARRAY_ITEMS, SCREEN_ARRAY_ITEMS);
  const key = node.key === undefined ? undefined : node.key.includes('{') ? node.key : `{${as}.${node.key}}`;
  const at = node.asOf?.at.split('.') ?? [];
  return {
    over: pathField(node.over, scope),
    path: singleHole(node.over) === undefined ? node.over.trim() : (scope.args[singleHole(node.over)!.replace(/^arg\./, '')]?.path ?? node.over),
    as,
    skip: Math.max(0, node.skip ?? 0),
    limit,
    ...(node.exclude ? { exclude: compile(node.exclude, r) } : {}),
    ...(key ? { key: withAlias(r, as, () => compile(key, r)) } : {}),
    ...(node.asOf ? { asOf: { at: at[0] === as ? at.slice(1) : at, time: compile(node.asOf.time, r)! } } : {}),
  };
}

/** Of a per-class value, the one for this viewport. */
function perClass<T>(value: PerClass<T> | undefined, r: Context): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return value as T;
  const v = value as { default: T; small?: T; wide?: T; tv?: T };
  if (r.tv && v.tv !== undefined) return v.tv;
  if (r.width < 640 && v.small !== undefined) return v.small;
  if (r.width >= 1200 && v.wide !== undefined) return v.wide;
  return v.default;
}

/** A length field (`gap`, `itemWidth`, `height`): tokens substituted and folded. */
function lengthField(value: string | undefined, r: Context): string | undefined {
  if (value === undefined) return undefined;
  const text = fold(halfPoints(tokenValue(value, r), r.screen!.scale, r.screen!.step));
  if (UNSAFE.test(text)) throw new Error(`Unsafe length: ${value}`);
  return text;
}

/** A renderer 19 block. */
function blockNode(node: Node, common: Common, depth: number, r: Context): RNode {
  switch (node.type) {
    case 'sections':
      return { ...common, kind: 'sections', children: screenChildren(node.children ?? [], depth, r), gap: lengthField(node.gap, r) };
    case 'shelf': {
      const items = itemsOf(node, r);
      return { ...common, kind: 'shelf', items, item: withAlias(r, items.as, () => convert(node.item, depth + 1, r)),
        itemWidth: lengthField(perClass(node.itemWidth, r), r), gap: lengthField(node.gap, r), stableOrder: node.stableOrder === true,
        ...(node.empty ? { empty: convert(node.empty, depth + 1, r) } : {}) };
    }
    case 'grid': {
      const items = itemsOf(node, r);
      const columns = Number(perClass(node.columns, r) ?? 1);
      if (!Number.isInteger(columns) || columns < 1 || columns > 12) throw new Error(`A grid has 1 to 12 columns (${columns})`);
      return { ...common, kind: 'grid', items, item: withAlias(r, items.as, () => convert(node.item, depth + 1, r)), columns, gap: lengthField(node.gap, r) };
    }
    case 'marquee': {
      const items = itemsOf(node, r);
      return { ...common, kind: 'marquee', items, item: withAlias(r, items.as, () => convert(node.item, depth + 1, r)), gap: lengthField(node.gap, r),
        ...(node.speed !== undefined ? { speed: node.speed } : {}) };
    }
    case 'tabs': return tabsNode(node, common, depth, r);
    case 'table': return { ...common, kind: 'table', data: pathField(node.data, r.screen!.scope), compact: node.compact === true,
      ...(node.focusRows !== undefined ? { focusRows: node.focusRows } : {}), ...(node.highlight === false ? { highlight: false as const } : {}) };
    case 'lineGraph': return { ...common, kind: 'lineGraph', series: pathField(node.series, r.screen!.scope),
      ...(node.sides ? { sides: pathField(node.sides, r.screen!.scope) } : {}), subject: compile(node.subject, r), live: compile(node.live, r),
      height: lengthField(perClass(node.height, r), r) };
    case 'player':
      // Without a channel (renderer 20) the player is the rich playback block.
      if (node.channel === undefined) return richNode(node, common, depth, r);
      return { ...common, kind: 'player', channel: compile(node.channel, r)!, ...blockFallback(node, depth, r) };
    case 'paramInput': return { ...common, kind: 'paramInput', param: node.param, placeholder: compile(node.placeholder, r) };
    case 'titleCard': return { ...common, kind: 'titleCard', item: compile(node.item, r)! };
    default:
      if ((node as { type: string }).type in RICH_BLOCKS) return richNode(node as RichNode, common, depth, r);
      // An unknown block inside an accepted document draws its fallback, or nothing (docs/plugin-screens.md: Versioning).
      r.screen!.warnings.add(`Unknown node type ${(node as { type: string }).type}: drawn as ${(node as { fallback?: Node }).fallback ? 'its fallback' : 'nothing'}`);
      return { ...common, kind: 'box', children: fallbackOf(node, depth, r), controlStates: false };
  }
}

/** A block's `fallback` (renderer 20), resolved, as a box's children. */
function fallbackOf(node: Node, depth: number, r: Context): RNode[] {
  const fallback = (node as { fallback?: Node }).fallback;
  return fallback && typeof fallback === 'object' ? [convert(fallback, depth + 1, r)] : [];
}

/** A known block's `fallback`, for the block to draw where it cannot run. */
function blockFallback(node: Node, depth: number, r: Context): { fallback?: RNode } {
  const [fallback] = fallbackOf(node, depth, r);
  return fallback ? { fallback } : {};
}

/** A slot: a foundation slot, or (renderer 20) a published plugin slot with its context compiled. */
function slotNode(node: SlotNode, common: Common, r: Context): RNode {
  const inner = node.inner && css(node.inner, r);
  if (node.slot === 'children' || node.slot === 'searchField') return { ...common, kind: 'slot', slot: node.slot, inner };
  const id = String(node.slot).replace(/^plugin:/, '');
  const spec = String(node.slot).startsWith('plugin:') ? slotSpec(id) : undefined;
  const warn = (text: string) => (r.screen ? r.screen.warnings.add(text) : r.unsupported.add(text));
  if (!spec) {
    warn(`Unknown slot ${String(node.slot)}: drawn as nothing`);
    return { ...common, kind: 'box', children: [], controlStates: false };
  }
  const names = new Set(spec.context.map(c => c.name));
  const context: Record<string, Template> = {};
  for (const [name, value] of Object.entries(node.context ?? {})) {
    if (names.has(name)) context[name] = compile(value, r)!;
    else warn(`Slot ${id} has no context ${name}`);
  }
  const cap = spec.cap.perSlot;
  const limit = node.limit === undefined ? cap : Math.max(0, Math.min(node.limit, cap ?? node.limit));
  return { ...common, kind: 'slot', slot: node.slot, inner, context, ...(limit !== undefined ? { limit } : {}) };
}

const LAYER_KEYS = new Set(['style', 'small', 'wide', 'tv', 'fold', 'platforms', 'hover', 'focus', 'active']);

/** A part style as layers (a bare style is the `style` layer). */
function partLayers(part: PartStyle | undefined): PartLayers {
  if (!part || typeof part !== 'object') return {};
  return Object.keys(part).some(k => LAYER_KEYS.has(k)) ? part as PartLayers : { style: part as Style };
}

/** Part styles merged, later ones over earlier ones, layer by layer. */
function mergeParts(list: (PartStyle | undefined)[]): PartLayers {
  const out: Record<string, Record<string, unknown>> = {};
  for (const layers of list.map(partLayers)) {
    for (const [key, value] of Object.entries(layers)) {
      if (!value) continue;
      if (key === 'platforms') {
        const platforms = (out.platforms ??= {}) as Record<string, Style>;
        for (const [p, style] of Object.entries(value as Record<string, Style>)) platforms[p] = { ...platforms[p], ...style };
      } else out[key] = { ...out[key], ...(value as Style) };
    }
  }
  return out as PartLayers;
}

/** A rich block (rich-blocks.ts): props compiled, parts and part templates merged and resolved. */
function richNode(node: RichNode | VisualizerNode | PlayerNode, common: Common, depth: number, r: Context): RNode {
  const screen = r.screen!;
  const block = node.type as RichBlockName;
  const spec: RichBlockSpec = RICH_BLOCKS[block];
  const warn = (text: string) => screen.warnings.add(`${block}: ${text}`);
  const raw: Record<string, string> = { ...node.props };
  if (node.type === 'visualizer') {
    raw.mode = node.mode;
    if (node.sceneId !== undefined) raw.sceneId = node.sceneId;
  }
  const props: Record<string, Arg> = {};
  for (const [name, value] of Object.entries(raw)) {
    const prop = spec.props[name];
    if (!prop) { warn(`no prop ${name}`); continue; }
    if (typeof value !== 'string') { warn(`prop ${name} is not text`); continue; }
    if (prop.type === 'enum' && !value.includes('{') && !prop.values?.includes(value)) { warn(`prop ${name} is not one of ${prop.values?.join(', ')}`); continue; }
    props[name] = makeArg(value, screen.scope);
  }
  const fallback = blockFallback(node, depth, r);
  const missing = Object.entries(spec.props).filter(([name, prop]) => prop.required && !props[name]).map(([name]) => name);
  if (missing.length) {
    warn(`needs ${missing.join(', ')}: drawn as its fallback`);
    return { ...common, kind: 'box', children: fallback.fallback ? [fallback.fallback] : [], controlStates: false };
  }
  const published = new Set(spec.parts);
  for (const name of Object.keys(node.parts ?? {})) if (!published.has(name)) warn(`no part ${name}`);
  const parts: Record<string, RPart> = {};
  for (const name of spec.parts) {
    const sources = [screen.parts?.doc[name], node.parts?.[name], screen.parts?.skin[name]];
    if (sources.every(s => s === undefined)) continue;
    const layers = mergeParts(sources);
    const style = variant({ type: 'box', ...layers } as Node, r, layers.style);
    parts[name] = { style: css(style, r), ...(layers.hover ? { hover: css(layers.hover, r) } : {}),
      ...(layers.focus ? { focus: css(layers.focus, r) } : {}), ...(layers.active ? { active: css(layers.active, r) } : {}) };
  }
  const templated = new Set(spec.templates);
  for (const name of Object.keys(node.partTemplates ?? {})) if (!templated.has(name)) warn(`part ${name} takes no template`);
  const templates: Record<string, RNode> = {};
  for (const name of spec.templates) {
    const template = screen.partTemplates?.skin[name] ?? node.partTemplates?.[name] ?? screen.partTemplates?.doc[name];
    if (template) templates[name] = withAlias(r, 'item', () => withAlias(r, 'part', () => convert(template, depth + 1, r)));
  }
  return { ...common, kind: 'rich', block, props, parts, templates, ...fallback };
}

/** Tabs: the options' value, label and count per item, and the chip each is drawn with. */
function tabsNode(node: TabsNode, common: Common, depth: number, r: Context): RNode {
  const items = itemsOf(node, r);
  if (!node.bind || (!node.bind.param) === (!node.bind.state)) throw new Error('A tabs block binds exactly one of a param or a state');
  const chipName = node.chip ?? 'vela:tab';
  const chip = withAlias(r, items.as, () => withAlias(r, '$tab', () => {
    const drawn = convert({ type: 'use', template: chipName, testId: node.testId,
      with: { label: '{$tab.label}', count: '{$tab.count}', on: '{$tab.on}', ...(node.size === 'small' ? { small: 'true' } : {}) } }, depth + 1, r);
    if (drawn.kind !== 'box') throw new Error(`A tabs chip is a box template (${chipName})`);
    return drawn;
  }));
  const after = node.after ? screenChildren(node.after, depth, r) : undefined;
  return withAlias(r, items.as, () => ({
    ...common, kind: 'tabs' as const, items, value: compile(node.value, r)!, label: compile(node.label, r)!, count: compile(node.count, r),
    bind: { ...(node.bind.param ? { param: node.bind.param } : { state: node.bind.state }), ...(node.bind.clear ? { clear: [...node.bind.clear] } : {}) },
    default: compile(node.default, r), all: compile(node.all, r), chip, small: node.size === 'small', ...(after ? { after } : {}), ...(node.pin ? { pin: true } : {}),
  }));
}

/** Rewrite a caller's `{arg.*}` so it still reads the caller's arguments inside the template (`arg.^name`). */
function callerArgs<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/(^|[{=,|])arg\./g, '$1arg.^') as T;
  if (Array.isArray(value)) return value.map(callerArgs) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, callerArgs(v)])) as T;
  return value;
}

/** A `use` in a screen: a document or kit template inlined, its `with` read as {arg.*} and its
 * `children` drawn at the template's `children` slot. The caller's own fields (style, when,
 * press, testId…) keep reading the caller's arguments. */
function useScreen(node: UseNode, depth: number, r: Context): RNode {
  const screen = r.screen!;
  const kit = node.template.startsWith('vela:');
  const template = kit ? screen.kit[node.template] : r.doc.templates?.[node.template];
  if (!template) {
    if (!kit) throw new Error(`Unknown template ${node.template}`);
    // An unknown kit template in an accepted document draws nothing (its name is not in `requires`).
    screen.warnings.add(`Unknown kit template ${node.template}: drawn as nothing`);
    return convert({ type: 'box', when: node.when }, depth, r);
  }
  const args: Record<string, Arg> = {};
  for (const [name, raw] of Object.entries({ ...kitDefaults(node.template), ...node.with })) args[name] = makeArg(raw, screen.scope);
  const slot = node.children ? screenChildren(node.children, depth, r) : undefined;
  const { type: _type, template: _name, with: _with, children: _children, ...own } = node;
  const overrides = callerArgs(own);
  const breakpoints = (a?: Record<string, Style>, b?: Record<string, Style>) => Object.fromEntries(
    [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].map(key => [key, { ...a?.[key], ...b?.[key] }]));
  const merged = { ...template, ...overrides, style: { ...template.style, ...overrides.style },
    small: { ...template.small, ...overrides.small }, wide: { ...template.wide, ...overrides.wide }, tv: { ...template.tv, ...overrides.tv },
    below: breakpoints(template.below, overrides.below), above: breakpoints(template.above, overrides.above),
    when: [...(template.when ?? []), ...(overrides.when ?? [])],
    motion: overrides.motion ?? template.motion, stagger: overrides.stagger ?? template.stagger } as Node;
  const saved = { scope: screen.scope, slot: screen.slot };
  const inherited = Object.fromEntries(Object.entries(saved.scope.args).map(([name, arg]) => [`^${name}`, arg]));
  screen.scope = { ...saved.scope, args: { ...inherited, ...args } };
  // Inside a template its `children` slot is the use's children (none: nothing), never the host's.
  screen.slot = slot ?? [];
  try {
    const drawn = convert(merged, depth, r);
    // vela:panel takes focus on TV only when asked (`focusable`), which data may decide.
    if (node.template === 'vela:panel' && drawn.kind === 'box') {
      const focusable = args.focusable;
      const { readingStop: _stop, ...rest } = drawn;
      if (!focusable) return rest;
      if (typeof focusable.template === 'string') return ['', 'false', '0'].includes(focusable.template) ? rest : drawn;
      return { ...rest, readingStopWhen: tests([{ test: 'arg.focusable' }], r) };
    }
    return drawn;
  } finally {
    screen.scope = saved.scope;
    screen.slot = saved.slot;
  }
}

/** A node resolved in a context (resolve/screen.ts resolves screen documents through this). */
export function convertNode(node: Node, r: Context): RNode {
  return convert(node, 1, r);
}

/** Older collection documents omitted continuation; row grids must always scroll through all pages. */
function collectionContinuation(tree: RNode, r: Context): RNode {
  const contains = (node: RNode): boolean => node.kind === 'widget' && node.widget === 'sentinel' && node.params.on === 'collection'
    || node.kind === 'box' && node.children.some(contains) || node.kind === 'repeat' && contains(node.item);
  if (contains(tree)) return tree;
  const sentinel = convert({ type: 'widget', widget: 'sentinel', params: { on: 'collection' },
    when: [{ test: 'collection.more' }, { test: 'env.collectionMoreLoading', not: true }], style: { height: '1px', width: '100%' } }, 1, r);
  const add = (node: RNode): RNode => node.kind !== 'box' ? node : { ...node, children:
    node.children.some(child => child.kind === 'repeat' && child.over === 'collection.items')
      ? [...node.children, sentinel] : node.children.map(add) };
  return add(tree);
}

/** Resolve a document for a viewport width and locale. A document that needs a newer renderer
 * is refused on its version, never half-drawn. */
export function resolveDocument(own: SkinDocument, width: number, locale = 'en', branding?: Branding): ResolvedDocument {
  if (own.schema !== 1) throw new Error(`Skin document schema ${String(own.schema)} is not supported`);
  if (own.renderer > RENDERER_VERSION) throw new Error(`${own.name} needs renderer ${own.renderer}; this client draws ${RENDERER_VERSION}`);
  const inherited = own.id === velaBase.id ? own : withBase(own, velaBase);
  const doc = brandDocument(inherited, branding, resolveUi(inherited.ui).page);
  const strings = { ...doc.strings?.en, ...doc.strings?.[locale.split('-')[0]], ...doc.strings?.[locale] };
  const r: Context = { doc, ui: resolveUi(doc.ui), strings, width, count: 0, unsupported: new Set() };
  const home = doc.slots?.home ?? doc.routes?.home;
  const mediaTitle = mediaTitleTree(doc.routes?.title);
  const resolvedMediaTitle = mediaTitle && convert(mediaTitle, 1, { ...r, count: 0 });
  return {
    id: doc.id,
    name: doc.name,
    document: doc,
    guideLayout: doc.routes?.live?.type === 'widget' && doc.routes.live.widget === 'guide'
      && doc.routes.live.params?.layout === 'cinematic' ? 'cinematic' : undefined,
    shell: doc.slots?.shell && convert(doc.slots.shell, 1, r),
    libraryViews: doc.templates?.velaLibraryViews && convert({ type: 'use', template: 'velaLibraryViews' }, 1, r),
    routes: Object.fromEntries([
      ...(home ? [['home', convert(withHeroArtwork(home), 1, r)]] : []),
      ...Object.entries(doc.routes ?? {}).filter(([name, tree]) => name !== 'home' && tree).map(([name, tree]) => { const resolved = convert(tree as Node, 1, r); return [name, name === 'collection' ? collectionContinuation(resolved, r) : resolved]; }),
    ]) as ResolvedDocument['routes'],
    // Derived by the client, so it never counts against the document's own node budget.
    mediaTitle: resolvedMediaTitle,
    mediaTitleSlot: resolvedMediaTitle && inlineMediaTitleTree(resolvedMediaTitle),
    motion: (doc.motion ?? {}) as Record<string, Motion>,
    keyframes: documentKeyframes(doc.keyframes),
    unsupported: [...r.unsupported],
  };
}
