// A plugin screen or surface document (packages/protocol/screen.ts, docs/plugin-screens.md)
// resolved for the React renderer, as resolveDocument resolves a skin: checked against its limits
// and the client's renderer version (refused whole, never half-drawn), its literal colours held to
// white, black and its palette, tokens folded over the active skin's $ui, templates (its own and
// the kit's) inlined with their arguments, viewport variants picked, and holes compiled to read
// the page's data. Done once per document, viewport and locale.
import type { FormFactor, Node, PartStyle, Platform, SkinDocument } from '../../../protocol/skin';
import { SCREEN_LIMITS, type ScreenDocument } from '../../../protocol/screen';
import { EXPERIENCE_ID, slotSpec, type ExperienceOverride, type PageOverride } from '../../../protocol/experiences';
import { RICH_BLOCKS } from '../../../protocol/rich-blocks';
import { VELA_ACTIONS, VELA_SOURCES } from '../../../protocol/vela-sources';
import { twoPanes } from '../widgets/media/window-layout';
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
  /** The points lengths round to: half points (0.5) by default; whole points (1) where a host draws as
   * a look that rounds each size (the player's look.size: overlays and toasts over the picture). */
  step?: number;
  /** Renderer 20: the window's height (with the width, whether it holds two panes: the `wide` form). */
  height?: number;
  /** Renderer 20: the platform (`platforms` variants), and a foldable held partly open (`fold`). */
  platform?: Platform;
  fold?: boolean;
}

/** Renderer 20: what else resolving a document reads. */
export interface ScreenResolveOptions {
  /** The active skin: its `experiences` overrides apply to built-in documents (owner `vela`) of that
   * experience, and its tokens and strings are there for the overrides to read. */
  skin?: Pick<SkinDocument, 'experiences' | 'tokens' | 'strings'>;
}

/** Width from which a window holds an experience's two panes (window-layout.ts: the music app's 980). */
export const WIDE_FORM_FROM = 980;

/** The form factor of a viewport (docs/experiences.md): `tv` on a TV, `fold` on a foldable held partly
 * open, `wide` in a window with room for two panes, `small` otherwise. */
export function formFactor(viewport: ScreenViewport): FormFactor {
  if (viewport.tv) return 'tv';
  if (viewport.fold) return 'fold';
  return twoPanes(viewport.width, viewport.height ?? 0, WIDE_FORM_FROM) ? 'wide' : 'small';
}

/** Forms tried in order: a partly open foldable falls back to its width's form. */
function formChain(viewport: ScreenViewport): FormFactor[] {
  const form = formFactor(viewport);
  return form === 'fold' ? ['fold', twoPanes(viewport.width, viewport.height ?? 0, WIDE_FORM_FROM) ? 'wide' : 'small'] : [form];
}

/** The tree a page draws here: a platform's replacement, else its form's, else its tree. */
function pickTree(page: { tree: Node; forms?: Partial<Record<FormFactor, Node>>; platforms?: Partial<Record<Platform, Node>> }, viewport: ScreenViewport): Node {
  const platform = viewport.platform ? page.platforms?.[viewport.platform] : undefined;
  if (platform) return platform;
  for (const form of formChain(viewport)) if (page.forms?.[form]) return page.forms[form]!;
  return page.tree;
}

/** Part template names (rich-blocks.ts): a template by one of these names is that part's template. */
const PART_TEMPLATES: ReadonlySet<string> = new Set(Object.values(RICH_BLOCKS).flatMap(spec => spec.templates as readonly string[]));

/** The skin's overrides that apply to a document: only to a built-in page of that experience. */
export function experienceOverride(doc: ScreenDocument, skin?: ScreenResolveOptions['skin']): ExperienceOverride | undefined {
  if (doc.owner !== 'vela' || !doc.experience) return undefined;
  return skin?.experiences?.[doc.experience];
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
  if (doc.owner !== undefined && doc.owner !== 'vela') throw new Error(`${name}: owner is "vela" or absent`);
  if (doc.owner === 'vela' && !EXPERIENCE_ID.test(String(doc.experience ?? ''))) throw new Error(`${name}: a built-in document names its experience`);
  if (doc.presentation === 'slot' && !slotSpec(String(doc.slot ?? ''))) throw new Error(`${name}: a slot surface names a published slot (${String(doc.slot)})`);
  const problems = velaUseProblems(doc);
  if (problems.length) throw new Error(`${name}: ${problems[0]}`);
}

