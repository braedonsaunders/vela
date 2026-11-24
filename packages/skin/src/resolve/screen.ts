// A plugin screen or surface document (packages/protocol/screen.ts, docs/plugin-screens.md)
// resolved for the React renderer, as resolveDocument resolves a skin: checked against its limits
// and the client's renderer version (refused whole, never half-drawn), its literal colours held to
// white, black and its palette, tokens folded over the active skin's $ui, templates (its own and
// the kit's) inlined with their arguments, viewport variants picked, and holes compiled to read
// the page's data. Done once per document, viewport and locale.
import type { Node, SkinDocument } from '../../../protocol/skin';
import { SCREEN_LIMITS, type ScreenDocument } from '../../../protocol/screen';
import { BLOCK_KINDS, RENDERER_VERSION, convertNode, type Context, type RNode, type Template } from '../resolve';
import type { Keyframes, Motion } from '../keyframes';
import { compileTemplate } from '../screen/holes';
import { KIT_MOTION, KIT_NAMES, kitTemplates } from '../screen/kit';
import { parseColour } from '../screen/colour';
import { mixColours } from './colour-mix';
import { fold } from './screen-style';
import { resolveUi, withUi } from './ui';
import type { UiTokens } from './ui-defaults';

export interface ScreenViewport {
  /** The slot's width in CSS px (the window's for a section or page). */
  width: number;
  /** A TV: `tv` variants and per-class values apply. */
  tv?: boolean;
  /** Points per CSS px on this device (css.ts: 1.25 on Apple TV, tvPixelScale on Android TV). Lengths
   * then land on half points, as the hard-coded screens' look.px did. Default 1 (no rounding). */
  scale?: number;
}

export interface ResolvedScreen {
  document: ScreenDocument;
  title: Template;
  tree: RNode;
  /** Drawn while the first read is pending, and when it fails (generic ones when the document has none). */
  loading: RNode;
  failure: RNode;
  /** The element id focused first on TV and keyboard. */
  focusInitial?: Template;
  /** The document's motion presets, each carrying its keyframes (`frames`). */
  motion: Record<string, Motion>;
  /** What draws differently than written: refused literal colours, unknown kit templates or blocks. */
  warnings: string[];
  unsupported: string[];
}

/** Block and kit names a document may require (`requires`). */
export const SCREEN_CAPABILITIES: ReadonlySet<string> = new Set([...BLOCK_KINDS, ...KIT_NAMES]);

/** Literal colours a document may write: white and black at any opacity, and transparent. */
function allowedLiteral(colour: string): boolean {
  const word = colour.trim().toLowerCase();
  if (word === 'transparent' || word === 'currentcolor') return true;
  const c = parseColour(word);
  if (!c) return false;
  const near = (v: number, to: number) => Math.abs(v - to) < 0.5;
  return [0, 255].some(x => near(c.r, x) && near(c.g, x) && near(c.b, x));
}

const NAMED = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse '
  + 'chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta '
  + 'darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet '
  + 'deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green '
  + 'greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan '
  + 'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey '
  + 'lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen '
  + 'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
  + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple '
  + 'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow '
  + 'springgreen steelblue tan teal thistle tomato turquoise violet wheat yellow yellowgreen').split(' '));

const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\)|\b[a-zA-Z]+\b/g;

/** A style value with every literal colour the document may not write replaced by transparent. */
export function heldColours(value: string, warn: (colour: string) => void): string {
  // References ($ui.ink, $palette.onTeam, $token) and holes are not literals.
  const masked = value.replace(/\$[\w.-]+|\{[^{}]*\}/g, m => ' '.repeat(m.length));
  let out = '';
  let at = 0;
  for (const m of masked.matchAll(LITERAL)) {
    const literal = value.slice(m.index!, m.index! + m[0].length);
    const word = /^[a-zA-Z]+$/.test(literal);
    if (word && !NAMED.has(literal.toLowerCase())) continue;
    if (allowedLiteral(literal)) continue;
    out += value.slice(at, m.index) + 'transparent';
    at = m.index! + m[0].length;
    warn(literal);
  }
  return out + value.slice(at);
}

const STYLE_KEYS = new Set(['style', 'small', 'wide', 'tv', 'hover', 'focus', 'groupHover', 'groupFocus', 'active', 'disabledStyle', 'inner']);

