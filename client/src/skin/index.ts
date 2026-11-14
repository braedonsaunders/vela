// Skin documents (protocol/v0/skin.ts) resolved for the renderer: validated, templates
// inlined, viewport variants and document tokens applied, motion presets expanded,
// and the tree converted to the renderer's bounded levels. Nothing in a document runs.
import type { Condition, Node, SkinDocument, Style } from '../../wire/v0/skin';

/** Must match tools/renderer.ts. */
const DEPTH = 12;
const MAX_NODES = 4000;
const STYLE: [string, string][] = [
  ['display', 'display'], ['position', 'position'], ['inset', 'inset'], ['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'], ['zIndex', 'z-index'],
  ['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['minHeight', 'min-height'], ['maxWidth', 'max-width'], ['maxHeight', 'max-height'], ['aspectRatio', 'aspect-ratio'], ['boxSizing', 'box-sizing'],
  ['flexGrow', 'flex-grow'], ['flexBasis', 'flex-basis'], ['flexDirection', 'flex-direction'], ['flexWrap', 'flex-wrap'], ['flexShrink', 'flex-shrink'], ['alignItems', 'align-items'], ['alignSelf', 'align-self'], ['justifyContent', 'justify-content'], ['gap', 'gap'], ['order', 'order'],
  ['gridTemplateColumns', 'grid-template-columns'], ['gridTemplateRows', 'grid-template-rows'], ['gridColumn', 'grid-column'], ['gridRow', 'grid-row'],
  ['margin', 'margin'], ['padding', 'padding'], ['paddingTop', 'padding-top'], ['paddingRight', 'padding-right'], ['paddingBottom', 'padding-bottom'], ['paddingLeft', 'padding-left'], ['marginTop', 'margin-top'], ['marginRight', 'margin-right'], ['marginBottom', 'margin-bottom'], ['marginLeft', 'margin-left'], ['overflowX', 'overflow-x'], ['overflowY', 'overflow-y'], ['scrollSnapType', 'scroll-snap-type'], ['scrollSnapAlign', 'scroll-snap-align'], ['scrollbarWidth', 'scrollbar-width'],
  ['color', 'color'], ['backgroundColor', 'background-color'], ['backgroundImage', 'background-image'], ['opacity', 'opacity'],
  ['borderWidth', 'border-width'], ['borderStyle', 'border-style'], ['borderColor', 'border-color'], ['borderRadius', 'border-radius'], ['boxShadow', 'box-shadow'], ['filter', 'filter'], ['backdropFilter', 'backdrop-filter'], ['maskImage', 'mask-image'],
  ['fontFamily', 'font-family'], ['fontSize', 'font-size'], ['fontWeight', 'font-weight'], ['fontStyle', 'font-style'], ['lineHeight', 'line-height'], ['letterSpacing', 'letter-spacing'], ['textTransform', 'text-transform'],
  ['textAlign', 'text-align'], ['textShadow', 'text-shadow'], ['lineClamp', 'line-clamp'], ['whiteSpace', 'white-space'], ['fontVariantNumeric', 'font-variant-numeric'],
  ['objectFit', 'object-fit'], ['transformOrigin', 'transform-origin'], ['translate', 'translate'], ['scale', 'scale'],
  ['transition', 'transition'], ['animation', 'animation'], ['pointerEvents', 'pointer-events'], ['cursor', 'cursor'],
];
/** Number rows and their CSS defaults; font-weight is inherited, resolved down the tree here. */
const NUMERIC: Record<string, number> = { opacity: 1, order: 0, 'flex-grow': 0, 'flex-shrink': 1, 'font-weight': 400, 'line-clamp': 0, scale: 1 };
const ROW_TO_FIELD = new Map(STYLE.map(([field, row]) => [row, field]));
/** Inherited rows: an unset value must inherit, not reset (an empty row resets to the default). */
const INHERITED = new Set(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-transform', 'text-align', 'white-space', 'cursor', 'font-variant-numeric']);
const BINDABLE: Record<string, string> = { width: 'dw', 'background-color': 'dbg', 'background-image': 'dbi', color: 'dc', opacity: 'dop', translate: 'dtr' };
const KEYFRAMES = new Set(['rise', 'dissolve', 'vanish', 'pop', 'open', 'expose', 'drift', 'fill', 'shimmer', 'spin', 'breathe', 'glow', 'float', 'bounce', 'twinkle', 'slideUp', 'slideIn', 'zoom', 'wiggle', 'auroraA', 'auroraB', 'auroraC', 'scan']);
const keyframes = (name: string) => name === 'none' ? '' : `vr-${name}`;
const ACTIONS = new Set(['select', 'play', 'pickHero', 'home', 'search', 'live', 'library', 'toggle', 'open', 'close', 'openPicker', 'signOut', 'moreRow']);
const COLLECTIONS = new Set(['home.rows', 'row.items', 'home.heroes', 'home.hero', 'nav.destinations']);
const UNSAFE = /url\(|expression\(|javascript:|@import|[;{}<>\\]/i;

type Part = { l: string; k: string };
type Level = Record<string, unknown>;
export interface DocSlot { present: boolean; root: number; slotStyle: number; slotInner: number; slotOrder: string; nodes: Level[] }
export interface SkinDocModel { id: string; styles: Record<string, string | number>[]; shell: DocSlot; home: DocSlot; detailWide: string; detailSmall: string }
interface Resolve { doc: SkinDocument; small: boolean; wide: boolean; count: number; assets: string; strings: Record<string, string>; styles: Record<string, string | number>[]; index: Map<string, number> }
/** A style's position in the document's shared table (nodes name styles by index). */
function intern(s: Record<string, string | number>, r: Resolve): number {
  const key = JSON.stringify(s);
  let at = r.index.get(key);
  if (at === undefined) { at = r.styles.length; r.styles.push(s); r.index.set(key, at); }
  return at;
}

function parts(template: string | undefined, r?: Resolve): Part[] {
  const out: Part[] = [];
  // Document strings are resolved now, for the viewer's locale.
  const text = (template ?? '').replace(/\{s:([a-zA-Z0-9.-]+)\}/g, (_, key) => r?.strings[key] ?? '');
  let at = 0;
  for (const m of text.matchAll(/\{([a-zA-Z.:-]+)\}/g)) {
    if (m.index! > at) out.push({ l: text.slice(at, m.index), k: '' });
    out.push({ l: '', k: m[1] });
    at = m.index! + m[0].length;
  }
  if (at < text.length) out.push({ l: text.slice(at), k: '' });
  return out;
}

/** A style value: document tokens substituted, unsafe CSS refused. */
function value(raw: string, r: Resolve): string {
  const text = raw.replace(/\$([a-z][a-z0-9-]*)/g, (_, name) => r.doc.tokens?.[name] ?? '');
  if (UNSAFE.test(text.replace(/\{[a-zA-Z.:-]+\}/g, ''))) throw new Error(`Unsafe style value: ${raw}`);
  return text;
}
function style(layers: (Style | undefined)[], r: Resolve, dyn?: Level, weight = 400): Record<string, string | number> {
  const merged: Record<string, string> = {};
  for (const layer of layers) for (const [name, raw] of Object.entries(layer ?? {})) {
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
    if (dyn && BINDABLE[row] && raw.includes('{')) { dyn[BINDABLE[row]] = parts(value(raw, r)); continue; }
    merged[row] = value(raw, r);
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
const conds = (when: Condition[] | undefined) => (when ?? []).map(c => ({ k: c.test, is: c.is ?? 'set', v: c.value ?? '', not: c.not === true }));

function convert(node: Node, depth: number, r: Resolve, weight = 400): Level | undefined {
  if (++r.count > MAX_NODES) throw new Error('Skin document has too many nodes');
  if (node.type === 'use') {
    const template = r.doc.templates?.[node.template];
    if (!template || depth > DEPTH) throw new Error(`Unknown template ${node.template}`);
    // The use node's own style, conditions and motion wrap the template's.
    return convert({ ...template, style: { ...template.style, ...node.style }, when: [...(template.when ?? []), ...(node.when ?? [])], motion: node.motion ?? template.motion, stagger: node.stagger ?? template.stagger } as Node, depth, r, weight);
  }
  if (depth > DEPTH) throw new Error(`Skin document nests deeper than ${DEPTH}`);
  const variant = [node.style, r.small ? node.small : undefined, r.wide ? node.wide : undefined];
  const level: Level = { t: 'box', parts: [], src: [], label: parts(node.label, r), arg: [], sym: '', act: '', role: node.role ?? '', level: node.level ?? 0, test: parts(node.testId, r), rep: '', lim: 1000,
    mk: '', md: 0, mdl: 0, me: '', mf: '', mit: '', mdir: '', msk: '', msd: 0, step: node.stagger?.step ?? 0, cap: node.stagger?.cap ?? 0, cond: conds(node.when) };
  for (const f of Object.values(BINDABLE)) level[f] = [];
  const base = style(variant, r, level, weight);
  const own = base as Record<string, number>;
  level.s = intern(base, r);
  level.pos = base.position === 'absolute' ? 1 : base.position === 'sticky' ? 2 : 0;
  level.hh = !!node.hover; level.hf = !!node.focus; level.grp = node.group === true; level.hg = !!node.groupHover; level.fade = false;
  level.gs = node.groupHover ? intern(style([...variant, node.groupHover], r, undefined, weight), r) : level.s;
  level.hs = node.hover ? intern(style([...variant, node.hover], r, undefined, weight), r) : level.s;
  level.fs = node.focus ? intern(style([...variant, node.focus], r, undefined, weight), r) : level.s;
  if (node.motion) {
    const m = r.doc.motion?.[node.motion];
    if (!m || !(KEYFRAMES.has(m.keyframes) || m.keyframes === 'none') || (m.still && !(KEYFRAMES.has(m.still.keyframes) || m.still.keyframes === 'none'))) throw new Error(`Unknown motion ${node.motion}`);
    Object.assign(level, { mk: keyframes(m.keyframes), md: m.duration, mdl: m.delay ?? 0, me: m.easing ?? 'ease', mf: m.fill ?? 'both', mit: String(m.iterations ?? 1), mdir: m.direction ?? 'normal', msk: m.still ? keyframes(m.still.keyframes) : '', msd: m.still?.duration ?? 0 });
  }
  let kids: Node[] = [];
  switch (node.type) {
    case 'text': level.t = 'text'; level.parts = parts(node.text, r); break;
    case 'image': level.t = 'image'; level.src = parts(asset(node.src, r)); level.label = parts(node.alt, r); level.fade = node.fade === true; break;
    case 'icon': level.t = 'icon'; if (!/^[a-z0-9.-]{1,48}$/.test(node.symbol)) throw new Error(`Bad symbol ${node.symbol}`); level.sym = node.symbol; break;
    case 'widget':
      if (node.widget === 'install') { level.t = 'install'; level.sym = node.params?.action === 'update' ? 'update' : 'install'; level.label = parts(node.params?.label, r); }
      else if (node.widget === 'observe') { level.t = 'observe'; level.arg = parts(node.params?.receipt); }
      else throw new Error(`Unknown widget ${node.widget}`);
      break;
    case 'repeat':
      if (!COLLECTIONS.has(node.over)) throw new Error(`Unknown collection ${node.over}`);
      level.rep = node.over; level.lim = node.limit ?? 1000; kids = [node.item]; break;
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
  if (src.startsWith('/vela/v0/appearance/') && !/[?#\\]/.test(src)) return `${r.assets}${src}`;
  throw new Error(`Image source outside the document's assets: ${src}`);
}

function slot(root: Node | undefined, r: Resolve, holder: 'children' | 'searchField'): DocSlot {
  if (!root) return { present: false, root: intern(style([], r), r), slotStyle: intern(style([], r), r), slotInner: intern(style([], r), r), slotOrder: '0', nodes: [] };
  if (root.type !== 'box') throw new Error('A slot tree starts with a box');
  const kids = root.children ?? [];
  const at = kids.findIndex(k => k.type === 'slot' && k.slot === holder);
  const holderNode = kids[at] as Extract<Node, { type: 'slot' }> | undefined;
  // Every top-level node gets its flex order; the foundation's content takes the slot's.
  const nodes = kids.flatMap((k, i) => k.type === 'slot' ? [] : [convert({ ...k, style: { ...k.style, order: String(i) } } as Node, 1, r)!]);
  const outer = holderNode ? style([holderNode.style, r.small ? holderNode.small : undefined, r.wide ? holderNode.wide : undefined], r) : style([], r);
  return { present: true, root: intern(style([root.style, r.small ? root.small : undefined, r.wide ? root.wide : undefined], r), r), slotStyle: intern(outer, r), slotInner: intern(style([holderNode?.inner], r), r), slotOrder: String(at < 0 ? kids.length : at), nodes };
}

export function skinDoc(doc: SkinDocument, width: number, origin: string, locale = 'en'): SkinDocModel {
  if (!doc || doc.schema !== 1 || typeof doc.id !== 'string' || !/^[a-z][a-z0-9-]{0,31}$/.test(doc.id)) throw new Error('Not a schema 1 skin document');
  if (JSON.stringify(doc).length > 512 * 1024) throw new Error('Skin document over 512 KiB');
  const strings = { ...doc.strings?.en, ...doc.strings?.[locale.split('-')[0]], ...doc.strings?.[locale] };
  const r: Resolve = { doc, small: width < 640, wide: width >= 1200, count: 0, assets: origin, strings, styles: [], index: new Map() };
  const shell = slot(doc.slots.shell, r, 'children'), home = slot(doc.slots.home, r, 'searchField');
  return { id: doc.id, styles: r.styles, shell, home,
    detailWide: doc.detail?.wide === 'stack' ? '' : doc.detail?.wide ?? 'fullscreen', detailSmall: doc.detail?.small === 'stack' ? '' : doc.detail?.small ?? 'fullscreen' };
}
