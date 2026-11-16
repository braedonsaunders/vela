// Skin documents (protocol/v0/skin.ts) resolved for the renderer: validated, templates
// inlined, viewport variants and document tokens applied, motion presets expanded,
// and the tree converted to the renderer's bounded levels. Nothing in a document runs.
import type { Condition, Node, SkinDocument, Style } from '../../wire/v0/skin';
import { perfReport } from './budget';
import { resolveFonts } from './fonts';
import { portabilityReport } from './portability';
import { SEARCH_ACTIONS, SEARCH_COLLECTIONS, SEARCH_KEYS } from './search-vocabulary';
import { withClientStrings } from './client-strings';
import { withBase } from './inherit';
import { resolveUi, uiValue } from './ui';
import type { UiTokens } from './ui-defaults';
import { velaBase } from './base';
import { BOUND_ROWS, DEPTH, FIELD_DEPTH, MOTION_DEPTH, FIXED_TOKENS, PAGER_DEPTH, RENDERER_VERSION, SHELL_FROM, STYLE, VOCAB, WIDGET_DEPTH } from './vocabulary';

// Search's keys follow the shared vocabulary (search-vocabulary.ts).
const KEY = new Map([...VOCAB, ...SEARCH_KEYS].map((key, i) => [key, i]));
/** A vocabulary key's index, a flag, or a refusal: documents name only known keys. */
function key(name: string): { k: number; f: string } {
  if (name.startsWith('flag:') && /^flag:[a-z0-9-]{1,32}$/.test(name)) return { k: -1, f: name.slice(5) };
  const k = KEY.get(name);
  if (k === undefined) throw new Error(`Unknown binding ${name}`);
  return { k, f: '' };
}