/** A node tree with its styles' literal colours held to the rule (a copy). */
function heldTree(node: unknown, warn: (colour: string) => void, inStyle = false): unknown {
  if (typeof node === 'string') return inStyle ? heldColours(node, warn) : node;
  if (Array.isArray(node)) return node.map(child => heldTree(child, warn, inStyle));
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(Object.entries(node).map(([key, value]) => {
    if (STYLE_KEYS.has(key)) return [key, heldTree(value, warn, true)];
    if (key === 'below' || key === 'above') {
      return [key, Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([px, style]) => [px, heldTree(style, warn, true)]))];
    }
    // A `with` value that is a whole colour reaches styles through {arg.*}: held the same.
    if (key === 'with' && value && typeof value === 'object') {
      return [key, Object.fromEntries(Object.entries(value).map(([name, raw]) =>
        [name, typeof raw === 'string' && parseColour(raw) ? heldColours(raw, warn) : raw]))];
    }
    return [key, heldTree(value, warn, inStyle)];
  }));
}

/** Every string in a value, for the length limit. */
function longestString(value: unknown): number {
  if (typeof value === 'string') return value.length;
  if (Array.isArray(value)) return value.reduce((n: number, v) => Math.max(n, longestString(v)), 0);
  if (value && typeof value === 'object') return Object.entries(value).reduce((n: number, [k, v]) => Math.max(n, k.length, longestString(v)), 0);
  return 0;
}

/**
 * A document's envelope, version, requirements and limits (SCREEN_LIMITS), checked before anything
 * draws. A document that fails is refused whole; the error names why.
 */
export function checkScreenDocument(doc: ScreenDocument): void {
  if (!doc || typeof doc !== 'object') throw new Error('A screen document is an object');
  if (doc.schema !== 1) throw new Error(`Screen document schema ${String(doc.schema)} is not supported`);
  if (doc.kind !== 'screen') throw new Error(`Not a screen document (kind ${String(doc.kind)})`);
  const name = `${doc.screen}/${doc.page}`;
  if (typeof doc.renderer !== 'number' || doc.renderer < 19) throw new Error(`${name}: a screen document needs renderer 19 or more`);
  if (doc.renderer > RENDERER_VERSION) throw new Error(`${name} needs renderer ${doc.renderer}; this client draws ${RENDERER_VERSION}`);
  for (const needed of doc.requires ?? []) {
    if (!SCREEN_CAPABILITIES.has(needed)) throw new Error(`${name} needs ${needed}, which this client does not draw`);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(doc)).length;
  if (bytes > SCREEN_LIMITS.documentBytes) throw new Error(`${name} is ${bytes} bytes; a screen document is at most ${SCREEN_LIMITS.documentBytes}`);
  const longest = longestString(doc);
  if (longest > SCREEN_LIMITS.stringLength) throw new Error(`${name} has a string of ${longest} characters; at most ${SCREEN_LIMITS.stringLength}`);
  const palette = Object.entries(doc.palette ?? {});
  if (palette.length > SCREEN_LIMITS.paletteColours) throw new Error(`${name} has ${palette.length} palette colours; at most ${SCREEN_LIMITS.paletteColours}`);
  for (const [key, colour] of palette) if (!parseColour(colour)) throw new Error(`${name}: $palette.${key} is not a colour (${colour})`);
  if (!doc.tree || typeof doc.tree !== 'object') throw new Error(`${name} has no tree`);
}

/** The document's keyframes (`doc:<name>`), with `color` resolved to a $ui value. */
function screenKeyframes(own: ScreenDocument['keyframes'], ui: UiTokens): Record<string, Keyframes> {
  return Object.fromEntries(Object.entries(own ?? {}).map(([name, steps]) => [`doc:${name}`, Object.fromEntries(Object.entries(steps).map(([at, p]) => {
    const transform: Record<string, number | string>[] = [];
    if (p.scale !== undefined) transform.push({ scale: Number(p.scale) });
    if (p.rotate !== undefined) transform.push({ rotate: `${Number(p.rotate)}deg` });
    if (p.translate !== undefined) {
      const [x = '0px', y = '0px'] = String(p.translate).trim().split(/\s+/);
      const len = (s: string) => (s.endsWith('%') ? s : parseFloat(s) || 0);
      transform.push({ translateX: len(x) }, { translateY: len(y) });
    }
    const colour = p.color === undefined ? undefined : withUi(String(p.color), ui);
    if (colour !== undefined && (!/^\$ui\./.test(String(p.color)) || !parseColour(colour))) throw new Error(`A keyframe colour is a $ui token (${p.color})`);
    return [at, { ...(p.opacity !== undefined ? { opacity: Number(p.opacity) } : {}), ...(transform.length ? { transform } : {}), ...(colour ? { color: colour } : {}) }];
  }))]));
}

