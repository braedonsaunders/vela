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

export const DEPTH = 10;
/** The shell's tree enters the levels at this depth: it needs 6, so its copy of the renderer is 6 levels, not 10. */
export const SHELL_FROM = 5;
/** Style rows: Contract field name and the row it writes. Inherited ones default to "inherit" (src/skin). */
export const STYLE: [string, string][] = [
  ['display', 'display'], ['position', 'position'], ['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'], ['zIndex', 'z-index'],
  ['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['minHeight', 'min-height'], ['maxWidth', 'max-width'], ['maxHeight', 'max-height'], ['aspectRatio', 'aspect-ratio'], ['boxSizing', 'box-sizing'],
  ['flexGrow', 'flex-grow'], ['flexBasis', 'flex-basis'], ['flexDirection', 'flex-direction'], ['flexWrap', 'flex-wrap'], ['flexShrink', 'flex-shrink'], ['alignItems', 'align-items'], ['alignSelf', 'align-self'], ['justifyContent', 'justify-content'], ['gap', 'gap'], ['order', 'order'],
  ['gridTemplateColumns', 'grid-template-columns'], ['gridTemplateRows', 'grid-template-rows'], ['gridColumn', 'grid-column'], ['gridRow', 'grid-row'],
  ['paddingTop', 'padding-top'], ['paddingRight', 'padding-right'], ['paddingBottom', 'padding-bottom'], ['paddingLeft', 'padding-left'], ['marginTop', 'margin-top'], ['marginRight', 'margin-right'], ['marginBottom', 'margin-bottom'], ['marginLeft', 'margin-left'], ['overflowX', 'overflow-x'], ['overflowY', 'overflow-y'], ['scrollSnapType', 'scroll-snap-type'], ['scrollSnapAlign', 'scroll-snap-align'], ['scrollbarWidth', 'scrollbar-width'],
  ['color', 'color'], ['backgroundColor', 'background-color'], ['backgroundImage', 'background-image'], ['opacity', 'opacity'],
  ['borderWidth', 'border-width'], ['borderStyle', 'border-style'], ['borderColor', 'border-color'], ['borderRadius', 'border-radius'], ['boxShadow', 'box-shadow'], ['filter', 'filter'], ['backdropFilter', 'backdrop-filter'], ['maskImage', 'mask-image'],
  ['fontFamily', 'font-family'], ['fontSize', 'font-size'], ['fontWeight', 'font-weight'], ['fontStyle', 'font-style'], ['lineHeight', 'line-height'], ['letterSpacing', 'letter-spacing'], ['textTransform', 'text-transform'],
  ['textAlign', 'text-align'], ['textShadow', 'text-shadow'], ['textStroke', '-webkit-text-stroke'], ['lineClamp', 'line-clamp'], ['whiteSpace', 'white-space'], ['fontVariantNumeric', 'font-variant-numeric'],
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

/** An element's rows, read off its `s: Style` prop (a prop is evaluated once at the call
 * site; a derive or fn is expanded at every use, which made each row carry the whole style
 * lookup), with the bound overrides (`d*` props, already filled) and the motion. */
const CONTENT_ONLY = new Set(['lineClamp', 'objectFit']);
const rows = () => STYLE.filter(([field]) => !CONTENT_ONLY.has(field)).map(([field, row]) => {
  const bind = BINDABLE.find(([f]) => f === field);
  // A box that clips or scrolls takes only relative/absolute/sticky (lower-attr-value); the checker reads the choice off a prop.
  if (field === 'position') return 'position=pos';
  if (field === 'animation') return 'animation=(anim != "" ? anim : s.animation)';
  if (field === 'opacity') return 'opacity=(fade ? 0 : dop != "" ? num(dop) : s.opacity)';
  return bind ? `${row}=(${bind[1]} != "" ? ${bind[1]} : s.${field})` : `${row}=s.${field}`;
}).join(' ');
const elementProps = `    s: Style
    pos: string
    anim: string
    fade: bool
${BINDABLE.map(([, f]) => `    ${f}: string`).join('\n')}`;
/** The four element components every level draws through. */
/** One element per level: a box carrying every style row. Text, images and icons are
 * light children of that box (a few content rows), so a level emits one heavy element,
 * not four (each emitted element costs its ~90 bound rows again). */
function elements(): string {
  return `// The renderer's element: every node draws through it (docs/skin-schema.md).
component BoxEl
  props
${elementProps}
    test: string
    role: string
    label: string
    hovering: action
  slot
  view
    box hover=hovering testId=test role=role aria-label=label ${rows()}
      children
`;
}
/** The props every element call passes: the node's style for its state, motion and bound rows. */
const pass = () => `s=st, pos=(n.pos == 1 ? "absolute" : n.pos == 2 ? "sticky" : "relative"), anim=(n.mk == "" ? "" : motion(n.mk, n.md, n.mdl, n.me, n.mf, n.mit, n.mdir, n.msk, n.msd, n.step, n.cap, cx.index, e)), fade=false, ${BINDABLE.map(([, f]) => `${f}=fill(n.${f}, vals, e)`).join(', ')}`;

function shape(d: number): string {
  const fields = ['t: string', 's: number', 'hs: number', 'fs: number', 'hh: bool', 'hf: bool', 'grp: bool', 'hg: bool', 'gs: number', 'hs2: number', 'fs2: number', 'gs2: number', 'fade: bool', 'pos: number', 'cond: Cond[]', 'parts: Part[]', 'src: Part[]', 'label: Part[]', 'arg: Part[]',
    'sym: string', 'act: string', 'role: string', 'level: number', 'test: Part[]', 'rep: string', 'lim: number',
    'mk: string', 'md: number', 'mdl: number', 'me: string', 'mf: string', 'mit: string', 'mdir: string', 'msk: string', 'msd: number', 'step: number', 'cap: number',
    ...BINDABLE.map(([, f]) => `${f}: Part[]`)];
  if (d < DEPTH) fields.push(`kids: N${d + 1}[]`);
  return `shape N${d}\n${fields.map(f => `  ${f}`).join('\n')}\n`;
}

function level(d: number): string {
  // A repeat is its item node with `rep` set: the parent steps each child into its own
  // contexts, so repeated items are the parent's direct children (no wrapper box).
  const child = 'Ctx(cc, index=(k.rep == "" ? cc.index : j), hot=(n.grp ? over or focused : cc.hot))';
  // Exact substitutes a prop's expression at every use and expands fns and derives in place,
  // so each value the renderer reuses is bound once by a one-element \`for\` (a runtime value).
  const next = d < DEPTH ? `
                        for k, ki in n.kids key=\`\${ki}\`
                          for cc, j in ctxs${d + 1}(k, cx, e) key=ctxKey(cc, j)
                            V${d + 1}(n=k, c=${child}, e=e, act=act, obs=obs)` : '';
  return `component V${d}
  props
    n: N${d}
    c: Ctx
    e: Env
    act: action
    obs: action
  state over = false
  state focused = false
  state ready = false
  action hovering(v: bool)
    over = v
  action focusing
    focused = true
  action blurring
    focused = false
  action loaded
    ready = true
  view
    for cx in [c] key="c"
      for vals in [binds(cx, e)] key="v"
        if shows(n.cond, vals, e)
          for st in [styleAt(e, over and n.hh ? (e.still ? n.hs2 : n.hs) : focused and n.hf ? (e.still ? n.fs2 : n.fs) : cx.hot and n.hg ? (e.still ? n.gs2 : n.gs) : n.s)] key="s"
            if n.t == "install"
              vela-install pwaAction=n.sym buttonLabel=fill(n.label, vals, e)
            else
              if n.t == "observe"
                column width=1 height=1 position="absolute" top=0 left=0 pointer-events="none" aria-hidden=true intersect=obs(fill(n.arg, vals, e))
              else
                BoxEl(${pass()}, test=(n.t == "box" ? fill(n.test, vals, e) : ""), role=(n.t == "box" ? n.role : ""), label=(n.t == "box" and n.act == "" ? fill(n.label, vals, e) : ""), hovering=hovering)
                  if n.t == "text"
                    text fill(n.parts, vals, e) role=n.role aria-level=n.level testId=fill(n.test, vals, e) line-clamp=st.lineClamp
                  else
                    if n.t == "image"
                      image fill(n.src, vals, e) alt=fill(n.label, vals, e) testId=fill(n.test, vals, e) load=loaded width="100%" height="100%" object-fit=st.objectFit opacity=(n.fade and not ready ? 0 : 1) transition=(n.fade ? "opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)" : "none")
                    else
                      if n.t == "icon"
                        image \`symbol:\${n.sym}\` aria-hidden=true width="100%" height="100%"
                      else${next}
                        if n.act != ""
                          button press=act(n.act, fill(n.arg, vals, e)) aria-label=fill(n.label, vals, e) focus=focusing blur=blurring position="absolute" inset=0 z-index=1 margin=0 padding=0 border="none" background-color="transparent" color="inherit" cursor="pointer"
`;
}

// Contexts are zero-or-one lists (a record the renderer never has to construct, as
// foundation records gain fields): `m(list, expr)` reads a field or yields "".
// A `match first(...)` reads the field without building a list (a `.map(...).join` built
// one per key per node: 1,600 record constructions in the bundle).
const m = (list: string, expr: string) => `match first(${list}) { case some(x) => ${expr}, case none => "" }`;
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
  // Every vocabulary value of a context, once per node (a derive), in VOCAB order:
  // inlining a resolver at each template site multiplied the bundle (4,752 copies).
  const binds = vocabulary.map(([, expr]) => expr).join(', ');
  return `// Generated by tools/renderer.ts: do not edit. The skin document renderer (docs/skin-schema.md).
use Card, FeedRow, HomeModel, HeroAction, LibraryNav, cardName from "../foundation/models.contract"

shape Style
${STYLE.map(([f]) => `  ${f}: ${NUMERIC.has(f) ? 'number' : 'string'}`).join('\n')}

// One piece of a template: literal text, or a vocabulary key.
shape Part
  l: string
  k: number
  f: string

shape Cond
  k: number
  f: string
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
  dflt: Style
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

shape ShellSlot
  present: bool
  root: number
  slotStyle: number
  slotInner: number
  slotOrder: string
  nodes: N${SHELL_FROM}[]

// A skin document as the renderer takes it (src/skin resolves it for one viewport class).
shape SkinDoc
  id: string
  styles: Style[]
  shell: ShellSlot
  home: DocSlot
  detailWide: string
  detailSmall: string

${Object.entries(KEYFRAMES).map(([k, v]) => `keyframes vr-${k}\n  ${v}\n`).join('\n')}
fn noStyle(): Style = Style(${STYLE.map(([f]) => `${f}=${NUMERIC.has(f) ? ({ opacity: 1, flexShrink: 1, fontWeight: 400, scale: 1 } as Record<string, number>)[f] ?? 0 : '""'}`).join(', ')})
// The document's distinct styles, shared by index (nodes name theirs by position).
fn styleAt(e: Env, i: number): Style = match e.styles.at(i) { case some(s) => s, case none => e.dflt }
fn pct(at: number, of: number): string = (of > 0 ? min(100, at / of * 100).toString() : "0")
fn binds(c: Ctx, e: Env): string[] = [${binds}]
fn pick(vals: string[], i: number): string = match vals.at(i) { case some(v) => v, case none => "" }
fn flagged(e: Env, f: string): string = (e.flags.includes(f) ? "true" : "false")
fn fill(parts: Part[], vals: string[], e: Env): string = parts.map(p => (p.f != "" ? flagged(e, p.f) : p.k < 0 ? p.l : pick(vals, p.k))).join("")
fn num(s: string): number = match parseNumber(s) { case some(x) => x, case none => 0 }
fn subject(k: Cond, vals: string[], e: Env): string = (k.f != "" ? flagged(e, k.f) : pick(vals, k.k))
fn holds(k: Cond, vals: string[], e: Env): bool = (k.is == "eq" ? subject(k, vals, e) == k.v : k.is == "ne" ? subject(k, vals, e) != k.v : k.is == "gt" ? num(subject(k, vals, e)) > num(k.v) : k.is == "lt" ? num(subject(k, vals, e)) < num(k.v) : not ["", "false", "0"].includes(subject(k, vals, e)))
fn shows(conds: Cond[], vals: string[], e: Env): bool = not conds.map(k => holds(k, vals, e) == k.not).includes(true)
fn motion(mk: string, md: number, mdl: number, me: string, mf: string, mit: string, mdir: string, msk: string, msd: number, step: number, cap: number, i: number, e: Env): string = (e.still ? (msk == "" ? "none" : \`\${msk} \${msd}ms linear both\`) : \`\${mk} \${md}ms \${me} \${mdl + min(i, cap) * step}ms \${mit} \${mdir} \${mf}\`)
fn heroActFor(home: HomeModel, id: string): HeroAction[] = home.heroActions.filter(a => a.heroId == id).slice(0, 1)
fn rootCtx(): Ctx = Ctx(hot=false, card=[], row=[], hero=[], heroAct=[], dest=[], index=0)
fn ctxKey(c: Ctx, j: number): string = \`\${j}:\${c.card.map(x => x.id).join("")}:\${c.row.map(x => x.id).join("")}:\${c.hero.map(x => x.id).join("")}:\${c.dest.map(x => x.id).join("")}\`
${Array.from({ length: DEPTH }, (_, i) => i + 1).map(d => `fn ctxs${d}(n: N${d}, c: Ctx, e: Env): Ctx[] = ${ctxsBody(d)}`).join('\n')}
`;
}
const ctxsBody = (d: number) => `(n.rep == "" ? [c] : n.rep == "home.rows" ? match first(e.home) { case some(h) => h.rows.slice(0, n.lim).map(r => Ctx(c, row=[r])), case none => [] } : n.rep == "row.items" ? match first(c.row) { case some(r) => r.items.slice(0, n.lim).map(x => Ctx(c, card=[x])), case none => [] } : n.rep == "home.heroes" ? match first(e.home) { case some(h) => h.hero.slice(0, n.lim).map(x => Ctx(c, hero=[x], heroAct=heroActFor(h, x.id))), case none => [] } : n.rep == "home.hero" ? match first(e.home) { case some(h) => h.hero.slice(e.heroIndex, e.heroIndex + 1).map(x => Ctx(c, hero=[x], heroAct=heroActFor(h, x.id))), case none => [] } : n.rep == "nav.destinations" ? e.libraries.slice(0, n.lim).map(l => Ctx(c, dest=[l])) : [])`;

export async function generate(out = resolve(import.meta.dir, '../client/renderer')) {
  await writeFile(resolve(import.meta.dir, '../client/src/skin/vocabulary.ts'), `// Generated by tools/renderer.ts: the binding vocabulary in the renderer's order.\nexport const VOCAB: string[] = ${JSON.stringify(vocabulary.map(([key]) => key))};\n`);
  let levels = '';
  for (let d = 1; d <= DEPTH; d++) levels += level(d) + '\n';
  await writeFile(join(out, 'levels.contract'), core() + '\n' + elements() + '\n' + levels);
}
if (import.meta.main) await generate();