/** The search input is drawn in home's and the shell's first three levels (tools/renderer.ts searchLevel). */
const searchLevel = (d: number) => d <= 3 || (d >= SHELL_FROM && d < SHELL_FROM + 3);
const MAX_NODES = 4000;
// The style rows, as tools/renderer.ts generates them (the renderer's Style shape has exactly these fields).
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
  const named = Object.entries(frames);
  if (named.length > 32) throw new Error(`The document has ${named.length} keyframes; the limit is 32`);
  return named.map(([name, steps]) => {
    if (!/^[a-zA-Z][a-zA-Z0-9-]{0,31}$/.test(name)) throw new Error(`Bad keyframes name ${name}`);
    const stepList = Object.entries(steps);
    if (stepList.length > 16) throw new Error(`Keyframes ${name} has ${stepList.length} steps; the limit is 16`);
    const body = stepList.map(([at, p]) => {
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
const ACTIONS = new Set(['select', 'play', 'pickHero', 'home', 'search', 'live', 'library', 'toggle', 'open', 'close', 'openPicker', 'signOut', 'moreRow', 'playTitle', 'playExtra', 'back', 'reset', 'only', 'retry', 'clearSearch', 'focusSearch', 'pageNext', 'pagePrev', 'librarySort', 'librarySortFlip', 'libraryFilter', 'libraryMore', 'signIn', 'startQuick', 'cancelQuick', 'goSecure', 'collectionMore', 'watch', 'preview', 'zap', 'tuneIn', 'unmute', 'guide', ...SEARCH_ACTIONS]);
const COLLECTIONS = new Set(['home.rows', 'row.items', 'home.heroes', 'home.hero', 'nav.destinations', 'detail.seasons', 'detail.episodes', 'detail.upNext', 'detail.extras', 'detail.cast', 'detail.mediaFacts', 'detail.related', 'detail.genres', 'detail.trailers', 'detail.crew', 'hero.genres', 'live.channels', 'live.favorites', 'library.items', 'library.kinds', 'library.genres', 'library.sorts', 'quick.chars', 'collection.items', ...SEARCH_COLLECTIONS]);
const UNSAFE = /url\(|expression\(|javascript:|@import|[;{}<>\\]/i;

type Part = { l: string; k: number; f: string };
/** Renderer 3 node fields (protocol/v0/skin.ts). */
interface NodeExtra { states?: { when: Condition[]; style: Style; hover?: Style; focus?: Style; groupHover?: Style; groupFocus?: Style; label?: string }[]; groupFocus?: Style; active?: Style;
  disabled?: Condition[]; disabledStyle?: Style; a11y?: { expanded?: Condition[]; selected?: Condition[]; current?: Condition[]; pressed?: Condition[]; haspopup?: string; title?: string; role?: string };
  escape?: string; returnFocus?: string; layoutTransition?: string; sharedElement?: string; exit?: string }
type Level = Record<string, unknown>;
export interface DocSlot { present: boolean; rootBase: unknown; rootSts: unknown[]; slotBase: unknown; slotSts: unknown[]; slotInner: number; slotOrder: string; holds: boolean; nodes: Level[] }
export type RouteTree = Omit<DocSlot, 'present'> & { name: string };
export interface SkinDocModel { id: string; fontsJson: string; keyframesCss: string; styles: Record<string, string | number>[]; shell: DocSlot; routes: RouteTree[]; liveHome: boolean; detailWide: string; detailSmall: string; detailFrom: number; detailSplit: string; detailScrim: string; detailBlur: string; detailFlat: boolean; barMask: string; panSections: string; pageColor: string; inkColor: string; splashOnPaper: string; drawsStatus: boolean; css: string; escapes: { flags: string; to: string }[] }
interface Resolve { doc: SkinDocument; ui: UiTokens; count: number; assets: string; strings: Record<string, string>; styles: Record<string, string | number>[]; index: Map<string, number>;
  /** Hover/group-hover rules and press rules (the document's css), the next state id, and the Escape closures. */
  group: Map<string, string[]>; hover: Map<string, string[]>; press: Map<string, string[]>; ids: number; escapes: { flags: string; to: string }[];
  /** Converting the shell's tree (its levels all bind motion; a route's only to MOTION_DEPTH). */
  shell: boolean }
/** A style's position in the document's shared table (nodes name styles by index). */
function intern(s: Record<string, string | number>, r: Resolve): number {
  const key = JSON.stringify(s);
  let at = r.index.get(key);
  // Its id is its rule in the document's css (baseCss), which a renderer box matches by data-st.
  if (at === undefined) { at = r.styles.length; r.styles.push({ ...s, id: at }); r.index.set(key, at); }
  return at;
}

/** Bindings whose value is an image URL (Plex puts a short-lived token in its query): only an
 * image source or a background-image may read them, never text, labels, ids or press arguments. */
const URL_KEYS = /^((card|hero|detail|dest|person|ch|tile)\.(poster|backdrop|logo|portrait|nowArt)|hit\.(logo|artwork))$/;
function parts(template: string | undefined, r?: Resolve, urls = false): Part[] {
  const out: Part[] = [];
  // Client strings ({t:}) and the document's own ({s:}) are resolved now, for the viewer's locale.
  // The document's name ({env.skinName}) is known now too.
  const text = withClientStrings(template ?? '')
    .replace(/\{s:([a-zA-Z0-9.-]+)\}/g, (_, key: string) => {
      const found = r?.strings[key];
      if (found === undefined) throw new Error(`Unknown document string ${key}`);
      return found;
    })
    .replace(/\{env\.skinName\}/g, () => r?.doc.name ?? '');
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
  const withUi = raw.replace(/\$ui\.([A-Za-z]+)/g, (_, name: string) => uiValue(r.ui, name));
  const text = cssVar(withUi.replace(/\$([A-Za-z0-9_-]+)/g, (_, name) => {
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
    // The focus ring is Exact's own (the platform's): a document may only suppress it.
    if (name === 'outline' || name === 'outline-style') {
      // `auto` keeps the platform ring even where a focus overlay would suppress it.
      const v = String(raw).trim();
      if (v !== 'none' && v !== 'auto') throw new Error(`Only outline: none or auto (the platform draws the focus ring): ${raw}`);
      merged['outline-style'] = v;
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
  // A fully transparent ground is no ground (a pressed control then dims its content, as a compiled button does).
  if (merged['background-color'] !== undefined && /^(transparent|#[0-9a-f]{3}0|#[0-9a-f]{6}00|rgba\(.*,\s*0(\.0+)?\))$/i.test(merged['background-color'].trim())) merged['background-color'] = 'transparent';
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

/** Whether a node's own styles (base, variants, states, overlays; not its children) set `key`. */
function setsRow(node: unknown, key: string): boolean {
  if (!node || typeof node !== 'object') return false;
  return Object.entries(node).some(([k, v]) => k === key || (k !== 'children' && k !== 'item' && setsRow(v, key)));
}

/** A pressed scale is no motion: reduced motion keeps it, as Exact's press scale (only its transition goes). */
const pressScale = (active: Style | undefined) => (active as Record<string, string> | undefined)?.scale !== undefined ? { scale: (active as Record<string, string>).scale } as Style : {};

/** library.played's fixed choices, "value|label;…" (labels literal or {s:}/{t:} strings), up to 8. */
function playedChoices(raw: unknown, r: Resolve): string[] {
  const choices = String(raw ?? '').split(';').filter(Boolean);
  if (choices.length > 8) throw new Error(`A select has ${choices.length} choices; the limit is 8`);
  return choices.map(choice => {
    const [value, ...label] = choice.split('|');
    const pieces = parts(label.join('|'), r);
    if (pieces.some(p => p.k >= 0 || p.f !== '')) throw new Error('A select choice\'s label is text, not a binding');
    return `${value}|${pieces.map(p => p.l).join('')}`;
  });
}

function convert(node: Node, depth: number, r: Resolve, weight = 400, root = false): Level | undefined {
  if (++r.count > MAX_NODES) throw new Error('Skin document has too many nodes');
  if (node.type === 'use') {
    const template = r.doc.templates?.[node.template];
    if (!template || depth > DEPTH) throw new Error(`Unknown template ${node.template}`);
    // The use node's own style, conditions and motion wrap the template's.
    return convert({ ...template, style: { ...template.style, ...node.style }, when: [...(template.when ?? []), ...(node.when ?? [])], motion: node.motion ?? template.motion, stagger: node.stagger ?? template.stagger } as Node, depth, r, weight);
  }
  // A colour boundary per node would cost every commit a walk of them all (renderer: RootEl).
  if (!root && setsRow(node, 'color-scheme')) throw new Error('color-scheme is set only on a tree\'s root box (the shell\'s or a route\'s)');
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
  const level: Level = { t: 'box', parts: [], src: [], label: parts(node.label, r), arg: [], sym: '', act: '', cs: false, rn: false, ha: false, ahid: false, achk: [], role: node.role ?? '', level: node.level ?? 0, test: parts(node.testId, r), dom: parts(node.id, r), rep: '', lim: 1000,
    mk: '', md: 0, mdl: 0, me: '', mf: '', mit: '', mdir: '', msk: '', msd: 0, step: node.stagger?.step ?? 0, cap: node.stagger?.cap ?? 0, cond: conds(node.when) };
  for (const f of Object.values(BINDABLE)) level[f] = [];
  const base = style(variant, r, level, weight);
  const own = base as Record<string, number>;
  // Under reduced motion the overlays drop what moves: scale, translate, rotate, transitions, animations.
  const still = (o: Style | undefined) => o && Object.fromEntries(Object.entries(o).filter(([k]) => !['scale', 'translate', 'rotate', 'transition', 'animation'].includes(k))) as Style;
  const n = node as Node & NodeExtra;
  // A look counts when the node or any of its states carries it (a state's focus is the node's focus look then).
  const looks = [n, ...(n.states ?? [])];
  level.ha = !!n.active;
  level.hh = looks.some(x => !!x.hover);
  level.hf = looks.some(x => !!x.focus);
  level.grp = node.group === true;
  level.hg = looks.some(x => !!x.groupHover);
  level.gf = looks.some(x => !!x.groupFocus);
  level.fade = false;
  /** A state's style indices: its base, each overlay, and the reduced-motion overlays. */
  const stateRef = (layers: (Style | undefined)[], s: { hover?: Style; focus?: Style; groupHover?: Style; groupFocus?: Style; active?: Style }, cond: Condition[]) => {
    const at = (extra?: Style) => intern(style([...layers, extra], r, undefined, weight), r);
    const plain = style(layers, r, undefined, weight), sIdx = intern(plain, r);
    const overlay = (o?: Style) => o ? at(o) : sIdx, calm = (o?: Style) => o ? at(still(o)) : sIdx;
    // Position is a choice the renderer binds per state (a viewport variant may move a node into flow).
    return { cond: conds(cond), lbl: [], s: sIdx, as: s.active ? at({ ...s.hover, ...s.active }) : overlay(s.hover), as2: s.active ? at({ ...still({ ...s.hover, ...s.active }), ...pressScale(s.active) }) : calm(s.hover), pos: plain.position === 'absolute' ? 1 : plain.position === 'sticky' ? 2 : 0, hs: overlay(s.hover), fs: overlay(s.focus), gs: overlay(s.groupHover), gfs: overlay(s.groupFocus), ds: overlay(n.disabledStyle),
      hs2: calm(s.hover), fs2: calm(s.focus), gs2: calm(s.groupHover), gfs2: calm(s.groupFocus) };
  };
  const overlays = { hover: node.hover, focus: node.focus, groupHover: node.groupHover, groupFocus: n.groupFocus, active: n.active };
  level.base = { ...stateRef(variant, overlays, []), s: intern(base, r), pos: base.position === 'absolute' ? 1 : base.position === 'sticky' ? 2 : 0 };
  // Each document state, then the plain node, at each width interval (first match wins).
  // Every state counts (a state cut off silently would leave its cards in the plain look).
  const userStates = n.states ?? [];
  if (userStates.length > 16) throw new Error(`A node has ${userStates.length} states; the limit is 16`);
  if (userStates.length * Math.max(1, intervals.length) + intervals.length > 48) {
    throw new Error('Too many states x breakpoints on one node');
  }
  const within = intervals.length ? intervals : [{ applied: [] as Style[], when: [] as { k: number; f: string; is: string; v: string; not: boolean }[] }];
  level.sts = [
    ...userStates.flatMap(x => within.map(w => ({ ...stateRef([...variant, x.style, ...w.applied], { hover: x.hover ?? node.hover, focus: x.focus ?? node.focus, groupHover: x.groupHover ?? node.groupHover, groupFocus: x.groupFocus ?? n.groupFocus, active: n.active }, x.when), cond: [...conds(x.when), ...w.when], lbl: parts(x.label, r) }))),
    ...intervals.map(w => ({ ...stateRef([...variant, ...w.applied], overlays, []), cond: w.when })),
  ];
  level.dis = conds(n.disabled);
  const a = n.a11y ?? {};
  Object.assign(level, { ahid: a.hidden === true, achk: conds(a.checked), aexp: conds(a.expanded), asel: conds(a.selected), acur: conds(a.current), aprs: conds(a.pressed), ahp: a.haspopup ?? '', atitle: parts(a.title, r), brole: a.role ?? '',
    pfocus: parts(node.type === 'box' ? node.press?.focus : undefined, r), esc: n.escape ?? '', escTo: parts(n.returnFocus, r), lt: n.layoutTransition ?? '', ex: '', exs: '', ivb: '', ipaths: [], fr: 'nonzero' });
  // Exact probes every element that binds a layout transition or an exit before every commit: a
  // route's deep levels (cards and their parts) draw through a box without them.
  if (!r.shell && depth > MOTION_DEPTH && (n.layoutTransition || n.exit)) throw new Error(`layoutTransition and exit are allowed within ${MOTION_DEPTH} levels of a route (this node is at level ${depth}): Exact checks every such element on every update`);
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
      // The bare search input: the document draws the field around it and styles its text through the node's style.
      else if (node.widget === 'searchInput') {
        if (!searchLevel(depth)) throw new Error('The searchInput widget must sit within 3 levels of home or of the shell');
        level.rn = ((node.style as Record<string, string> | undefined)?.outline ?? (node.style as Record<string, string> | undefined)?.['outline-style']) === 'none';
        level.t = 'searchInput'; level.parts = parts(node.params?.placeholder, r); level.label = parts(node.params?.label ?? node.params?.placeholder, r);
        level.sym = value(node.params?.placeholderColor ?? 'inherit', r);
      }
      // A sign-in field (route auth): params.field username | password, placeholder, label, placeholderColor.
      else if (node.widget === 'textInput') {
        if (depth > FIELD_DEPTH) throw new Error(`A textInput must sit within ${FIELD_DEPTH} levels of its route`);
        const field = node.params?.field;
        if (field !== 'username' && field !== 'password') throw new Error('textInput params.field: username or password');
        level.rn = ((node.style as Record<string, string> | undefined)?.outline ?? (node.style as Record<string, string> | undefined)?.['outline-style']) === 'none' || (!!node.focus && ((node.focus as Record<string, string>).outline ?? 'none') !== 'auto');
        level.t = 'textInput'; level.sym = field; level.parts = parts(node.params?.placeholder, r); level.label = parts(node.params?.label ?? node.params?.placeholder, r);
        level.ivb = value(node.params?.placeholderColor ?? 'inherit', r);
      }
      // A library page's year filter: a number field on library.year (change filters by year).
      else if (node.widget === 'yearInput') {
        if (depth > PAGER_DEPTH) throw new Error(`A yearInput must sit within ${PAGER_DEPTH} levels of its slot`);
        level.t = 'yearInput'; level.parts = parts(node.params?.placeholder, r); level.label = parts(node.params?.label ?? node.params?.placeholder, r);
        level.sym = value(node.params?.placeholderColor ?? 'inherit', r);
      }
      // A native select over a library's options (the platform's control and menu), styled by its node.
      else if (node.widget === 'select') {
        if (depth > PAGER_DEPTH) throw new Error(`A select must sit within ${PAGER_DEPTH} levels of its slot`);
        const over = node.params?.options ?? '';
        if (!['library.genres', 'library.sorts', 'library.kinds', 'library.played'].includes(over)) throw new Error(`select options: library.genres, library.sorts, library.kinds or library.played, not ${over}`);
        // library.played lists the document's own choices: "value|label;…" (labels may be {s:key}).
        if (over === 'library.played') level.ipaths = playedChoices(node.params?.choices, r);
        if (!node.params?.action || !ACTIONS.has(node.params.action)) throw new Error(`Unknown select action ${node.params?.action}`);
        // {value} is the select's own placeholder (the chosen id), kept literal for the renderer to fill.
        level.t = 'select'; level.sym = over; level.act = node.params.action; level.arg = parts((node.params.arg ?? '{value}').replaceAll('{value}', '\u0000'), r).map(p => ({ ...p, l: p.l.replaceAll('\u0000', '{value}') }));
        level.parts = parts(node.params.none, r); level.label = parts(node.params.label, r); level.test = parts(node.testId, r);
      }
      // Asks for the next page of home or of its row when it scrolls into view.
      else if (node.widget === 'sentinel') {
        if (depth > PAGER_DEPTH) throw new Error(`A sentinel must sit within ${PAGER_DEPTH} levels of its slot`);
        const on = node.params?.on ?? 'row';
        if (!['row', 'home', 'library', 'collection'].includes(on)) throw new Error(`A sentinel loads row, home, library or collection, not ${on}`);
        level.t = 'sentinel';
        level.sym = on;
      }
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
      if (node.press) { if (!ACTIONS.has(node.press.action)) throw new Error(`Unknown action ${node.press.action}`); level.act = node.press.action; level.arg = parts(node.press.arg, r); level.cs = node.controlStates !== false;
        // The platform focus ring stays unless the node says outline: none, or a focus overlay suppresses it (not outline: auto).
        const states = (node as NodeExtra).states ?? [];
        const focusLooks = [node.focus, (node as NodeExtra).groupFocus, ...states.flatMap(x => [x.focus, x.groupFocus])];
        const outlineOf = (o: Style | undefined) => (o as Record<string, string> | undefined)?.outline
          ?? (o as Record<string, string> | undefined)?.['outline-style'];
        const rings = [node.style, ...focusLooks].map(outlineOf);
        // A group's descendants' group looks are its focus look too (a focused group lights them).
        const groupLook = node.group === true && JSON.stringify(node.children ?? []).search(/"group(Hover|Focus)":/) >= 0;
        level.rn = rings.includes('none') || (!rings.includes('auto') && (focusLooks.some(Boolean) || groupLook)); }
      kids = node.children ?? [];
      // A row's pager: this box is the row's sideways scroller (its style sets overflow-x); pageNext/pagePrev {row.id} move it.
      if (node.pager) {
        if (depth > PAGER_DEPTH) throw new Error(`A pager must sit within ${PAGER_DEPTH} levels of its slot`);
        if (node.press) throw new Error('A pager box takes no press');
        const px = (v: unknown, fallback: number) => {
          const n = v === undefined ? fallback : Number(v);
          if (!Number.isInteger(n) || n < 0 || n > 400) throw new Error('A pager\'s inset and peek are whole pixels, 0 to 400');
          return n;
        };
        level.dom = parts('pager-{row.id}'); level.sym = `${px(node.pager.inset, 0)}|${px(node.pager.peek, 60)}`;
      }
      break;
    case 'slot': throw new Error('A slot node belongs at the top of its slot tree');
  }
  cssStates(level, r);
  if (n.escape) r.escapes.push({ flags: n.escape, to: (level.escTo as Part[]).every(p => p.k < 0 && !p.f) ? (level.escTo as Part[]).map(p => p.l).join('') : '' });
  for (const f of ['hh', 'ha', 'cs', 'esc', 'escTo']) delete level[f];
  if (depth < DEPTH) level.kids = kids.map(k => convert(k, depth + 1, r, own.fontWeight)).filter(Boolean);
  else if (kids.length) throw new Error(`Skin document nests deeper than ${DEPTH}`);
  // A pager's edge markers are its first and last children (renderer node "edge", sym "s|inset|peek"):
  // 1 px wide, taken out of the row's spacing by a margin of -1 px less the row's gap.
  if (node.type === 'box' && node.pager) {
    // The gap in force is the pager's own --vg (every style rule declares its row gap there).
    const edge = (which: string) => ({ ...convert({ type: 'box' } as Node, depth + 1, r)!, t: 'edge', sym: `${which}|${level.sym}`, ivb: 'calc(-1px - var(--vg, 0px))' });
    level.kids = [edge('s'), ...(level.kids as Level[]), edge('e')];
  }
  return level;
}

// Hover, press and group hover as CSS (the document's css, which vela-theme injects): a
// pointer over the page runs no script. Each node state with a look gets an id (v; v2 under
// reduced motion) that the renderer writes as data-vs; data-vg marks a group, data-vf a focus
// look the renderer drew (it outranks a group's hover). Every rule is !important over the
// node's bound (inline) rows and of zero specificity, so their order is their precedence:
// group hover, then hover, then press, as the renderer's state order had them.
const WASH = 'linear-gradient(var(--exact-quaternary-fill) 0 0)';
const CSS_ROWS = STYLE.filter(([field]) => !['lineClamp', 'objectFit', 'outlineStyle', 'colorScheme'].includes(field));
const cssValue = (field: string, v: string | number) => v === '' ? 'unset' : field === 'rotate' ? `${v}deg` : String(v);
/** The rows where `to` differs from any of `from`, as `to` has them. */
function declarations(to: Record<string, string | number>, from: Record<string, string | number>[]): string[] {
  return CSS_ROWS.filter(([field]) => from.some(f => f[field] !== to[field])).map(([field, row]) => `${row}:${cssValue(field, to[field])}!important`);
}
/** Each distinct style's rows a renderer box does not bind (BOUND_ROWS), as one rule its
 * data-st matches: the root's id twice and two attributes outrank Exact's element classes (which nest
 * under #exact-root#exact-root), as the box's inline rows did; every such row is first reset to unset (scale and rotate to their identity, position to relative), as an empty bound row was written. */
const SHEET_ROWS = CSS_ROWS.filter(([field]) => !BOUND_ROWS.includes(field));
function baseCss(r: Resolve): string {
  // A box always writes scale and rotate (1, 0deg: an identity transform, not none), as its bound rows did.
  const reset = `#exact-root#exact-root [data-st][data-st]{${SHEET_ROWS.map(([field, row]) => `${row}:${field === 'scale' ? '1' : field === 'rotate' ? '0deg' : field === 'position' ? 'relative' : 'unset'}`).join(';')}}`;
  return reset + r.styles.map((st, i) => {
    // A box is relative unless absolute or sticky (fixed and static are not offered).
    const rows = SHEET_ROWS.filter(([field]) => st[field] !== '' && !(field === 'position' && st[field] !== 'absolute' && st[field] !== 'sticky') && !(field === 'flexShrink' && st[field] === 1) && !(field === 'scale' && st[field] === 1) && !(field === 'rotate' && st[field] === 0) && !(field === 'order' && st[field] === 0) && !(field === 'flexGrow' && st[field] === 0));
    // --vg: the row gap a pager's edge markers take back out (renderer node "edge").
    const decls = [...rows.map(([field, row]) => `${row}:${cssValue(field, st[field])}`), `--vg:${st.columnGap || st.gap || '0px'}`];
    return `#exact-root#exact-root [data-st="${i}"][data-st]{${decls.join(';')}}`;
  }).join('');
}
/** The state rules, those with one body sharing it: group hover, then hover (only where a pointer
 * hovers, so a touch leaves no hover behind), then press. */
function statesCss(r: Resolve): string {
  const rules = (m: Map<string, string[]>) => [...m].map(([body, sels]) => `:where(${sels.join(',')}){${body}}`).join('');
  const hover = rules(r.group) + rules(r.hover);
  return (hover ? `@media (hover:hover){${hover}}` : '') + rules(r.press);
}
function cssStates(level: Level, r: Resolve) {
  const refs = [level.base, ...(level.sts as unknown[])] as Record<string, unknown>[];
  const at = (i: unknown) => r.styles[i as number];
  const pressable = level.act !== '' && level.cs === true;
  const ground = (st: Record<string, string | number>) => st.backgroundImage === '';
  for (const ref of refs) {
    for (const still of [false, true]) {
      const k = (f: string) => ref[still ? `${f}2` : f];
      const base = at(ref.s);
      // A hover look counts in this state only when it differs from the state's own style.
      const hover = level.hh && k('hs') !== ref.s ? at(k('hs')) : undefined;
      const active = level.ha ? at(k('as')) : undefined;
      // What the renderer may have drawn inline: the state, its focus look, its group's focus looks.
      const inline = [base, ...(level.hf ? [at(k('fs'))] : []), ...(level.gf ? [at(k('gfs'))] : []), ...(level.hg ? [at(k('gs'))] : [])];
      const group = level.hg ? declarations(at(k('gs')), [base]) : [];
      const over = hover ? declarations(hover, inline) : [];
      // Exact's control wash under a pressable's content when its state draws no image of its own (no bound image);
      // an authored hover replaces it (author over platform, per state), while the pressed look below stays.
      if (pressable && !hover && !(level.dbi as Part[]).length && ground(base)) over.push(`background-image:${WASH}!important`);
      const held = active ? declarations(active, [...inline, ...(hover ? [hover] : [])]) : [];
      // Exact's pressed state, as compiled controls show it: the whole control at .65 while held
      // (ground, ring and content; a hover ground stays), whether or not it has a ground. An authored
      // \`active\` look replaces it (author over platform, per state), as a bound opacity does.
      // An authored hover opacity wins over it too (the same property), so a filled control that
      // fades on hover does not dim further.
      if (pressable && !active && !(level.dop as Part[]).length && !(hover && hover.opacity !== base.opacity)) held.push('opacity:0.65!important');
      const id = !group.length && !over.length && !held.length ? '' : `${r.ids++}`;
      ref[still ? 'v2' : 'v'] = id;
      if (!id) continue;
      const vs = `[data-vs="${id}"]`;
      const add = (rules: Map<string, string[]>, body: string[], selector: string) => { if (body.length) (rules.get(body.join(';')) ?? rules.set(body.join(';'), []).get(body.join(';'))!).push(selector); };
      add(r.group, group, `:where([data-vg="1"]:hover) ${vs}:not([data-vf="1"]):not(:where([data-vg="1"]:not(:hover)) *)`);
      add(r.hover, over, `${vs}:hover`);
      add(r.press, held, `${vs}:active`);
    }
    for (const f of ['as', 'as2', 'hs', 'hs2']) delete ref[f];
  }
}
/** Image sources: a vocabulary template, an app asset, or a same-origin pack asset. */
function asset(src: string, r: Resolve): string {
  if (/^\{[a-zA-Z.]+\}$/.test(src) || /^assets\/[a-z0-9/._-]+$/.test(src)) return src;
  if ((src.startsWith('/vela/v0/appearance/') || src.startsWith('/vela/skins/')) && !/[?#\\]/.test(src)) return `${r.assets}${src}`;
  throw new Error(`Image source outside the document's assets: ${src}`);
}

/** A slot's root box or holder: its style with states and viewport variants, as any node's (it follows the slot's width). */
function boxStates(node: { style?: Style; small?: Style; wide?: Style; below?: Record<string, Style>; above?: Record<string, Style>; states?: unknown; escape?: string; returnFocus?: string } | undefined, r: Resolve, extra?: Style, root = false): { base: unknown; sts: unknown[] } {
  // A root's escape closes its flags too (a shell root may hold the menu's escape).
  const level = convert({ type: 'box', style: { ...node?.style, ...extra }, small: node?.small, wide: node?.wide, below: node?.below, above: node?.above, states: node?.states, ...(root ? { escape: (node as NodeExtra | undefined)?.escape, returnFocus: (node as NodeExtra | undefined)?.returnFocus } : {}) } as Node, 1, r, 400, root)!;
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
  // The holder keeps its place among the nodes (a placeholder the slot draws its box at); the
  // shell's route goes last when its tree has no slot node.
  const holderAt = at >= 0 ? at : holder === 'children' && from === SHELL_FROM ? kids.length : -1;
  const nodes = [...kids, ...(at < 0 && holderAt >= 0 ? [undefined] : [])].flatMap((k, i) => i === holderAt ? [{ ...convert({ type: 'box' } as Node, from, r)!, t: 'holder' }] : !k || k.type === 'slot' ? [] : [convert(ordered(k, i), from, r)!]);
  // The slot box's own flex order rides in its style (the box takes every row).
  const rootStates = boxStates(root as Parameters<typeof boxStates>[0], r, undefined, true);
  const holderStates = boxStates(holderNode, r, { order: String(at < 0 ? kids.length : at) } as Style);
  return { present: true, rootBase: rootStates.base, rootSts: rootStates.sts, slotBase: holderStates.base, slotSts: holderStates.sts, slotInner: intern(style([holderNode?.inner], r), r), slotOrder: String(at < 0 ? kids.length : at), holds: holderAt >= 0, nodes };
}

/** A trait the document may set: "true", "false", or "" when it leaves the trait to the engine. */
function tri(v: unknown, name: string): string {
  if (v === undefined) return '';
  if (typeof v !== 'boolean') throw new Error(`traits.${name} is true or false`);
  return String(v);
}
/** The title page's presentation per viewport class, the width it changes at, and the split pane. */
function detailLayout(doc: SkinDocument): { detailWide: string; detailSmall: string; detailFrom: number; detailSplit: string } {
  const presentation = (v: unknown, name: string) => {
    if (v === undefined) return 'fullscreen';
    if (v !== 'fullscreen' && v !== 'modal' && v !== 'stack') throw new Error(`detail.${name} is fullscreen, modal or stack`);
    // The navigation's own presentation for a stacked page is its default ("").
    return v === 'stack' ? '' : v;
  };
  // From this viewport width the detail takes its wide presentation and splits home beside it.
  const from = doc.detail?.from === undefined ? 640 : Number(doc.detail.from);
  if (!Number.isInteger(from) || from < 0 || from > 4000) throw new Error('detail.from is whole pixels, 0 to 4000');
  const split = doc.detail?.split === undefined || doc.detail.split === 'none' ? 'none' : /^(\d{2,4})(px)?$/.exec(String(doc.detail.split))?.[1];
  if (split === undefined) throw new Error('detail.split is a pane width in px (10 to 9999) or none');
  return { detailWide: presentation(doc.detail?.wide, 'wide'), detailSmall: presentation(doc.detail?.small, 'small'), detailFrom: from, detailSplit: split };
}

function detailFrame(doc: SkinDocument, r: Resolve): { detailScrim: string; detailBlur: string; detailFlat: boolean } {
  const frame = (doc.detail as { frame?: { scrim?: string; blur?: string; flat?: boolean } } | undefined)?.frame;
  if (frame?.flat) return { detailScrim: 'transparent', detailBlur: 'none', detailFlat: true };
  const blur = frame?.blur ?? 'blur(18px) saturate(1.1)';
  if (!/^(none|(blur|saturate|brightness)\([\d.]+(px|%)?\)( |$))+$/.test(blur.trim() + (blur.trim() === 'none' ? '' : ' '))) throw new Error(`detail.frame.blur takes blur()/saturate()/brightness(): ${blur}`);
  return { detailScrim: style([{ 'background-color': frame?.scrim ?? 'media.overlay' } as Style], r)['backgroundColor'] as string, detailBlur: blur.trim(), detailFlat: false };
}

export function skinDoc(doc: SkinDocument, width: number, origin: string, locale = 'en'): SkinDocModel {
  const model = resolveDoc(doc, width, origin, locale);
  // Over a performance limit (src/skin/budget.ts), the document is refused, as any invalid one.
  const over = perfReport(model).findings.filter(f => f.level === 'error');
  if (over.length) throw new Error(`Skin document over its performance budget: ${over.map(f => `${f.route}: ${f.message}`).join('; ')}`);
  warnUnportable(doc);
  return model;
}

/** Rows React Native cannot draw (docs/rn-migration.md, "Style matrix") are named once per
 *  document: they still draw on the web, and `bun tools/skin.ts check` refuses them. */
const warnedUnportable = new Set<string>();
function warnUnportable(doc: SkinDocument): void {
  const key = `${doc.id}@${doc.version}`;
  if (warnedUnportable.has(key)) return;
  warnedUnportable.add(key);
  const rows = new Set(portabilityReport(doc).filter(f => f.level === 'error').map(f => `${f.row}: ${f.value}`));
  if (rows.size > 0) console.warn(`Skin document ${doc.id} uses rows React Native cannot draw: ${[...rows].join('; ')}`);
}

function resolveDoc(own: SkinDocument, width: number, origin: string, locale: string): SkinDocModel {
  if (!own || own.schema !== 1 || typeof own.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(own.id)) {
    throw new Error('Not a schema 1 skin document');
  }
  if (JSON.stringify(own).length > 512 * 1024) throw new Error('Skin document over 512 KiB');
  if (!Number.isInteger(own.renderer) || own.renderer < 1 || own.renderer > RENDERER_VERSION) {
    throw new Error(`Skin document needs renderer ${own.renderer}; this client has ${RENDERER_VERSION}`);
  }
  // The document over the Vela base: the routes it leaves out are the base's, in its ui look.
  const ui = resolveUi(own.ui);
  const doc = withBase(own, velaBase);
  docId = doc.id; docKeyframes = new Set();
  const kfCss = keyframesCss(doc);
  const strings = { ...doc.strings?.en, ...doc.strings?.[locale.split('-')[0]], ...doc.strings?.[locale] };
  const r: Resolve = { doc, ui, count: 0, assets: origin, strings, styles: [], index: new Map(), group: new Map(), hover: new Map(), press: new Map(), ids: 0, escapes: [], shell: false };
  r.shell = true;
  const shell = slot(doc.slots.shell, r, 'children', SHELL_FROM);
  r.shell = false;
  // A route tree is a slot without `present` (a route is drawn only when the document has it).
  // Home is a route like the others (its holder is the foundation's search field): one renderer call site draws them all.
  const tree = (name: string, root: Node | undefined, holder: 'children' | 'searchField') => { const { present, ...rest } = slot(root, r, holder); return present ? [{ name, ...rest }] : []; };
  const routes = [...tree('home', doc.slots.home ?? doc.routes?.home, 'searchField'), ...Object.entries(doc.routes ?? {}).filter(([name]) => name !== 'home').flatMap(([name, root]) => tree(name, root, 'children'))];
  const fonts = resolveFonts(doc, origin);
  return { id: doc.id, fontsJson: fonts.length ? JSON.stringify(fonts) : '', keyframesCss: kfCss, styles: r.styles, shell, routes, liveHome: doc.live?.home === true,
    ...detailLayout(doc),
    // The framed title's surround, drawn by the route frame: scrim (colour or token), blur, or flat.
    ...detailFrame(doc, r),
    // Foundation traits the document sets ("" leaves the doc engine's).
    barMask: tri(doc.traits?.barMask, 'barMask'), panSections: tri(doc.traits?.panSections, 'panSections'),
    splashOnPaper: tri(doc.traits?.splashOnPaper, 'splashOnPaper'),
    pageColor: doc.traits?.page ? style([{ color: doc.traits.page } as Style], r)['color'] as string : '',
    inkColor: doc.traits?.ink ? style([{ color: doc.traits.ink } as Style], r)['color'] as string : '', drawsStatus: doc.status === true,
    // Hover and group hover only where a pointer hovers (a touch leaves no hover behind), then press.
    css: baseCss(r) + statesCss(r), escapes: [...r.escapes].reverse() };
}