/**
 * Resolve a screen or surface document for a viewport and locale, in the look of the active skin
 * (`ui`: its resolved `$ui` tokens, or its document's `ui` block). Throws when it is refused.
 */
export function resolveScreenDocument(doc: ScreenDocument, viewport: ScreenViewport, locale = 'en',
  ui: UiTokens | Record<string, unknown> = {}): ResolvedScreen {
  checkScreenDocument(doc);
  const tokens: UiTokens = 'page' in ui && 'fontDisplay' in ui && typeof (ui as UiTokens).radiusCard === 'number' ? ui as UiTokens : resolveUi(ui);
  const warnings = new Set<string>();
  const warn = (colour: string) => warnings.add(`Literal colour ${colour} drawn as transparent: a screen writes white, black, its palette or $ui`);
  const held = <T,>(node: T): T => heldTree(node, warn) as T;
  const palette = doc.palette ?? {};
  const keyframes = screenKeyframes(doc.keyframes, tokens);
  const motion: Record<string, Motion> = { ...KIT_MOTION as Record<string, Motion> };
  for (const [name, preset] of Object.entries(doc.motion ?? {})) {
    const used = [preset.keyframes, preset.still?.keyframes].filter((k): k is string => !!k && k.startsWith('doc:'));
    for (const k of used) if (!keyframes[k]) throw new Error(`Unknown keyframes ${k}`);
    motion[name] = { ...preset, frames: Object.fromEntries(used.map(k => [k, keyframes[k]!])) } as Motion;
  }
  // Tokens: $ui values, numbers, and min()/max()/color-mix() over them, folded once.
  const resolvedTokens: Record<string, string> = {};
  for (const [name, raw] of Object.entries(doc.tokens ?? {})) {
    const value = heldColours(String(raw), warn).replace(/\$palette\.([\w-]+)/g, (_, key: string) => {
      if (palette[key] === undefined) throw new Error(`Unknown palette colour $palette.${key}`);
      return palette[key]!;
    });
    if (/\$(?!ui\.)/.test(value)) throw new Error(`A token reads only $ui values and numbers ($${name}: ${raw})`);
    resolvedTokens[name] = mixColours(fold(withUi(value, tokens)));
  }
  const strings = doc.strings ?? {};
  const pseudo: SkinDocument = {
    schema: 1, renderer: doc.renderer, id: `screen:${doc.screen}/${doc.page}`, name: doc.screen, version: doc.version, swatches: [],
    tokens: resolvedTokens, templates: held(doc.templates ?? {}), motion,
  };
  const r: Context = {
    doc: pseudo, ui: tokens, strings, width: viewport.width, tv: viewport.tv === true, count: 0, unsupported: new Set(),
    screen: { scope: { strings, args: {}, aliases: new Set(), page: String(tokens.page) }, kit: kitTemplates(tokens), palette, warnings, scale: viewport.scale ?? 1 },
  };
  const tree = convertNode(held(doc.tree), r);
  // Without its own, a page draws a generic skeleton while loading and the kit's failure.
  const loading = convertNode(doc.loading ? held(doc.loading) : DEFAULT_LOADING, r);
  const failure = convertNode(doc.failure ? held(doc.failure) : DEFAULT_FAILURE, r);
  return {
    document: doc,
    title: compileTemplate(String(doc.title ?? ''), r.screen!.scope),
    tree,
    loading,
    failure,
    ...(doc.focus?.initial ? { focusInitial: compileTemplate(doc.focus.initial, r.screen!.scope) } : {}),
    motion,
    warnings: [...warnings],
    unsupported: [...r.unsupported],
  };
}

/** Every node of a resolved screen (for the budget and symbol checks). */
export function screenTrees(resolved: ResolvedScreen): [string, RNode][] {
  return [['tree', resolved.tree], ['loading', resolved.loading], ['failure', resolved.failure]];
}

const bar = (width: string, height: string): Node => ({ type: 'use', template: 'vela:placeholder', with: { width, height } });
const DEFAULT_LOADING: Node = { type: 'box', style: { padding: '12px max(28px, 4vw)', gap: '18px' }, small: { padding: '12px 18px' }, children: [
  bar('40%', '28px'), bar('100%', '220px'), { type: 'box', style: { 'flex-direction': 'row', gap: '14px' }, children: [bar('32%', '128px'), bar('32%', '128px'), bar('32%', '128px')] },
] };
const DEFAULT_FAILURE: Node = { type: 'use', template: 'vela:failure' };

export type { Node };
