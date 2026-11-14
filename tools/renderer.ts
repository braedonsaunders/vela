/**
 * Generates client/renderer/levels.contract: the bounded-depth renderer that draws a
 * skin document (protocol/v0/skin.ts). Contract shapes cannot recurse and components
 * cannot call themselves (contract-grammar.md:3020, syntax-inline-depth), so a
 * document tree is drawn by DEPTH levels L1..LDEPTH over shapes N1..NDEPTH. Exact
 * inlines a component at each call site, so every level calls the next from exactly
 * one site: one generic container, leaves branch. Run: bun tools/renderer.ts
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const DEPTH = 12;
/** Style rows: Contract field name and the row it writes. Inherited ones default to "inherit" (src/skin). */
export const STYLE: [string, string][] = [
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
/** The motion preset library documents name (docs/skin-schema.md): compiled once, prefixed `vr-`. */
export const KEYFRAMES: Record<string, string> = {
  rise: 'from opacity=0 translate="0px 22px"', dissolve: 'from opacity=0', vanish: 'to opacity=0',
  pop: 'from opacity=0 scale=0.94 translate="0px -6px"', open: 'from opacity=0 scale=0.94 translate="0px 28px"', expose: 'from opacity=0 scale=1.08',
  drift: 'from scale=1.04 translate="0px 0px"\n  to scale=1.14 translate="-2.4% -1.6%"', fill: 'from translate="-100% 0px"\n  to translate="0px 0px"',
  shimmer: 'from translate="-100% 0px"\n  to translate="100% 0px"', spin: 'from rotate=0\n  to rotate=360', breathe: '50% opacity=0.45', glow: '50% opacity=0.75 scale=1.06',
  float: '50% translate="0px -8px"', bounce: '30% translate="0px -14px" scale=1.04\n  60% translate="0px 0px" scale=0.98', twinkle: '50% opacity=0.2 scale=0.7',
  slideUp: 'from translate="0px 100%"', slideIn: 'from opacity=0 translate="-24px 0px"', zoom: 'from opacity=0 scale=0.8', wiggle: '25% rotate=-4\n  75% rotate=4',
  auroraA: 'from translate="-8% -6%" scale=1\n  to translate="10% 8%" scale=1.25', auroraB: 'from translate="12% 6%" scale=1.2\n  to translate="-10% -8%" scale=0.95',
  auroraC: 'from translate="0% 10%" scale=0.9\n  to translate="-6% -12%" scale=1.2', scan: 'from translate="0px -100%"\n  to translate="0px 100%"',
};
/** Rows Exact types as numbers (lower-attr-type); the data module resolves their defaults and inheritance. */
export const NUMERIC = new Set(['opacity', 'order', 'flexGrow', 'flexShrink', 'fontWeight', 'lineClamp', 'scale']);
/** Rows a node may bind to the vocabulary (`width: "{card.progressPct}%"`). */
export const BINDABLE: [string, string][] = [['width', 'dw'], ['backgroundColor', 'dbg'], ['backgroundImage', 'dbi'], ['color', 'dc'], ['opacity', 'dop'], ['translate', 'dtr']];

const rows = (indent: string) => STYLE.map(([field, row]) => {
  const bind = BINDABLE.find(([f]) => f === field);
  const fillOf = NUMERIC.has(field) ? `num(fill(n.${bind?.[1]}, c, e))` : `fill(n.${bind?.[1]}, c, e)`;
  const value = bind ? `(n.${bind[1]}.length > 0 ? ${fillOf} : st.${field})` : `st.${field}`;
  // A box that clips or scrolls takes only relative/absolute/sticky (lower-attr-value): fixed and static are not offered.
  // Exact's checker reads a choice of literals off a prop, not off the style table: the node carries its position.
  if (field === 'position') return 'position=(n.pos == 1 ? "absolute" : n.pos == 2 ? "sticky" : "relative")';
  return field === 'animation' ? `${row}=(n.mk == "" ? st.animation : motion(n.mk, n.md, n.mdl, n.me, n.mf, n.mit, n.mdir, n.msk, n.msd, n.step, n.cap, c.index, e))` : `${row}=${value}`;
}).join(' ');

function shape(d: number): string {
  const fields = ['t: string', 's: number', 'hs: number', 'fs: number', 'hh: bool', 'hf: bool', 'grp: bool', 'hg: bool', 'gs: number', 'fade: bool', 'pos: number', 'cond: Cond[]', 'parts: Part[]', 'src: Part[]', 'label: Part[]', 'arg: Part[]',
    'sym: string', 'act: string', 'role: string', 'level: number', 'test: Part[]', 'rep: string', 'lim: number',
    'mk: string', 'md: number', 'mdl: number', 'me: string', 'mf: string', 'mit: string', 'mdir: string', 'msk: string', 'msd: number', 'step: number', 'cap: number',
    ...BINDABLE.map(([, f]) => `${f}: Part[]`)];
  if (d < DEPTH) fields.push(`kids: N${d + 1}[]`);
  return `shape N${d}\n${fields.map(f => `  ${f}`).join('\n')}\n`;
}

function level(d: number): string {
  const next = d < DEPTH ? `
                  for k, ki in n.kids key=\`\${ki}\`
                    for cc, j in ctxs(n, c, e) key=ctxKey(cc, j)
                      L${d + 1}(n=k, c=Ctx(cc, index=(n.rep == "" ? cc.index : j), hot=(n.grp ? over or focused : cc.hot)), e=e, act=act, obs=obs)` : '';
  return `component L${d}
  props
    n: N${d}
    c: Ctx
    e: Env
    act: action
    obs: action
  state over = false
  state focused = false
  state ready = false
  derive st = styleAt(e.styles, over and n.hh ? n.hs : focused and n.hf ? n.fs : c.hot and n.hg ? n.gs : n.s)
  action hovering(v: bool)
    over = v
  action focusing
    focused = true
  action blurring
    focused = false
  action loaded
    ready = true
  view
    if shows(n.cond, c, e)
      if n.t == "text"
        text fill(n.parts, c, e) role=n.role aria-level=n.level testId=fill(n.test, c, e) ${rows('')}
      else
        if n.t == "image"
          image fill(n.src, c, e) alt=fill(n.label, c, e) testId=fill(n.test, c, e) load=loaded ${rows('').replace('opacity=st.opacity', 'opacity=(n.fade and not ready ? 0 : st.opacity)')}
        else
          if n.t == "icon"
            image \`symbol:\${n.sym}\` aria-hidden=true ${rows('')}
          else
            if n.t == "install"
              vela-install pwaAction=n.sym buttonLabel=fill(n.label, c, e)
            else
              if n.t == "observe"
                column width=1 height=1 position="absolute" top=0 left=0 pointer-events="none" aria-hidden=true intersect=obs(fill(n.arg, c, e))
              else
                column hover=hovering testId=fill(n.test, c, e) role=n.role aria-label=(n.act == "" ? fill(n.label, c, e) : "") ${rows('')}${next}
                  if n.act != ""
                    button press=act(n.act, fill(n.arg, c, e)) aria-label=fill(n.label, c, e) focus=focusing blur=blurring position="absolute" inset=0 z-index=1 margin=0 padding=0 border="none" background-color="transparent" color="inherit" cursor="pointer"
`;
}

// Contexts are zero-or-one lists (a record the renderer never has to construct, as
// foundation records gain fields): `m(list, expr)` reads a field or yields "".
const m = (list: string, expr: string) => `${list}.map(x => ${expr}).join("")`;
const yes = (cond: string) => `(${cond} ? "true" : "false")`;
const vocabulary: [string, string][] = [
  ...['id', 'kind', 'name', 'summary', 'facts', 'yearLabel', 'rating', 'progressLabel', 'poster', 'backdrop', 'logo', 'accent', 'receipt'].flatMap(f => [[`card.${f}`, m('c.card', `x.${f}`)], [`hero.${f}`, m('c.hero', `x.${f}`)]] as [string, string][]),
  ['card.played', m('c.card', yes('x.played'))], ['card.progressPct', m('c.card', 'pct(x.progressSeconds, x.durationSeconds)')],
  ['card.hasProgress', m('c.card', yes('x.progressSeconds > 0 and x.durationSeconds > 0 and not x.played'))],
  ['card.label', m('c.card', 'cardName(x)')], ['card.kindId', m('c.card', '`${x.id}|${x.kind}|${x.receipt}`')], ['hero.kindId', m('c.hero', '`${x.id}|${x.kind}|${x.receipt}`')],
  ['card.factsLine', m('c.card', '[x.facts].concat(x.genres.slice(0, 3)).filter(f => f != "").join(" · ")')], ['hero.factsLine', m('c.hero', '[x.facts].concat(x.genres.slice(0, 3)).filter(f => f != "").join(" · ")')],
  ['row.id', m('c.row', 'x.id')], ['row.name', m('c.row', 'x.name')], ['row.presentation', m('c.row', 'x.presentation')], ['row.hasMore', m('c.row', yes('x.nextCursor != ""'))],
  ...['reasonLabel', 'actionLabel', 'actionDetail', 'action', 'targetId'].map(f => [`heroAct.${f}`, m('c.heroAct', `x.${f}`)] as [string, string]),
  ['heroAct.progressPct', m('c.heroAct', '(x.progress * 100).toString()')], ['heroAct.hasProgress', m('c.heroAct', yes('x.progress > 0'))],
  ['heroAct.playable', m('c.heroAct', yes('x.action != "details" and x.targetId != ""'))],
  ['dest.id', m('c.dest', 'x.id')], ['dest.name', m('c.dest', 'x.name')], ['dest.kind', m('c.dest', 'x.kind')], ['dest.on', m('c.dest', yes('e.section == x.id'))],
  ['env.viewer', 'e.viewer'], ['env.viewerInitial', 'e.viewer.slice(0, 1).toUpperCase()'], ['env.section', 'e.section'], ['env.query', 'e.query'],
  ['env.small', yes('e.small')], ['env.still', yes('e.still')], ['env.searching', yes('e.query != ""')], ['env.canLive', yes('e.canLive')],
  ['env.heroCount', m('e.home', 'x.hero.length.toString()')], ['env.heroIndex', 'e.heroIndex.toString()'], ['env.rowCount', m('e.home', 'x.rows.length.toString()')],
  ['env.rotating', m('e.home', yes('x.hero.length > 1 and not e.still and e.query == ""'))],
  ['index', 'c.index.toString()'], ['index.label', '(c.index + 1).toString()'], ['index.current', yes('c.index == e.heroIndex')],
];

function core(): string {
  // Expressions nest at most 64 deep (syntax-expression-depth): the vocabulary is split into chunks.
  const chunks: [string, string][][] = [];
  for (let i = 0; i < vocabulary.length; i += 24) chunks.push(vocabulary.slice(i, i + 24));
  const chunkFns = chunks.map((chunk, i) => `fn val${i}(k: string, c: Ctx, e: Env): string = (${chunk.reduceRight((rest, [key, expr]) => `k == "${key}" ? ${expr} : ${rest}`, i + 1 < chunks.length ? `val${i + 1}(k, c, e)` : 'k.startsWith("flag:") ? (e.flags.includes(k.slice(5)) ? "true" : "false") : ""')})`).join('\n');
  const val = 'val0(k, c, e)';
  return `// Generated by tools/renderer.ts: do not edit. The skin document renderer (docs/skin-schema.md).
use Card, FeedRow, HomeModel, HeroAction, LibraryNav, cardName from "../foundation/models.contract"

shape Style
${STYLE.map(([f]) => `  ${f}: ${NUMERIC.has(f) ? 'number' : 'string'}`).join('\n')}

// One piece of a template: literal text, or a vocabulary key.
shape Part
  l: string
  k: string

shape Cond
  k: string
  is: string
  v: string
  not: bool

// Where a node is drawn: the records repeat nodes stepped into, and the item's index.
shape Ctx
  hot: bool
  card: Card[]
  row: FeedRow[]
  hero: Card[]
  heroAct: HeroAction[]
  dest: LibraryNav[]
  index: number

// What every node may read: the slot's models, the viewport class and the skin's flags.
shape Env
  styles: Style[]
  home: HomeModel[]
  libraries: LibraryNav[]
  viewer: string
  section: string
  query: string
  heroIndex: number
  small: bool
  still: bool
  canLive: bool
  flags: string[]

${Array.from({ length: DEPTH }, (_, i) => shape(DEPTH - i)).join('\n')}
// One slot's tree: its root container's style, its top-level nodes, and the flex
// order of the foundation's content among them (the route a shell wraps, the
// search field a home holds), so the renderer is inlined at one call site per slot.
shape DocSlot
  present: bool
  root: number
  slotStyle: number
  slotInner: number
  slotOrder: string
  nodes: N1[]

// A skin document as the renderer takes it (src/skin resolves it for one viewport class).
shape SkinDoc
  id: string
  styles: Style[]
  shell: DocSlot
  home: DocSlot
  detailWide: string
  detailSmall: string

${Object.entries(KEYFRAMES).map(([k, v]) => `keyframes vr-${k}\n  ${v}\n`).join('\n')}
fn noStyle(): Style = Style(${STYLE.map(([f]) => `${f}=${NUMERIC.has(f) ? ({ opacity: 1, flexShrink: 1, fontWeight: 400, scale: 1 } as Record<string, number>)[f] ?? 0 : '""'}`).join(', ')})
// The document's distinct styles, shared by index (nodes name theirs by position).
fn styleAt(styles: Style[], i: number): Style = match styles.at(i) { case some(s) => s, case none => noStyle() }
fn pct(at: number, of: number): string = (of > 0 ? min(100, at / of * 100).toString() : "0")
${chunkFns}
fn val(k: string, c: Ctx, e: Env): string = ${val}
fn fill(parts: Part[], c: Ctx, e: Env): string = parts.map(p => (p.k == "" ? p.l : val(p.k, c, e))).join("")
fn num(s: string): number = match parseNumber(s) { case some(x) => x, case none => 0 }
fn holds(k: Cond, c: Ctx, e: Env): bool = (k.is == "eq" ? val(k.k, c, e) == k.v : k.is == "ne" ? val(k.k, c, e) != k.v : k.is == "gt" ? num(val(k.k, c, e)) > num(k.v) : k.is == "lt" ? num(val(k.k, c, e)) < num(k.v) : val(k.k, c, e) != "" and val(k.k, c, e) != "false" and val(k.k, c, e) != "0")
fn shows(conds: Cond[], c: Ctx, e: Env): bool = not conds.map(k => holds(k, c, e) == k.not).includes(true)
fn motion(mk: string, md: number, mdl: number, me: string, mf: string, mit: string, mdir: string, msk: string, msd: number, step: number, cap: number, i: number, e: Env): string = (e.still ? (msk == "" ? "none" : \`\${msk} \${msd}ms linear both\`) : \`\${mk} \${md}ms \${me} \${mdl + min(i, cap) * step}ms \${mit} \${mdir} \${mf}\`)
fn heroActFor(home: HomeModel, id: string): HeroAction[] = home.heroActions.filter(a => a.heroId == id).slice(0, 1)
fn rootCtx(): Ctx = Ctx(hot=false, card=[], row=[], hero=[], heroAct=[], dest=[], index=0)
fn ctxKey(c: Ctx, j: number): string = \`\${j}:\${c.card.map(x => x.id).join("")}:\${c.row.map(x => x.id).join("")}:\${c.hero.map(x => x.id).join("")}:\${c.dest.map(x => x.id).join("")}\`
${Array.from({ length: DEPTH - 1 }, (_, i) => i + 1).map(d => `fn ctxs${d}(n: N${d}, c: Ctx, e: Env): Ctx[] = ${ctxsBody(d)}`).join('\n')}
`;
}
const ctxsBody = (d: number) => `(n.rep == "" ? [c] : n.rep == "home.rows" ? match first(e.home) { case some(h) => h.rows.slice(0, n.lim).map(r => Ctx(c, row=[r])), case none => [] } : n.rep == "row.items" ? match first(c.row) { case some(r) => r.items.slice(0, n.lim).map(x => Ctx(c, card=[x])), case none => [] } : n.rep == "home.heroes" ? match first(e.home) { case some(h) => h.hero.slice(0, n.lim).map(x => Ctx(c, hero=[x], heroAct=heroActFor(h, x.id))), case none => [] } : n.rep == "home.hero" ? match first(e.home) { case some(h) => h.hero.slice(e.heroIndex, e.heroIndex + 1).map(x => Ctx(c, hero=[x], heroAct=heroActFor(h, x.id))), case none => [] } : n.rep == "nav.destinations" ? e.libraries.slice(0, n.lim).map(l => Ctx(c, dest=[l])) : [])`;

export async function generate(out = resolve(import.meta.dir, '../client/renderer')) {
  let levels = '';
  for (let d = 1; d <= DEPTH; d++) levels += level(d).replace('ctxs(n, c, e)', `ctxs${d}(n, c, e)`) + '\n';
  await writeFile(join(out, 'levels.contract'), core() + '\n' + levels);
}
if (import.meta.main) await generate();
