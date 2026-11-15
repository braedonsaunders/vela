// Skin documents (protocol/v0/skin.ts) resolved for the renderer: validated, templates
// inlined, viewport variants and document tokens applied, motion presets expanded,
// and the tree converted to the renderer's bounded levels. Nothing in a document runs.
import type { Condition, Node, SkinDocument, Style } from '../../wire/v0/skin';
import { FIXED_TOKENS, RENDERER_VERSION, VOCAB } from './vocabulary';

const KEY = new Map(VOCAB.map((key, i) => [key, i]));
/** A vocabulary key's index, a flag, or a refusal: documents name only known keys. */
function key(name: string): { k: number; f: string } {
  if (name.startsWith('flag:') && /^flag:[a-z0-9-]{1,32}$/.test(name)) return { k: -1, f: name.slice(5) };
  const k = KEY.get(name);
  if (k === undefined) throw new Error(`Unknown binding ${name}`);
  return { k, f: '' };
}

/** Must match tools/renderer.ts. */
const DEPTH = 10;
/** Must match tools/renderer.ts WIDGET_DEPTH. */
const WIDGET_DEPTH = 3;
/** Must match tools/renderer.ts SHELL_FROM: the shell's nodes start at this level. */
const SHELL_FROM = 5;
const MAX_NODES = 4000;
const STYLE: [string, string][] = [
  ['display', 'display'], ['position', 'position'], ['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'], ['zIndex', 'z-index'],
  ['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['minHeight', 'min-height'], ['maxWidth', 'max-width'], ['maxHeight', 'max-height'], ['aspectRatio', 'aspect-ratio'], ['boxSizing', 'box-sizing'],
  ['flexGrow', 'flex-grow'], ['flexBasis', 'flex-basis'], ['flexDirection', 'flex-direction'], ['flexWrap', 'flex-wrap'], ['flexShrink', 'flex-shrink'], ['alignItems', 'align-items'], ['alignSelf', 'align-self'], ['justifyContent', 'justify-content'], ['gap', 'gap'], ['columnGap', 'column-gap'], ['rowGap', 'row-gap'], ['order', 'order'],
  ['gridTemplateColumns', 'grid-template-columns'], ['gridTemplateRows', 'grid-template-rows'], ['gridColumn', 'grid-column'], ['gridRow', 'grid-row'],
  ['paddingTop', 'padding-top'], ['paddingRight', 'padding-right'], ['paddingBottom', 'padding-bottom'], ['paddingLeft', 'padding-left'], ['marginTop', 'margin-top'], ['marginRight', 'margin-right'], ['marginBottom', 'margin-bottom'], ['marginLeft', 'margin-left'], ['overflowX', 'overflow-x'], ['overflowY', 'overflow-y'], ['scrollSnapType', 'scroll-snap-type'], ['scrollSnapAlign', 'scroll-snap-align'], ['scrollbarWidth', 'scrollbar-width'], ['scrollBehavior', 'scroll-behavior'], ['scrollPaddingLeft', 'scroll-padding-left'], ['colorScheme', 'color-scheme'],
  ['color', 'color'], ['backgroundColor', 'background-color'], ['backgroundImage', 'background-image'], ['opacity', 'opacity'],
  ['borderWidth', 'border-width'], ['borderStyle', 'border-style'], ['borderColor', 'border-color'], ['borderRadius', 'border-radius'], ['borderTopWidth', 'border-top-width'], ['borderTopColor', 'border-top-color'], ['borderBottomWidth', 'border-bottom-width'], ['borderBottomColor', 'border-bottom-color'], ['borderLeftWidth', 'border-left-width'], ['borderLeftColor', 'border-left-color'],  ['boxShadow', 'box-shadow'], ['filter', 'filter'], ['backdropFilter', 'backdrop-filter'], ['maskImage', 'mask-image'],
  ['fontFamily', 'font-family'], ['fontSize', 'font-size'], ['fontWeight', 'font-weight'], ['fontStyle', 'font-style'], ['lineHeight', 'line-height'], ['letterSpacing', 'letter-spacing'], ['textTransform', 'text-transform'],
  ['textAlign', 'text-align'], ['textShadow', 'text-shadow'], ['textStroke', '-webkit-text-stroke'], ['textOverflow', 'text-overflow'], ['lineClamp', 'line-clamp'], ['whiteSpace', 'white-space'], ['fontVariantNumeric', 'font-variant-numeric'],
  ['objectFit', 'object-fit'], ['transformOrigin', 'transform-origin'], ['translate', 'translate'], ['scale', 'scale'], ['rotate', 'rotate'], ['perspective', 'perspective'],
  ['transition', 'transition'], ['animation', 'animation'], ['pointerEvents', 'pointer-events'], ['cursor', 'cursor'],
];
/** Number rows and their CSS defaults; font-weight is inherited, resolved down the tree here. */
const NUMERIC: Record<string, number> = { opacity: 1, order: 0, 'flex-grow': 0, 'flex-shrink': 1, 'font-weight': 400, 'line-clamp': 0, scale: 1, rotate: 0 };
const ROW_TO_FIELD = new Map(STYLE.map(([field, row]) => [row, field]));
/** Inherited rows: an unset value must inherit, not reset (an empty row resets to the default). */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'white-space', 'cursor', 'font-variant-numeric']);
const BINDABLE: Record<string, string> = { width: 'dw', 'background-color': 'dbg', 'background-image': 'dbi', color: 'dc', opacity: 'dop', translate: 'dtr' };
const KEYFRAMES = new Set(['rise', 'dissolve', 'vanish', 'pop', 'open', 'expose', 'drift', 'fill', 'shimmer', 'spin', 'breathe', 'glow', 'float', 'bounce', 'twinkle', 'slideUp', 'slideIn', 'zoom', 'wiggle', 'auroraA', 'auroraB', 'auroraC', 'scan', 'sway', 'sheen', 'tick', 'tvOn', 'jitter']);
let docKeyframes = new Set<string>(), docId = '';
/** A preset's keyframes: the renderer library (`vr-*`) or the document's own (`doc:name` -> `dk-<doc>-<name>`). */
const keyframes = (name: string) => name === 'none' ? '' : name.startsWith('doc:') ? `dk-${docId}-${name.slice(4)}` : `vr-${name}`;
const knownKeyframes = (name: string) => name === 'none' || KEYFRAMES.has(name) || (name.startsWith('doc:') && docKeyframes.has(name.slice(4)));
/** Document keyframes as CSS the vela-theme view injects: only opacity, translate, scale and rotate, as numbers and lengths. */
function keyframesCss(doc: SkinDocument): string {
  const frames = (doc as SkinDocument & { keyframes?: Record<string, Record<string, Record<string, unknown>>> }).keyframes ?? {};
  const length = /^-?\d+(\.\d+)?(px|%)$/;
  return Object.entries(frames).slice(0, 32).map(([name, steps]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(name)) throw new Error(`Bad keyframes name ${name}`);
    const body = Object.entries(steps).slice(0, 16).map(([at, p]) => {
      if (!/^(from|to|\d{1,3}(\.\d+)?%)$/.test(at)) throw new Error(`Bad keyframe step ${at}`);
      const decl: string[] = [];
      if (p.opacity !== undefined) { const o = Number(p.opacity); if (!(o >= 0 && o <= 1)) throw new Error('opacity 0..1'); decl.push(`opacity:${o}`); }
      if (p.scale !== undefined) { const v = Number(p.scale); if (!Number.isFinite(v)) throw new Error('scale is a number'); decl.push(`scale:${v}`); }
      if (p.rotate !== undefined) { const v = Number(p.rotate); if (!Number.isFinite(v)) throw new Error('rotate is degrees'); decl.push(`rotate:${v}deg`); }
      if (p.translate !== undefined) { const t = String(p.translate).trim().split(/\s+/); if (t.length > 2 || !t.every(x => length.test(x) || x === '0')) throw new Error('translate takes px/% lengths'); decl.push(`translate:${t.join(' ')}`); }
      return `${at}{${decl.join(';')}}`;
    }).join('');
    docKeyframes.add(name);
    return `@keyframes dk-${docId}-${name}{${body}}`;
  }).join('');
}
const ACTIONS = new Set(['select', 'play', 'pickHero', 'home', 'search', 'live', 'library', 'toggle', 'open', 'close', 'openPicker', 'signOut', 'moreRow', 'playTitle', 'playExtra', 'back', 'reset', 'only', 'retry', 'watch', 'preview', 'zap', 'tuneIn', 'unmute', 'guide']);
const COLLECTIONS = new Set(['home.rows', 'row.items', 'home.heroes', 'home.hero', 'nav.destinations', 'detail.seasons', 'detail.episodes', 'detail.upNext', 'detail.extras', 'detail.cast', 'detail.mediaFacts', 'detail.related', 'detail.genres', 'detail.trailers', 'detail.crew', 'hero.genres', 'live.channels', 'live.favorites']);
const UNSAFE = /url\(|expression\(|javascript:|@import|[;{}<>\\]/i;

type Part = { l: string; k: number; f: string };
/** Renderer 3 node fields (protocol/v0/skin.ts). */
interface NodeExtra { states?: { when: Condition[]; style: Style; hover?: Style; focus?: Style; groupHover?: Style; groupFocus?: Style }[]; groupFocus?: Style;
  disabled?: Condition[]; disabledStyle?: Style; a11y?: { expanded?: Condition[]; selected?: Condition[]; current?: Condition[]; pressed?: Condition[]; haspopup?: string; title?: string; role?: string };
  escape?: string; returnFocus?: string; layoutTransition?: string; sharedElement?: string; exit?: string }
type Level = Record<string, unknown>;
export interface DocSlot { present: boolean; rootBase: unknown; rootSts: unknown[]; slotBase: unknown; slotSts: unknown[]; slotInner: number; slotOrder: string; holds: boolean; nodes: Level[] }
export type RouteTree = Omit<DocSlot, 'present'> & { name: string };
export interface SkinDocModel { id: string; fontsJson: string; keyframesCss: string; styles: Record<string, string | number>[]; shell: DocSlot; home: DocSlot; routes: RouteTree[]; liveHome: boolean; detailWide: string; detailSmall: string; detailFrom: number; detailSplit: string }
interface Resolve { doc: SkinDocument; count: number; assets: string; strings: Record<string, string>; styles: Record<string, string | number>[]; index: Map<string, number> }
/** A style's position in the document's shared table (nodes name styles by index). */
function intern(s: Record<string, string | number>, r: Resolve): number {
  const key = JSON.stringify(s);
  let at = r.index.get(key);
  if (at === undefined) { at = r.styles.length; r.styles.push(s); r.index.set(key, at); }
  return at;
}

/** Bindings whose value is an image URL (Plex puts a short-lived token in its query): only an
 * image source or a background-image may read them, never text, labels, ids or press arguments. */
const URL_KEYS = /^(card|hero|detail|dest|person|ch|tile)\.(poster|backdrop|logo|portrait|nowArt)$/;
function parts(template: string | undefined, r?: Resolve, urls = false): Part[] {
  const out: Part[] = [];
  // Document strings are resolved now, for the viewer's locale.
  const text = (template ?? '').replace(/\{s:([a-zA-Z0-9.-]+)\}/g, (_, key) => r?.strings[key] ?? '');
  let at = 0;
  for (const m of text.matchAll(/\{([a-zA-Z.:-]+)\}/g)) {
    if (!urls && URL_KEYS.test(m[1])) throw new Error(`${m[1]} is an image URL: only an image src or background-image may bind it`);
    if (m.index! > at) out.push({ l: text.slice(at, m.index), k: -1, f: '' });
    out.push({ l: '', ...key(m[1]) });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ l: text.slice(at), k: -1, f: '' });
  return out;
}

/** A style value: document tokens substituted, unsafe CSS refused. */
/** A Tamber name inside var() as the page declares it (`var(--x-cinematic-glass)`):
 * Contract rewrites literal rows at build time, but a bound value reaches CSS as written. */
/** A theme token as the page has it: its value when Tamber folded it, else its custom property. */
const themeToken = (name: string) => FIXED_TOKENS[name] ?? `var(--x-${name.replace(/[^A-Za-z0-9_-]/g, '-')})`;
const cssVar = (text: string) => text.replace(/var\(--([a-zA-Z][\w-]*(?:\.[\w-]+)+)\)/g, (_, name: string) => themeToken(name));
/** Four-sided shorthands become longhands: an empty bound longhand would reset what the shorthand set. */
function sides(raw: string): [string, string, string, string] {
  const v = raw.trim().split(/\s+(?![^(]*\))/);
  const [t, r = t, b = t, l = r] = v;
  return [t, r, b, l];
}
function value(raw: string, r: Resolve): string {
  // A token reference is the whole name: `$paperInk` is refused, not read as `$paper` + "Ink".
  const text = cssVar(raw.replace(/\$([A-Za-z0-9_-]+)/g, (_, name) => {
    const v = r.doc.tokens?.[name];
    if (v === undefined) throw new Error(`Unknown token $${name}`);
    return v;
  }));
  if (UNSAFE.test(text.replace(/\{[a-zA-Z.:-]+\}/g, ''))) throw new Error(`Unsafe style value: ${raw}`);
  return text;
}
function style(layers: (Style | undefined)[], r: Resolve, dyn?: Level, weight = 400): Record<string, string | number> {
  const merged: Record<string, string> = {};
  for (const layer of layers) for (const [name, raw] of Object.entries(layer ?? {})) {
    if ((name === 'padding' || name === 'margin' || name === 'inset') && typeof raw === 'string') {
      const [t, rt, b, l] = sides(value(raw, r));
      const keys = name === 'inset' ? ['top', 'right', 'bottom', 'left'] : [`${name}-top`, `${name}-right`, `${name}-bottom`, `${name}-left`];
      keys.forEach((k, i) => { merged[k] = [t, rt, b, l][i]; });
      continue;
    }
    // A family token by name is the property the page declares for it.
    if (name === 'font-family' && typeof raw === 'string' && /^[a-z][\w-]*(\.[\w-]+)+$/.test(raw.trim())) { merged[name] = themeToken(raw.trim()); continue; }
    // A two-value gap is row-gap and column-gap (a bound gap takes one length).
    if (name === 'gap' && typeof raw === 'string' && value(raw, r).trim().split(/\s+/).length === 2) {
      const [rg, cg] = value(raw, r).trim().split(/\s+/);
      Object.assign(merged, { 'row-gap': rg, 'column-gap': cg });
      continue;
    }
    // The flex shorthand becomes grow/shrink/basis: a computed flex must be longhands.
    if (name === 'flex' && typeof raw === 'string') {
      const words = raw.trim().split(/\s+/);
      const f = raw.trim() === 'none' ? ['0', '0', 'auto'] : raw.trim() === 'auto' ? ['1', '1', 'auto'] : words.length === 1 && /^[\d.]+$/.test(words[0]) ? [words[0], '1', '0%'] : [words[0], words[1] ?? '1', words[2] ?? '0%'];
      Object.assign(merged, { 'flex-grow': f[0], 'flex-shrink': f[1], 'flex-basis': f[2] });
      continue;
    }
    // A border shorthand becomes its longhands: Contract binds only literal shorthands.
    if (name === 'border' && typeof raw === 'string') {
      const m = /^(\S+)\s+(solid|dashed|dotted|double|none)\s*(.*)$/.exec(raw.trim());
      if (!m && raw.trim() !== 'none') throw new Error(`Unsupported border ${raw}`);
      Object.assign(merged, m ? { 'border-width': value(m[1], r), 'border-style': m[2], 'border-color': value(m[3] || 'currentColor', r) } : { 'border-style': 'none' });
      continue;
    }
    const row = name;
    if (!ROW_TO_FIELD.has(row) || typeof raw !== 'string') throw new Error(`Unknown style property ${row}`);
    if (dyn && BINDABLE[row] && raw.includes('{')) { dyn[BINDABLE[row]] = parts(value(raw, r), undefined, row === 'background-image'); continue; }
    merged[row] = value(raw, r);
  }
  // The renderer binds gap, row-gap and column-gap: an empty bound longhand resets to normal,
  // so a one-value gap is both longhands.
  if (merged.gap !== undefined) { merged['row-gap'] ??= merged.gap; merged['column-gap'] ??= merged.gap; }
  // A colour may name a theme token bare (`cinematic.glass-edge`), as font-family may.
  for (const [row, v] of Object.entries(merged)) if (row.endsWith('color') && /^[a-z][\w-]*(\.[\w-]+)+$/.test(v.trim())) merged[row] = themeToken(v.trim());
  // Per-side border rows follow the shorthand's width and colour unless set: an empty bound
  // longhand would reset a side to the CSS default (3px currentColor).
  for (const side of ['top', 'bottom', 'left']) {
    if (merged[`border-${side}-width`] === undefined && merged['border-width'] !== undefined) merged[`border-${side}-width`] = merged['border-width'];
    if (merged[`border-${side}-color`] === undefined && merged['border-color'] !== undefined) merged[`border-${side}-color`] = merged['border-color'];
  }
  const out: Record<string, string | number> = {};
  for (const [field, row] of STYLE) {
    if (row in NUMERIC) {
      const n = merged[row] === undefined ? (row === 'font-weight' ? weight : NUMERIC[row]) : Number(merged[row] === 'bold' ? 700 : merged[row] === 'normal' ? 400 : merged[row]);
      if (!Number.isFinite(n)) throw new Error(`${row} takes a number`);
      out[field] = n;
    } else out[field] = merged[row] ?? (INHERITED.has(row) ? 'inherit' : '');
  }
  return out;
}
const conds = (when: Condition[] | undefined) => (when ?? []).map(c => ({ ...key(c.test), is: c.is ?? 'set', v: c.value ?? '', not: c.not === true }));

function convert(node: Node, depth: number, r: Resolve, weight = 400): Level | undefined {
  if (++r.count > MAX_NODES) throw new Error('Skin document has too many nodes');
  if (node.type === 'use') {
    const template = r.doc.templates?.[node.template];
    if (!template || depth > DEPTH) throw new Error(`Unknown template ${node.template}`);
    // The use node's own style, conditions and motion wrap the template's.
    return convert({ ...template, style: { ...template.style, ...node.style }, when: [...(template.when ?? []), ...(node.when ?? [])], motion: node.motion ?? template.motion, stagger: node.stagger ?? template.stagger } as Node, depth, r, weight);
  }
  if (depth > DEPTH) throw new Error(`Skin document nests deeper than ${DEPTH}`);
  // A box (and a repeat's wrapper) is a flex column unless it says otherwise, as Contract's `column`.
  // Text, images and icons are drawn inside a box of their own (the renderer's one element): a block.
  const boxy = node.type === 'box' || node.type === 'repeat';
  const variant = [boxy ? { display: 'flex', 'flex-direction': 'column' } as Style : { display: 'block' } as Style, node.style];
  // Viewport overrides (small < 640, wide >= 1200, below/above at the document's own widths) become
  // states on env.width, the slot's own width, evaluated live: one per width interval, disjoint.
  const ext = node as Node & { below?: Record<string, Style>; above?: Record<string, Style> };
  const marks = [
    ...(node.small ? [{ px: 640, below: true, style: node.small }] : []), ...(node.wide ? [{ px: 1200, below: false, style: node.wide }] : []),
    ...Object.entries(ext.below ?? {}).map(([px, style]) => ({ px: Number(px), below: true, style })), ...Object.entries(ext.above ?? {}).map(([px, style]) => ({ px: Number(px), below: false, style })),
  ];
  if (marks.some(m => !Number.isInteger(m.px) || m.px < 1 || m.px > 10000)) throw new Error('Breakpoints are whole pixels');
  const edges = [...new Set(marks.map(m => m.px))].sort((x, y) => x - y);
  const widthKey = key('env.width');
  const intervals = marks.length ? [0, ...edges].map((from, i) => {
    const to = edges[i] ?? Infinity;
    const applied = [...marks.filter(m => !m.below && m.px <= from).sort((x, y) => x.px - y.px), ...marks.filter(m => m.below && m.px > from).sort((x, y) => y.px - x.px)].map(m => m.style);
    const when = [...(from > 0 ? [{ ...widthKey, is: 'lt', v: String(from), not: true }] : []), ...(to < Infinity ? [{ ...widthKey, is: 'lt', v: String(to), not: false }] : [])];
    return { applied, when };
  }) : [];
  const level: Level = { t: 'box', parts: [], src: [], label: parts(node.label, r), arg: [], sym: '', act: '', role: node.role ?? '', level: node.level ?? 0, test: parts(node.testId, r), dom: parts(node.id, r), rep: '', lim: 1000,
    mk: '', md: 0, mdl: 0, me: '', mf: '', mit: '', mdir: '', msk: '', msd: 0, step: node.stagger?.step ?? 0, cap: node.stagger?.cap ?? 0, cond: conds(node.when) };
  for (const f of Object.values(BINDABLE)) level[f] = [];
  const base = style(variant, r, level, weight);
  const own = base as Record<string, number>;
  // Under reduced motion the overlays drop what moves: scale, translate, rotate, transitions, animations.
  const still = (o: Style | undefined) => o && Object.fromEntries(Object.entries(o).filter(([k]) => !['scale', 'translate', 'rotate', 'transition', 'animation'].includes(k))) as Style;
  const n = node as Node & NodeExtra;
  level.hh = !!node.hover; level.hf = !!node.focus; level.grp = node.group === true; level.hg = !!node.groupHover; level.gf = !!n.groupFocus; level.fade = false;
  /** A state's style indices: its base, each overlay, and the reduced-motion overlays. */
  const stateRef = (layers: (Style | undefined)[], s: { hover?: Style; focus?: Style; groupHover?: Style; groupFocus?: Style }, cond: Condition[]) => {
    const at = (extra?: Style) => intern(style([...layers, extra], r, undefined, weight), r);
    const plain = style(layers, r, undefined, weight), sIdx = intern(plain, r);
    const overlay = (o?: Style) => o ? at(o) : sIdx, calm = (o?: Style) => o ? at(still(o)) : sIdx;
    // Position is a choice the renderer binds per state (a viewport variant may move a node into flow).
    return { cond: conds(cond), s: sIdx, pos: plain.position === 'absolute' ? 1 : plain.position === 'sticky' ? 2 : 0, hs: overlay(s.hover), fs: overlay(s.focus), gs: overlay(s.groupHover), gfs: overlay(s.groupFocus), ds: overlay(n.disabledStyle),
      hs2: calm(s.hover), fs2: calm(s.focus), gs2: calm(s.groupHover), gfs2: calm(s.groupFocus) };
  };
  const overlays = { hover: node.hover, focus: node.focus, groupHover: node.groupHover, groupFocus: n.groupFocus };
  level.base = { ...stateRef(variant, overlays, []), s: intern(base, r), pos: base.position === 'absolute' ? 1 : base.position === 'sticky' ? 2 : 0 };
  // Each document state, then the plain node, at each width interval (first match wins).
  const userStates = (n.states ?? []).slice(0, 8);
  if (userStates.length * Math.max(1, intervals.length) + intervals.length > 48) throw new Error('Too many states x breakpoints on one node');
  const within = intervals.length ? intervals : [{ applied: [] as Style[], when: [] as { k: number; f: string; is: string; v: string; not: boolean }[] }];
  level.sts = [
    ...userStates.flatMap(x => within.map(w => ({ ...stateRef([...variant, x.style, ...w.applied], { hover: x.hover ?? node.hover, focus: x.focus ?? node.focus, groupHover: x.groupHover ?? node.groupHover, groupFocus: x.groupFocus ?? n.groupFocus }, x.when), cond: [...conds(x.when), ...w.when] }))),
    ...intervals.map(w => ({ ...stateRef([...variant, ...w.applied], overlays, []), cond: w.when })),
  ];
  level.dis = conds(n.disabled);
  const a = n.a11y ?? {};
  Object.assign(level, { aexp: conds(a.expanded), asel: conds(a.selected), acur: conds(a.current), aprs: conds(a.pressed), ahp: a.haspopup ?? '', atitle: parts(a.title, r), brole: a.role ?? '',
    pfocus: parts(node.type === 'box' ? node.press?.focus : undefined, r), esc: n.escape ?? '', escTo: parts(n.returnFocus, r), lt: n.layoutTransition ?? '', se: n.sharedElement ?? '', ex: '', exs: '', ivb: '', ipaths: [], fr: 'nonzero' });
  if (n.exit) {
    const m = r.doc.motion?.[n.exit];
    if (!m) throw new Error(`Unknown motion ${n.exit}`);
    level.ex = `${keyframes(m.keyframes)} ${m.duration}ms ${m.easing ?? 'ease'} ${m.delay ?? 0}ms both`;
    level.exs = m.still ? `${keyframes(m.still.keyframes)} ${m.still.duration}ms linear both` : 'none';
  }
  if (node.motion) {
    const m = r.doc.motion?.[node.motion];
    if (!m || !knownKeyframes(m.keyframes) || (m.still && !knownKeyframes(m.still.keyframes))) throw new Error(`Unknown motion ${node.motion}`);
    Object.assign(level, { mk: keyframes(m.keyframes), md: m.duration, mdl: m.delay ?? 0, me: m.easing ?? 'ease', mf: m.fill ?? 'both', mit: String(m.iterations ?? 1), mdir: m.direction ?? 'normal', msk: m.still ? keyframes(m.still.keyframes) : '', msd: m.still?.duration ?? 0 });
  }
  let kids: Node[] = [];
  switch (node.type) {
    case 'text': level.t = 'text'; level.parts = parts(node.text, r); break;
    case 'image': level.t = 'image'; level.src = parts(asset(node.src, r), undefined, true); level.label = parts(node.alt, r); level.fade = node.fade === true; break;
    case 'icon': {
      level.t = 'icon';
      // A platform symbol, or the document's own glyph: SVG path data painted in the current colour.
      const glyph = node as { paths?: string[]; viewBox?: string };
      if (glyph.paths?.length) {
        if (glyph.paths.length > 8 || glyph.paths.some(d => typeof d !== 'string' || d.length > 4096 || !/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/.test(d))) throw new Error('Icon paths are SVG path data');
        if (!/^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/.test(glyph.viewBox ?? '0 0 24 24')) throw new Error('Icon viewBox is four numbers');
        level.ipaths = glyph.paths; level.ivb = glyph.viewBox ?? '0 0 24 24'; level.fr = (glyph as { fillRule?: string }).fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
      } else if (node.symbol && /^[a-z0-9.-]{1,48}$/.test(node.symbol)) level.sym = node.symbol;
      else throw new Error(`Bad symbol ${node.symbol}`);
      break;
    }
    case 'widget':
      if (node.widget === 'install') { level.t = 'install'; level.sym = node.params?.action === 'update' ? 'update' : 'install'; level.label = parts(node.params?.label, r); }
      else if (node.widget === 'observe') { level.t = 'observe'; level.arg = parts(node.params?.receipt); }
      // The live tile's picture: the renderer draws it only in its first levels.
      else if (node.widget === 'liveTile') { if (depth > WIDGET_DEPTH) throw new Error(`The liveTile widget must sit within ${WIDGET_DEPTH} levels of its slot`); level.t = 'liveTile'; }
      else throw new Error(`Unknown widget ${node.widget}`);
      break;
    case 'repeat': {
      // The item node itself carries the repetition (no wrapper box): the parent steps it into each element.
      if (!COLLECTIONS.has(node.over)) throw new Error(`Unknown collection ${node.over}`);
      r.count--;
      const item = convert({ ...node.item, when: [...(node.when ?? []), ...(node.item.when ?? [])] } as Node, depth, r, weight)!;
      return { ...item, rep: node.over, lim: node.limit ?? 1000 };
    }
    case 'box':
      if (node.press) { if (!ACTIONS.has(node.press.action)) throw new Error(`Unknown action ${node.press.action}`); level.act = node.press.action; level.arg = parts(node.press.arg, r); }
      kids = node.children ?? []; break;
    case 'slot': throw new Error('A slot node belongs at the top of its slot tree');
  }
  if (depth < DEPTH) level.kids = kids.map(k => convert(k, depth + 1, r, own.fontWeight)).filter(Boolean);
  else if (kids.length) throw new Error(`Skin document nests deeper than ${DEPTH}`);
  return level;
}
/** Image sources: a vocabulary template, an app asset, or a same-origin pack asset. */
function asset(src: string, r: Resolve): string {
  if (/^\{[a-zA-Z.]+\}$/.test(src) || /^assets\/[a-z0-9/._-]+$/.test(src)) return src;
  if ((src.startsWith('/vela/v0/appearance/') || src.startsWith('/vela/skins/')) && !/[?#\\]/.test(src)) return `${r.assets}${src}`;
  throw new Error(`Image source outside the document's assets: ${src}`);
}

/** A slot's root box or holder: its style with states and viewport variants, as any node's (it follows the slot's width). */
function boxStates(node: { style?: Style; small?: Style; wide?: Style; below?: Record<string, Style>; above?: Record<string, Style>; states?: unknown } | undefined, r: Resolve, extra?: Style): { base: unknown; sts: unknown[] } {
  const level = convert({ type: 'box', style: { ...node?.style, ...extra }, small: node?.small, wide: node?.wide, below: node?.below, above: node?.above, states: node?.states } as Node, 1, r)!;
  return { base: level.base, sts: level.sts as unknown[] };
}
function slot(root: Node | undefined, r: Resolve, holder: 'children' | 'searchField', from = 1): DocSlot {
  if (!root) { const none = boxStates(undefined, r); return { present: false, rootBase: none.base, rootSts: [], slotBase: none.base, slotSts: [], slotInner: intern(style([], r), r), slotOrder: '0', holds: false, nodes: [] }; }
  if (root.type !== 'box') throw new Error('A slot tree starts with a box');
  const kids = root.children ?? [];
  const at = kids.findIndex(k => k.type === 'slot' && k.slot === holder);
  const holderNode = kids[at] as (Extract<Node, { type: 'slot' }> & { below?: Record<string, Style>; above?: Record<string, Style>; states?: unknown }) | undefined;
  // Every top-level node gets its flex order; the foundation's content takes the slot's.
  // (A repeat draws no box: its item takes the order.)
  const ordered = (k: Node, i: number): Node => k.type === 'repeat' ? { ...k, item: ordered(k.item, i) } as Node : { ...k, style: { ...k.style, order: String(i) } } as Node;
  const nodes = kids.flatMap((k, i) => k.type === 'slot' ? [] : [convert(ordered(k, i), from, r)!]);
  // The slot box's own flex order rides in its style (the box takes every row).
  const rootStates = boxStates(root as Parameters<typeof boxStates>[0], r);
  const holderStates = boxStates(holderNode, r, { order: String(at < 0 ? kids.length : at) } as Style);
  return { present: true, rootBase: rootStates.base, rootSts: rootStates.sts, slotBase: holderStates.base, slotSts: holderStates.sts, slotInner: intern(style([holderNode?.inner], r), r), slotOrder: String(at < 0 ? kids.length : at), holds: at >= 0, nodes };
}

export function skinDoc(doc: SkinDocument, width: number, origin: string, locale = 'en'): SkinDocModel {
  if (!doc || doc.schema !== 1 || typeof doc.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(doc.id)) throw new Error('Not a schema 1 skin document');
  if (JSON.stringify(doc).length > 512 * 1024) throw new Error('Skin document over 512 KiB');
  if (!Number.isInteger(doc.renderer) || doc.renderer < 1 || doc.renderer > RENDERER_VERSION) throw new Error(`Skin document needs renderer ${doc.renderer}; this client has ${RENDERER_VERSION}`);
  docId = doc.id; docKeyframes = new Set();
  const kfCss = keyframesCss(doc);
  const strings = { ...doc.strings?.en, ...doc.strings?.[locale.split('-')[0]], ...doc.strings?.[locale] };
  const r: Resolve = { doc, count: 0, assets: origin, strings, styles: [], index: new Map() };
  const shell = slot(doc.slots.shell, r, 'children', SHELL_FROM), home = slot(doc.slots.home, r, 'searchField');
  // A route tree is a slot without `present` (a route is drawn only when the document has it).
  const routes = Object.entries(doc.routes ?? {}).map(([name, tree]) => { const { present: _, ...rest } = slot(tree, r, 'children'); return { name, ...rest }; });
  // Document fonts: same-origin appearance files, registered by the vela-theme view under their family names.
  const fonts = Object.values(doc.fonts ?? {}).slice(0, 8).flatMap(f => /^[A-Za-z0-9 ]{1,48}$/.test(f?.family ?? '') ? (f.files ?? []).slice(0, 4).flatMap(file => {
    const url = file && typeof file.url === 'string' && (file.url.startsWith('/vela/v0/appearance/') || file.url.startsWith('/vela/skins/')) && /\.(woff2|woff|ttf|otf)$/.test(file.url) && !/[?#\\]/.test(file.url) ? `${origin}${file.url}` : '';
    const w = String(file.weight ?? 400).trim();
    return url && /^\d{3}( \d{3})?$/.test(w) ? [{ family: f.family, url, weight: w, style: file.style === 'italic' ? 'italic' : 'normal', sizeAdjust: Number(f.sizeAdjust) || 100 }] : [];
  }) : []);
  return { id: doc.id, fontsJson: fonts.length ? JSON.stringify(fonts) : '', keyframesCss: kfCss, styles: r.styles, shell, home, routes, liveHome: doc.live?.home === true,
    detailWide: doc.detail?.wide === 'stack' ? '' : doc.detail?.wide ?? 'fullscreen', detailSmall: doc.detail?.small === 'stack' ? '' : doc.detail?.small ?? 'fullscreen',
    // From this viewport width the detail takes its wide presentation and splits home beside it (a pane width in px).
    detailFrom: Math.max(0, Math.min(4000, Math.round(Number(doc.detail?.from ?? 640)) || 0)), detailSplit: /^(\d{2,4})(px)?$/.exec(String(doc.detail?.split ?? ''))?.[1] ?? 'none' };
}