const SOURCE_FIELDS = new Set(['from', 'lazy', 'deps']);
const CONTEXT_HOLE = /^\{context\.[A-Za-z_][\w.]*\}$/;

/**
 * What a document may not do with Vela's own sources and actions (docs/experiences.md): read a
 * `vela.*` source that is not published; and, in a plugin's document (no owner), pass a `vela.*`
 * source anything but `{context.*}` holes (so a plugin never names another title) or press a
 * `vela.*` local action. Ether enforces the same at install; `check` reports it.
 */
export function velaUseProblems(doc: ScreenDocument): string[] {
  const problems: string[] = [];
  const builtIn = doc.owner === 'vela';
  for (const [id, spec] of Object.entries(doc.sources ?? {})) {
    const from = String(spec?.from ?? '');
    if (!from.startsWith('vela.')) continue;
    if (!(from in VELA_SOURCES)) { problems.push(`source ${id} reads ${from}, which is not a published vela.* source`); continue; }
    if (builtIn) continue;
    for (const [arg, value] of Object.entries(spec)) {
      if (SOURCE_FIELDS.has(arg)) continue;
      if (typeof value !== 'string' || !CONTEXT_HOLE.test(value.trim())) problems.push(`source ${id} (${from}) argument ${arg} is not a {context.*} hole`);
    }
  }
  const presses = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(presses); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'press' && value && typeof value === 'object') {
        const press = value as { action?: string; args?: Record<string, unknown> };
        const name = press.action === 'plugin' ? String(press.args?.name ?? '') : '';
        if (name.startsWith('vela.')) {
          if (!builtIn) problems.push(`a plugin document cannot press the local action ${name}`);
          else if (!(name in VELA_ACTIONS)) problems.push(`${name} is not a published vela.* action`);
        }
      }
      presses(value);
    }
  };
  presses([doc.tree, doc.forms, doc.platforms, doc.templates, doc.loading, doc.failure]);
  return problems;
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
  ui: UiTokens | Record<string, unknown> = {}, options: ScreenResolveOptions = {}): ResolvedScreen {
  checkScreenDocument(doc);
  const override = experienceOverride(doc, options.skin);
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
  // Tokens: $ui values, numbers, and min()/max()/color-mix() over them, folded once. A skin's own tokens
  // are there for its overrides of a built-in page (the page's own win).
  const resolvedTokens: Record<string, string> = {};
  if (override) {
    for (const [name, raw] of Object.entries(options.skin?.tokens ?? {})) {
      try { resolvedTokens[name] = mixColours(fold(withUi(String(raw), tokens))); } catch { /* a token the screen language cannot read */ }
    }
  }
  for (const [name, raw] of Object.entries(doc.tokens ?? {})) {
    const value = heldColours(String(raw), warn).replace(/\$palette\.([\w-]+)/g, (_, key: string) => {
      if (palette[key] === undefined) throw new Error(`Unknown palette colour $palette.${key}`);
      return palette[key]!;
    });
    if (/\$(?!ui\.)/.test(value)) throw new Error(`A token reads only $ui values and numbers ($${name}: ${raw})`);
    resolvedTokens[name] = mixColours(fold(withUi(value, tokens)));
  }
  const skinStrings = override ? { ...options.skin?.strings?.en, ...options.skin?.strings?.[locale.split('-')[0]!], ...options.skin?.strings?.[locale] } : {};
  const strings = { ...skinStrings, ...doc.strings };
  // A skin's override templates: a part's by the part's name, the rest by name over the page's own.
  const skinTemplates = Object.entries(override?.templates ?? {});
  const docTemplates = held(doc.templates ?? {});
  const pseudo: SkinDocument = {
    schema: 1, renderer: doc.renderer, id: `screen:${doc.screen}/${doc.page}`, name: doc.screen, version: doc.version, swatches: [],
    tokens: resolvedTokens, templates: { ...docTemplates, ...Object.fromEntries(skinTemplates.filter(([name]) => !PART_TEMPLATES.has(name))) }, motion,
  };
  const r: Context = {
    doc: pseudo, ui: tokens, strings, width: viewport.width, tv: viewport.tv === true, fold: viewport.fold === true, platform: viewport.platform,
    count: 0, unsupported: new Set(),
    screen: { scope: { strings, args: {}, aliases: new Set(), page: String(tokens.page) }, kit: kitTemplates(tokens, viewport.scale ?? 1), palette, warnings, scale: viewport.scale ?? 1, step: viewport.step ?? 0.5,
      parts: { doc: held(doc.parts ?? {}) as Record<string, PartStyle>, skin: override?.parts ?? {} },
      partTemplates: { doc: Object.fromEntries(Object.entries(docTemplates).filter(([name]) => PART_TEMPLATES.has(name))),
        skin: Object.fromEntries(skinTemplates.filter(([name]) => PART_TEMPLATES.has(name))) } },
  };
  // The page a skin draws whole (its shell per form), else the document's, each with its variants.
  const page = override?.pages?.[doc.page];
  const pageOverride: PageOverride | undefined = page && typeof page === 'object' ? ('type' in page ? { tree: page as Node } : page as PageOverride) : undefined;
  const skinShell = doc.page === 'shell' ? formChain(viewport).map(form => override?.shell?.[form]).find(Boolean) : undefined;
  const tree = convertNode(skinShell ?? (pageOverride ? pickTree(pageOverride, viewport) : held(pickTree(doc, viewport))), r);
  const ownLoading = pageOverride?.loading ?? (doc.loading && held(doc.loading));
  const ownFailure = pageOverride?.failure ?? (doc.failure && held(doc.failure));
  // Without its own, a page draws a generic skeleton while loading and the kit's failure.
  const loading = convertNode(ownLoading ?? DEFAULT_LOADING, r);
  const failure = convertNode(ownFailure ?? DEFAULT_FAILURE, r);
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

/** The viewports a skin's experience overrides are checked at: a desktop, a phone and a TV. */
const OVERRIDE_VIEWPORTS: (ScreenViewport & { name: string })[] = [
  { name: 'desktop', width: 1440, height: 900, platform: 'web' },
  { name: 'phone', width: 390, height: 844, platform: 'ios' },
  { name: 'tv', width: 1920, height: 1080, tv: true, scale: 1.25, platform: 'tv' },
];

export interface OverrideFinding { level: 'error' | 'warn'; experience: string; page: string; viewport?: string; message: string }

/**
 * A skin's `experiences` overrides checked against the built-in pages they override (`pages`: the
 * page's built-in document, by id): an override of a page or experience Vela does not build in, or
 * one that does not resolve over its page (an unknown template, a hole the page cannot read), is an
 * error; resolver warnings (unknown parts, props) are warnings. The shell is checked through the
 * page `shell`. For `bun tools/skin.ts check` and the tests.
 */
export function checkExperienceOverrides(skin: Pick<SkinDocument, 'experiences' | 'tokens' | 'strings'>,
  pages: (experience: string) => Record<string, ScreenDocument>): OverrideFinding[] {
  const findings: OverrideFinding[] = [];
  for (const [experience, override] of Object.entries(skin.experiences ?? {})) {
    if (!EXPERIENCE_ID.test(experience)) { findings.push({ level: 'error', experience, page: '', message: `${experience} is not an experience id` }); continue; }
    const builtIn = pages(experience);
    const wanted = new Set([...Object.keys(override.pages ?? {}), ...(override.shell ? ['shell'] : [])]);
    // Templates and parts apply to every page: check them over each.
    const checked = override.templates || override.parts ? Object.keys(builtIn) : [...wanted];
    for (const page of new Set([...wanted, ...checked])) {
      const doc = builtIn[page];
      if (!doc) { findings.push({ level: 'error', experience, page, message: `${experience} has no built-in page ${page}` }); continue; }
      const seen = new Set<string>();
      for (const viewport of OVERRIDE_VIEWPORTS) {
        try {
          for (const warning of resolveScreenDocument(doc, viewport, 'en', {}, { skin }).warnings) {
            if (seen.has(warning)) continue;
            seen.add(warning);
            findings.push({ level: 'warn', experience, page, viewport: viewport.name, message: warning });
          }
        } catch (error) {
          findings.push({ level: 'error', experience, page, viewport: viewport.name, message: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
  return findings;
}
