/**
 * Generates client/renderer/levels.contract: the bounded-depth renderer that draws a
 * skin document (protocol/v0/skin.ts). Contract shapes cannot recurse and components
 * cannot call themselves (contract-grammar.md:3020, syntax-inline-depth), so a
 * document tree is drawn by DEPTH levels L1..LDEPTH over shapes N1..NDEPTH. Exact
 * inlines a component at each call site, so every level calls the next from exactly
 * one site: one generic container, leaves branch. Run: bun tools/renderer.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const DEPTH = 10;
/** Heavy widgets (the live tile's player) are drawn only by the first levels: each level is a copy. */
export const WIDGET_DEPTH = 3;
/** The shell's tree enters the levels at this depth: it needs 6, so its copy of the renderer is 6 levels, not 10. */
export const SHELL_FROM = 5;
/** Style rows: Contract field name and the row it writes. Inherited ones default to "inherit" (src/skin). */
export const STYLE: [string, string][] = [
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
  sway: '25% rotate=-1.5\n  75% rotate=1.5', sheen: 'from translate="-120% 0px"\n  to translate="120% 0px"', tick: '50% opacity=0',
  tvOn: 'from opacity=0 scale=0.02\n  40% opacity=1 scale=1.02', jitter: '20% translate="-3px 0px"\n  40% translate="3px 0px"\n  60% translate="-2px 0px"\n  80% translate="2px 0px"',
};
/** Rows Exact types as numbers (lower-attr-type); the data module resolves their defaults and inheritance. */
export const NUMERIC = new Set(['opacity', 'order', 'flexGrow', 'flexShrink', 'fontWeight', 'lineClamp', 'scale', 'rotate']);
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
    domId: string
    role: string
    label: string
    lt: string
    se: string
    exitAnim: string
    hovering: action
    pointing: action
    keying: action
  slot
  view
    box id=domId hover=hovering pointerdown=pointing key=keying testId=test role=role aria-label=label -exact-layout-transition=lt sharedElement=se -exact-exit-animation=exitAnim ${rows()}
      children
`;
}
/** The props every element call passes: the node's style for its state, motion and bound rows. */
const pass = () => `s=st, pos=(n.pos == 1 ? "absolute" : n.pos == 2 ? "sticky" : "relative"), anim=(n.mk == "" ? "" : motion(n.mk, n.md, n.mdl, n.me, n.mf, n.mit, n.mdir, n.msk, n.msd, n.step, n.cap, cx.index, e)), fade=false, ${BINDABLE.map(([, f]) => `${f}=fill(n.${f}, vals, e)`).join(', ')}`;

function shape(d: number): string {
  const fields = ['t: string', 'base: StateRef', 'sts: StateRef[]', 'hh: bool', 'hf: bool', 'grp: bool', 'hg: bool', 'gf: bool', 'fade: bool', 'pos: number', 'dis: Cond[]', 'aexp: Cond[]', 'asel: Cond[]', 'acur: Cond[]', 'aprs: Cond[]', 'ahp: string', 'atitle: Part[]', 'brole: string', 'pfocus: Part[]', 'esc: string', 'escTo: Part[]', 'lt: string', 'se: string', 'ex: string', 'exs: string', 'ivb: string', 'ipaths: string[]', 'fr: string', 'cond: Cond[]', 'parts: Part[]', 'src: Part[]', 'label: Part[]', 'arg: Part[]',
    'sym: string', 'act: string', 'role: string', 'level: number', 'test: Part[]', 'dom: Part[]', 'rep: string', 'lim: number',
    'mk: string', 'md: number', 'mdl: number', 'me: string', 'mf: string', 'mit: string', 'mdir: string', 'msk: string', 'msd: number', 'step: number', 'cap: number',
    ...BINDABLE.map(([, f]) => `${f}: Part[]`)];
  if (d < DEPTH) fields.push(`kids: N${d + 1}[]`);
  return `shape N${d}\n${fields.map(f => `  ${f}`).join('\n')}\n`;
}

function level(d: number): string {
  // A repeat is its item node with `rep` set: the parent steps each child into its own
  // contexts, so repeated items are the parent's direct children (no wrapper box).
  const child = 'Ctx(cc, index=(k.rep == "" ? cc.index : j), hot=(n.grp ? over or focused : cc.hot), fhot=(n.grp ? focused : cc.fhot))';
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
${d <= WIDGET_DEPTH ? `  inject
    tileMessage: action
` : ''}  state over = false
  state focused = false
  state ready = false
  action hovering(v: bool)
    over = v
  state pointed = false
  // Keyboard focus only (focus-visible): a focus that follows a pointer press draws no focus overlay.
  action pointing
    pointed = true
  action focusing
    focused = not pointed
  action blurring
    focused = false
    pointed = false
  action pressing(arg: string, to: string)
    act(n.act, arg)
    if to != ""
      focus(to)
  action escaping(to: string, k: string)
    if k == "Escape" and n.esc != ""
      preventDefault()
      act("close", n.esc)
      if to != ""
        focus(to)
  action loaded
    ready = true
  view
    for cx in [c] key="c"
      for vals in [binds(cx, e)] key="v"
        if shows(n.cond, vals, e)
          for sr in [stateOf(n.sts, n.base, vals, e)] key="r"
            for dis in [n.dis.length > 0 and shows(n.dis, vals, e)] key="d"
              for st in [styleAt(e, dis ? sr.ds : over and n.hh ? (e.still ? sr.hs2 : sr.hs) : focused and n.hf ? (e.still ? sr.fs2 : sr.fs) : cx.fhot and n.gf ? (e.still ? sr.gfs2 : sr.gfs) : cx.hot and n.hg ? (e.still ? sr.gs2 : sr.gs) : sr.s)] key="s"
                if n.t == "install"
                  vela-install pwaAction=n.sym buttonLabel=fill(n.label, vals, e)
${d <= WIDGET_DEPTH ? `                else if n.t == "liveTile"
                  for t in e.tile key=t.channelId
                    if t.planJson != "" and (t.state == "connecting" or t.state == "playing")
                      vela-player plan=t.planJson playerCommand=t.commandJson message=tileMessage ambient="true" position="absolute" inset=0 width="100%" height="100%" aria-hidden=true
` : ''}                else
                  if n.t == "observe"
                    column width=1 height=1 position="absolute" top=0 left=0 pointer-events="none" aria-hidden=true intersect=obs(fill(n.arg, vals, e))
                  else
                    BoxEl(${pass()}, test=(n.t == "box" ? fill(n.test, vals, e) : ""), domId=fill(n.dom, vals, e), role=(n.t == "box" ? n.role : ""), label=(n.t == "box" and n.act == "" ? fill(n.label, vals, e) : ""), lt=(e.still ? "none" : n.lt), se=n.se, exitAnim=(e.still ? n.exs : n.ex), hovering=hovering, pointing=pointing, keying=escaping(fill(n.escTo, vals, e)))
                      if n.t == "text"
                        text fill(n.parts, vals, e) role=n.role aria-level=n.level testId=fill(n.test, vals, e) line-clamp=st.lineClamp overflow-x=st.overflowX text-overflow=st.textOverflow
                      else
                        if n.t == "image"
                          image fill(n.src, vals, e) alt=fill(n.label, vals, e) testId=fill(n.test, vals, e) load=loaded width="100%" height="100%" object-fit=st.objectFit opacity=(n.fade and not ready ? 0 : 1) transition=(n.fade ? "opacity 420ms cubic-bezier(0.16, 1, 0.3, 1)" : "none")
                        else
                          if n.t == "icon"
                            if n.sym != ""
                              image \`symbol:\${n.sym}\` aria-hidden=true width="100%" height="100%"
                            else
                              svg viewBox=n.ivb width="100%" height="100%" aria-hidden=true
                                for p, pi in n.ipaths key=\`\${pi}\`
                                  path d=p fill="currentColor" fill-rule=(n.fr == "evenodd" ? "evenodd" : "nonzero")
                          else${next}
                            if n.act != ""
                              if n.aexp.length > 0 or n.asel.length > 0
                                button press=pressing(fill(n.arg, vals, e), fill(n.pfocus, vals, e)) disabled=dis aria-label=fill(n.label, vals, e) role=n.brole title=fill(n.atitle, vals, e) aria-expanded=(n.aexp.length > 0 and shows(n.aexp, vals, e)) aria-selected=(n.asel.length > 0 and shows(n.asel, vals, e)) aria-current=aria(n.acur, vals, e) aria-pressed=aria(n.aprs, vals, e) aria-haspopup=n.ahp focus=focusing blur=blurring outline=(n.hf or n.hg or n.gf ? "none" : "") position="absolute" inset=0 z-index=1 margin=0 padding=0 border="none" background-color="transparent" background-image="none" color="inherit" cursor="pointer"
                              else
                                button press=pressing(fill(n.arg, vals, e), fill(n.pfocus, vals, e)) disabled=dis aria-label=fill(n.label, vals, e) role=n.brole title=fill(n.atitle, vals, e) aria-current=aria(n.acur, vals, e) aria-pressed=aria(n.aprs, vals, e) aria-haspopup=n.ahp focus=focusing blur=blurring outline=(n.hf or n.hg or n.gf ? "none" : "") position="absolute" inset=0 z-index=1 margin=0 padding=0 border="none" background-color="transparent" background-image="none" color="inherit" cursor="pointer"
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
  ['card.played', m('c.card', yes('x.played'))], ['card.episodeNumberLabel', m('c.card', 'x.episodeNumberLabel')], ['card.durationLabel', m('c.card', 'x.durationLabel')], ['card.progressPct', m('c.card', 'pct(x.progressSeconds, x.durationSeconds)')],
  ['card.hasProgress', m('c.card', yes('x.progressSeconds > 0 and x.durationSeconds > 0 and not x.played'))],
  ['card.label', m('c.card', 'cardName(x)')], ['card.kindId', m('c.card', '`${x.id}|${x.kind}|${x.receipt}`')], ['hero.kindId', m('c.hero', '`${x.id}|${x.kind}|${x.receipt}`')],
  ['card.factsLine', m('c.card', '[x.facts].concat(x.genres.slice(0, 3)).filter(f => f != "").join(" · ")')], ['card.genresComma', m('c.card', 'x.genres.join(", ")')], ['hero.factsLine', m('c.hero', '[x.facts].concat(x.genres.slice(0, 3)).filter(f => f != "").join(" · ")')],
  ['row.id', m('c.row', 'x.id')], ['row.name', m('c.row', 'x.name')], ['row.presentation', m('c.row', 'x.presentation')], ['row.hasMore', m('c.row', yes('x.nextCursor != ""'))],
  ...['reasonLabel', 'actionLabel', 'actionDetail', 'action', 'targetId'].map(f => [`heroAct.${f}`, m('c.heroAct', `x.${f}`)] as [string, string]),
  ['heroAct.progressPct', m('c.heroAct', '(x.progress * 100).toString()')], ['heroAct.hasProgress', m('c.heroAct', yes('x.progress > 0'))],
  ['heroAct.playable', m('c.heroAct', yes('x.action != "details" and x.targetId != ""'))],
  ['dest.id', m('c.dest', 'x.id')], ['dest.name', m('c.dest', 'x.name')], ['dest.kind', m('c.dest', 'x.kind')], ['dest.on', m('c.dest', yes('(x.kind == "live" ? e.section == "live" : e.section == x.id)'))],
  ['env.viewer', 'e.viewer'], ['env.viewerInitial', 'e.viewer.slice(0, 1).toUpperCase()'], ['env.section', 'e.section'], ['env.query', 'e.query'],
  ['env.small', yes('e.small')], ['env.tv', yes('e.tv')], ['env.still', yes('e.still')], ['env.searching', yes('e.query != ""')], ['env.canLive', yes('e.canLive')],
  ['env.heroCount', m('e.home', 'x.hero.length.toString()')], ['env.heroIndex', 'e.heroIndex.toString()'], ['env.rowCount', m('e.home', 'x.rows.length.toString()')],
  ['env.rotating', m('e.home', yes('x.hero.length > 1 and not e.still and e.query == ""'))],
  // Renderer 3 (docs/skin-schema.md): seeds and name lengths for stable per-title choices.
  ['card.seed', m('c.card', 'x.id.length.toString()')], ['hero.seed', m('c.hero', 'x.id.length.toString()')], ['dest.seed', m('c.dest', 'x.id.length.toString()')],
  ['extra.seed', m('c.extra', 'x.id.length.toString()')], ['person.seed', m('c.person', 'x.name.length.toString()')],
  ['card.nameLength', m('c.card', 'x.name.length.toString()')], ['hero.nameLength', m('c.hero', 'x.name.length.toString()')], ['row.nameLength', m('c.row', 'x.name.length.toString()')],
  ['person.nameLength', m('c.person', 'x.name.length.toString()')], ['dest.nameLength', m('c.dest', 'x.name.length.toString()')],
  ['card.seasonNumber', m('c.card', 'x.seasonNumber.toString()')], ['card.episodeNumber', m('c.card', 'x.episodeNumber.toString()')], ['card.seasonNumberLabel', m('c.card', 'x.seasonNumberLabel')],
  ['card.unwatched', m('c.card', yes('(x.kind == "movie" or x.kind == "episode") and not x.played and x.progressSeconds <= 0'))],
  ['card.genresComma', m('c.card', 'x.genres.join(", ")')], ['hero.label', m('c.hero', 'cardName(x)')], ['hero.genresLine', m('c.hero', 'x.genres.slice(0, 3).join(", ")')],
  ['hero.metaLine', m('c.hero', '[x.yearLabel].concat(x.genres.slice(0, 3)).concat([x.rating]).filter(f => f != "").join(" · ")')],
  ['row.landscape', m('c.row', yes('x.items.length > 0 and not x.items.map(i => i.kind == "episode" or (i.progressSeconds > 0 and not i.played)).includes(false)'))],
  ['row.resume', m('c.row', yes('x.items.length > 0 and not x.items.map(i => i.progressSeconds > 0 and not i.played).includes(false)'))],
  ['row.previewOnFocus', m('c.row', yes('x.previewOnFocus'))], ['row.loadingMore', m('c.row', yes('e.rowLoading.includes(x.id)'))],
  ['dest.backdrop', m('c.dest', 'x.backdrop')],
  ['env.width', 'e.width.toString()'], ['env.skinCount', 'e.skinCount.toString()'], ['env.libraryCount', 'e.libraries.length.toString()'],
  ['env.hasLiveLibrary', yes('e.libraries.map(l => l.kind == "live").includes(true)')], ['env.homeMoreLoading', yes('e.homeLoading')],
  ['env.homeHasMore', m('e.home', yes('x.nextCursor != ""'))],
  ['detail.yearLabel', `match first(e.detail) { case some(d) => ${m('d.title', 'x.yearLabel')}, case none => "" }`], ['detail.year', `match first(e.detail) { case some(d) => ${m('d.title', 'x.year.toString()')}, case none => "" }`],
  ['detail.rating', `match first(e.detail) { case some(d) => ${m('d.title', 'x.rating')}, case none => "" }`], ['detail.played', `match first(e.detail) { case some(d) => ${m('d.title', yes('x.played'))}, case none => "" }`],
  ['detail.durationLabel', `match first(e.detail) { case some(d) => ${m('d.title', 'x.durationLabel')}, case none => "" }`],
  ['detail.hasProgress', `match first(e.detail) { case some(d) => ${m('d.title', yes('x.progressSeconds > 0 and x.durationSeconds > 0 and not x.played'))}, case none => "" }`],
  ['detail.progressPct', `match first(e.detail) { case some(d) => ${m('d.title', 'pct(x.progressSeconds, x.durationSeconds)')}, case none => "0" }`],
  ['detail.seasonNumberLabel', `match first(e.detail) { case some(d) => ${m('d.title', 'x.seasonNumberLabel')}, case none => "" }`],
  ['detail.episodeNumberLabel', `match first(e.detail) { case some(d) => ${m('d.title', 'x.episodeNumberLabel')}, case none => "" }`],
  ['detail.episodeNumber', `match first(e.detail) { case some(d) => ${m('d.title', 'x.episodeNumber.toString()')}, case none => "" }`],
  ['detail.resumePosition', 'match first(e.detail) { case some(d) => d.resumePosition, case none => "" }'],
  ['detail.seasonCount', 'match first(e.detail) { case some(d) => d.seasons.length.toString(), case none => "0" }'],
  ['detail.seasonName', 'match first(e.detail) { case some(d) => d.seasons.filter(x => x.id == e.season).map(x => x.name).join(""), case none => "" }'],
  ['detail.seasonPending', `match first(e.detail) { case some(d) => ${yes('e.season != "" and d.episodes.length > 0 and not d.episodes.map(x => x.seasonId == e.season).includes(true)')}, case none => "false" }`],
  ['detail.genresLine', `match first(e.detail) { case some(d) => ${m('d.title', 'x.genres.join(", ")')}, case none => "" }`],
  ['detail.crewLineComma', 'match first(e.detail) { case some(d) => d.crew.join(", "), case none => "" }'],
  ['detail.trailerId', 'match first(e.detail) { case some(d) => d.trailerId, case none => "" }'],
  ['detail.trailerReady', `match first(e.detail) { case some(d) => ${yes('d.trailerId != "" and d.trailerReady')}, case none => "false" }`],
  ['detail.castLine', 'match first(e.detail) { case some(d) => d.cast.join(" · "), case none => "" }'],
  ['detail.nameLength', `match first(e.detail) { case some(d) => ${m('d.title', 'x.name.length.toString()')}, case none => "" }`],
  ['detail.seed', `match first(e.detail) { case some(d) => ${m('d.title', 'x.id.length.toString()')}, case none => "" }`],
  ['genre.text', 'match first(c.fact) { case some(x) => x, case none => "" }'],
  ['index', 'c.index.toString()'], ['index.label', '(c.index + 1).toString()'], ['index.current', yes('c.index == e.heroIndex')],
  ['env.route', 'e.route'], ['env.load', 'e.load'], ['env.canRetry', yes('e.load == "failed"')], ['env.entry', 'e.entry'],
  // Detail: the title, its play state, seasons and episodes, extras, cast and crew.
  ...['id', 'kind', 'name', 'summary', 'facts', 'poster', 'backdrop', 'logo', 'accent', 'receipt'].map(f => [`detail.${f}`, `match first(e.detail) { case some(d) => ${m('d.title', `x.${f}`)}, case none => "" }`] as [string, string]),
  ['detail.kindLabel', `match first(e.detail) { case some(d) => ${m('d.title', '(x.kind == "movie" ? t("ui.film") : x.kind == "show" ? t("ui.series") : x.kind == "season" ? t("ui.season") : t("ui.episode"))')}, case none => "" }`],
  ['detail.kindId', `match first(e.detail) { case some(d) => ${m('d.title', '`${x.id}|${x.kind}|${x.receipt}`')}, case none => "" }`],
  ['detail.factsLine', `match first(e.detail) { case some(d) => ${m('d.title', '[x.facts].concat(x.genres.slice(0, 3)).filter(f => f != "").join(" · ")')}, case none => "" }`],
  ['detail.canPlay', `match first(e.detail) { case some(d) => ${yes('d.canPlay')}, case none => "false" }`],
  ['detail.playLabel', 'match first(e.detail) { case some(d) => (d.resumeSeconds > 0 ? t("ui.resumePositionIn", position=d.resumePosition) : t("ui.play")), case none => "" }'],
  ['detail.hasResume', `match first(e.detail) { case some(d) => ${yes('d.canPlay and d.resumeSeconds > 0')}, case none => "false" }`],
  ['detail.resumePct', `match first(e.detail) { case some(d) => ${m('d.title', 'pct(d.resumeSeconds, x.durationSeconds)')}, case none => "0" }`],
  ['detail.hasSeasons', `match first(e.detail) { case some(d) => ${yes('d.seasons.length > 1')}, case none => "false" }`],
  ['detail.hasEpisodes', `match first(e.detail) { case some(d) => ${yes('d.episodes.length > 0')}, case none => "false" }`],
  ['detail.hasCast', `match first(e.detail) { case some(d) => ${yes('d.castPeople.length > 0')}, case none => "false" }`],
  ['detail.crewLine', 'match first(e.detail) { case some(d) => d.crew.join(" · "), case none => "" }'],
  ['detail.hasExtras', `match first(e.detail) { case some(d) => ${yes('d.extras.length > 0')}, case none => "false" }`],
  ['detail.hasMediaFacts', `match first(e.detail) { case some(d) => ${yes('d.mediaFacts.length > 0')}, case none => "false" }`],
  ['detail.hasRelated', `match first(e.detail) { case some(d) => ${yes('d.related.length > 0')}, case none => "false" }`],
  ['detail.selectedSeason', 'e.season'],
  ['season.on', m('c.card', yes('x.id == e.season'))], ['season.pick', m('c.card', '`${x.id}|season|`')],
  ['episode.numberTitle', m('c.card', '(x.episodeNumber > 0 ? t("ui.numberTitle", number=x.episodeNumberLabel, title=x.name) : x.name)')],
  ['episode.upNextLabel', m('c.card', '(x.progressSeconds > 0 ? t("ui.continueWatching") : t("ui.upNext"))')],
  ['episode.playLabel', m('c.card', '(x.progressSeconds > 0 ? t("ui.resumeEpisode") : t("ui.playEpisode"))')],
  ['extra.id', m('c.extra', 'x.id')], ['extra.name', m('c.extra', 'x.name')], ['extra.kind', m('c.extra', 'x.kind')], ['extra.ready', m('c.extra', yes('x.ready'))],
  ['person.name', m('c.person', 'x.name')], ['person.role', m('c.person', 'x.role')], ['person.portrait', m('c.person', 'x.portrait')],
  ['person.initials', m('c.person', 'x.name.split(" ").slice(0, 2).map(w => w.slice(0, 1)).join("").toUpperCase()')],
  ['fact.text', 'match first(c.fact) { case some(x) => x, case none => "" }'],
  // Live home (`live.home`): a channel, the monitor (the tile and the channel on it), the lineup.
  ...['id', 'number', 'name', 'logo', 'group', 'now', 'next', 'nowRemaining', 'nextLabel', 'nowArt', 'nowEpisode', 'nowGenre'].map(f => [`ch.${f}`, m('c.ch', `x.${f}`)] as [string, string]),
  ['ch.favorite', m('c.ch', yes('x.favorite'))], ['ch.nowProgress', m('c.ch', 'x.nowProgress.toString()')], ['ch.tuned', m('c.ch', yes('x.id == e.tunedId'))],
  ...['id', 'name', 'number', 'logo', 'now', 'next', 'nowRemaining', 'nextLabel', 'nowArt', 'nowEpisode', 'nowGenre'].map(f => [`tile.${f === 'id' || f === 'name' || f === 'number' ? `channel${f[0].toUpperCase()}${f.slice(1)}` : f}`, m('e.tuned', `x.${f}`)] as [string, string]),
  ['tile.nowProgress', m('e.tuned', 'x.nowProgress.toString()')], ['tile.state', m('e.tile', 'x.state')], ['tile.muted', m('e.tile', yes('x.muted'))], ['tile.zapping', 'e.zapping'],
  ['env.clock', m('e.guide', 'x.nowLabel')], ['env.liveReady', m('e.guide', yes('x.channels.length > 0'))], ['env.channelCount', m('e.guide', 'x.channels.length.toString()')], ['env.favoriteCount', 'e.favoriteCount.toString()'],
];

function core(): string {
  // Every vocabulary value of a context, once per node (a derive), in VOCAB order:
  // inlining a resolver at each template site multiplied the bundle (4,752 copies).
  const binds = vocabulary.map(([, expr]) => expr).join(', ');
  return `// Generated by tools/renderer.ts: do not edit. The skin document renderer (docs/skin-schema.md).
use Card, FeedRow, HomeModel, HeroAction, LibraryNav, DetailModel, ExtraModel, CastPerson, cardName from "../foundation/models.contract"
use GuideModel, GuideChannel, LiveTile from "../live/models.contract"

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

// A node's styles (indices into the document's table) in one state: base, hover, focus,
// group hover, group focus, disabled, and the reduced-motion overlays (*2).
shape StateRef
  cond: Cond[]
  s: number
  hs: number
  fs: number
  gs: number
  gfs: number
  ds: number
  hs2: number
  fs2: number
  gs2: number
  gfs2: number

// Where a node is drawn: the records repeat nodes stepped into, and the item's index.
shape Ctx
  hot: bool
  fhot: bool
  card: Card[]
  row: FeedRow[]
  hero: Card[]
  heroAct: HeroAction[]
  dest: LibraryNav[]
  extra: ExtraModel[]
  person: CastPerson[]
  fact: string[]
  ch: GuideChannel[]
  index: number

// What every node may read: the slot's models, the viewport class and the skin's flags.
shape Env
  styles: Style[]
  dflt: Style
  route: string
  entry: string
  load: string
  home: HomeModel[]
  detail: DetailModel[]
  season: string
  libraries: LibraryNav[]
  viewer: string
  section: string
  query: string
  heroIndex: number
  small: bool
  tv: bool
  width: number
  skinCount: number
  rowLoading: string[]
  homeLoading: bool
  still: bool
  canLive: bool
  flags: string[]
  // A live home: the listings, the tile, the channel on the monitor (the one being dialled
  // while flicking), its id, the dialled number and the favourites count, each bound once.
  guide: GuideModel[]
  tile: LiveTile[]
  tuned: GuideChannel[]
  tunedId: string
  zapping: string
  favoriteCount: number

${Array.from({ length: DEPTH }, (_, i) => shape(DEPTH - i)).join('\n')}
// One slot's tree: its root container's style, its top-level nodes, and the flex
// order of the foundation's content among them (the route a shell wraps, the
// search field a home holds), so the renderer is inlined at one call site per slot.
shape DocSlot
  present: bool
  root: number
  rootPos: number
  slotStyle: number
  slotPos: number
  slotInner: number
  slotOrder: string
  nodes: N1[]

shape ShellSlot
  present: bool
  root: number
  rootPos: number
  slotStyle: number
  slotPos: number
  slotInner: number
  slotOrder: string
  nodes: N${SHELL_FROM}[]

// What the foundation hands the route view: the stack entry's route and its models.
shape RouteProps
  route: string
  entry: string
  load: string
  detail: DetailModel[]
  season: string
  small: bool
  tv: bool
  width: number
  still: bool

// A route's tree (the route view draws the one named after the current stack entry).
shape RouteTree
  name: string
  root: number
  rootPos: number
  slotStyle: number
  slotPos: number
  slotInner: number
  slotOrder: string
  nodes: N1[]

// A skin document as the renderer takes it (src/skin resolves it for one viewport class).
shape SkinDoc
  id: string
  fontsJson: string
  keyframesCss: string
  styles: Style[]
  shell: ShellSlot
  home: DocSlot
  routes: RouteTree[]
  liveHome: bool
  detailWide: string
  detailSmall: string
  detailFrom: number
  detailSplit: string

${Object.entries(KEYFRAMES).map(([k, v]) => `keyframes vr-${k}\n  ${v}\n`).join('\n')}
fn noStyle(): Style = ${noStyleBody()}
// The document's distinct styles, shared by index (nodes name theirs by position).
fn styleAt(e: Env, i: number): Style = match e.styles.at(i) { case some(s) => s, case none => e.dflt }
fn pct(at: number, of: number): string = (of > 0 ? min(100, at / of * 100).toString() : "0")
fn binds(c: Ctx, e: Env): string[] = [${binds}]
fn pick(vals: string[], i: number): string = match vals.at(i) { case some(v) => v, case none => "" }
fn flagged(e: Env, f: string): string = (e.flags.includes(f) ? "true" : "false")
fn fill(parts: Part[], vals: string[], e: Env): string = parts.map(p => (p.f != "" ? flagged(e, p.f) : p.k < 0 ? p.l : pick(vals, p.k))).join("")
fn num(s: string): number = match parseNumber(s) { case some(x) => x, case none => 0 }
fn subject(k: Cond, vals: string[], e: Env): string = (k.f != "" ? flagged(e, k.f) : pick(vals, k.k))
fn holds(k: Cond, vals: string[], e: Env): bool = (k.is == "eq" ? subject(k, vals, e) == k.v : k.is == "ne" ? subject(k, vals, e) != k.v : k.is == "gt" ? num(subject(k, vals, e)) > num(k.v) : k.is == "lt" ? num(subject(k, vals, e)) < num(k.v) : k.is == "mod" ? num(subject(k, vals, e)) % num(k.v.split(":").slice(0, 1).join("")) == num(k.v.split(":").slice(1, 2).join("")) : not ["", "false", "0"].includes(subject(k, vals, e)))
fn shows(conds: Cond[], vals: string[], e: Env): bool = not conds.map(k => holds(k, vals, e) == k.not).includes(true)
// The first state whose conditions hold, else the node's own.
fn stateOf(sts: StateRef[], base: StateRef, vals: string[], e: Env): StateRef = match first(sts.filter(x => shows(x.cond, vals, e))) { case some(x) => x, case none => base }
fn ariaOpt(conds: Cond[], vals: string[], e: Env): option<bool> = (conds.length == 0 ? none : some(shows(conds, vals, e)))
fn aria(conds: Cond[], vals: string[], e: Env): string = (conds.length == 0 ? "" : shows(conds, vals, e) ? "true" : "false")
fn motion(mk: string, md: number, mdl: number, me: string, mf: string, mit: string, mdir: string, msk: string, msd: number, step: number, cap: number, i: number, e: Env): string = (e.still ? (msk == "" ? "none" : \`\${msk} \${msd}ms linear both\`) : \`\${mk} \${md}ms \${me} \${mdl + min(i, cap) * step}ms \${mit} \${mdir} \${mf}\`)
// The season a title page shows: the visit's pick, else its episodes' season, else the season page itself.
fn selectedSeason(detail: DetailModel[], picked: string): string = (picked != "" ? picked : match first(detail) { case some(d) => match first(d.episodes) { case some(x) => x.seasonId, case none => d.title.filter(t => t.kind == "season").map(t => t.id).join("") }, case none => "" })
fn heroActFor(home: HomeModel, id: string): HeroAction[] = home.heroActions.filter(a => a.heroId == id).slice(0, 1)
// The live home's lineup in the guide's order, or its favourites alone (a subset, never a reorder).
fn liveCtxs(rep: string, lim: number, c: Ctx, e: Env): Ctx[] = match first(e.guide) { case some(g) => (rep == "live.favorites" ? g.channels.filter(x => x.favorite) : g.channels).slice(0, lim).map(x => Ctx(c, ch=[x])), case none => [] }
fn rootCtx(): Ctx = Ctx(hot=false, fhot=false, card=[], row=[], hero=[], heroAct=[], dest=[], extra=[], person=[], fact=[], ch=[], index=0)
fn ctxKey(c: Ctx, j: number): string = \`\${j}:\${c.card.map(x => x.id).join("")}:\${c.row.map(x => x.id).join("")}:\${c.hero.map(x => x.id).join("")}:\${c.dest.map(x => x.id).join("")}:\${c.ch.map(x => x.id).join("")}\`
${Array.from({ length: DEPTH }, (_, i) => i + 1).map(d => `fn detailCtxs${d}(n: N${d}, c: Ctx, e: Env): Ctx[] = ${detailCtxsBody}\nfn ctxs${d}(n: N${d}, c: Ctx, e: Env): Ctx[] = ${ctxsBody(d)}`).join('\n')}
`;
}
// The detail collections, split out to keep expressions within Exact's depth limit.
const detailCtxsBody = `match first(e.detail) { case some(d) => (n.rep == "detail.seasons" ? d.seasons.slice(0, n.lim).map(x => Ctx(c, card=[x])) : n.rep == "detail.episodes" ? d.episodes.slice(0, n.lim).map(x => Ctx(c, card=[x])) : n.rep == "detail.upNext" ? d.episodes.filter(x => not x.played).slice(0, 1).map(x => Ctx(c, card=[x])) : n.rep == "detail.extras" ? d.extras.slice(0, n.lim).map(x => Ctx(c, extra=[x])) : n.rep == "detail.cast" ? d.castPeople.slice(0, n.lim).map(x => Ctx(c, person=[x])) : n.rep == "detail.mediaFacts" ? d.mediaFacts.slice(0, n.lim).map(x => Ctx(c, fact=[x])) : n.rep == "detail.related" ? d.related.slice(0, n.lim).map(r => Ctx(c, row=[r])) : n.rep == "detail.genres" ? match first(d.title) { case some(t) => t.genres.slice(0, n.lim).map(g => Ctx(c, fact=[g])), case none => [] } : n.rep == "detail.trailers" ? d.extras.filter(x => x.kind == "trailer" and x.ready).slice(0, n.lim).map(x => Ctx(c, extra=[x])) : n.rep == "detail.crew" ? d.crewPeople.slice(0, n.lim).map(x => Ctx(c, person=[x])) : []), case none => [] }`;
const ctxsBody = (d: number) => `(n.rep == "" ? [c] : n.rep == "home.rows" ? match first(e.home) { case some(h) => h.rows.slice(0, n.lim).map(r => Ctx(c, row=[r])), case none => [] } : n.rep == "row.items" ? match first(c.row) { case some(r) => r.items.slice(0, n.lim).map(x => Ctx(c, card=[x])), case none => [] } : n.rep == "home.heroes" ? match first(e.home) { case some(h) => h.hero.slice(0, n.lim).map(x => Ctx(c, hero=[x], heroAct=heroActFor(h, x.id))), case none => [] } : n.rep == "home.hero" ? match first(e.home) { case some(h) => h.hero.slice(e.heroIndex, e.heroIndex + 1).map(x => Ctx(c, hero=[x], heroAct=heroActFor(h, x.id))), case none => [] } : n.rep == "nav.destinations" ? e.libraries.slice(0, n.lim).map(l => Ctx(c, dest=[l])) : n.rep == "hero.genres" ? match first(c.hero) { case some(h) => h.genres.slice(0, n.lim).map(g => Ctx(c, fact=[g])), case none => [] } : n.rep.startsWith("detail.") ? detailCtxs${d}(n, c, e) : n.rep.startsWith("live.") ? liveCtxs(n.rep, n.lim, c, e) : [])`;

const noStyleBody = () => `Style(${STYLE.map(([f]) => `${f}=${NUMERIC.has(f) ? ({ opacity: 1, flexShrink: 1, fontWeight: 400, scale: 1 } as Record<string, number>)[f] ?? 0 : '""'}`).join(', ')})`;
const EMPTY_DOC = `fn emptyDoc(): SkinDoc = SkinDoc(id="", fontsJson="", keyframesCss="", styles=[], shell=ShellSlot(present=false, root=0, rootPos=0, slotStyle=0, slotPos=0, slotInner=0, slotOrder="0", nodes=[]), home=DocSlot(present=false, root=0, rootPos=0, slotStyle=0, slotPos=0, slotInner=0, slotOrder="0", nodes=[]), routes=[], liveHome=false, detailWide="fullscreen", detailSmall="fullscreen", detailFrom=640, detailSplit="none")\n`;

/**
 * The renderer's compatibility version: a document names the version it needs
 * (`renderer`), and a client draws it only when its own version is at least that.
 * Additions to the tables (vocabulary, style rows, keyframes) bump it: the digest of
 * the tables is kept in client/renderer/version.json, and generation refuses a
 * changed table without `--bump`. A breaking change is a new document `schema`.
 */
async function rendererVersion(out: string, bump: boolean): Promise<{ version: number; digest: string }> {
  const digest = createHash('sha256').update(JSON.stringify({ vocabulary: vocabulary.map(([k]) => k), style: STYLE, keyframes: Object.keys(KEYFRAMES) })).digest('hex').slice(0, 16);
  const path = join(out, 'version.json');
  const known = JSON.parse(await readFile(path, 'utf8').catch(() => '{"version":0,"digest":""}')) as { version: number; digest: string };
  if (known.digest === digest) return known;
  if (!bump && known.version > 0) throw new Error(`The renderer's tables changed (${known.digest} -> ${digest}): run with --bump to publish renderer version ${known.version + 1}`);
  const next = { version: known.version + 1, digest };
  await writeFile(path, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export async function generate(out = resolve(import.meta.dir, '../client/renderer'), bump = process.argv.includes('--bump')) {
  // Player plumbing (plans, commands, media credentials) is foundation-only: no document may bind it.
  const leak = vocabulary.find(([, expr]) => /mediaAuth|planJson|commandJson|headers/.test(expr));
  if (leak) throw new Error(`Vocabulary ${leak[0]} reads player plumbing`);
  const renderer = await rendererVersion(out, bump);
  await writeFile(resolve(import.meta.dir, '../client/src/skin/vocabulary.ts'), `// Generated by tools/renderer.ts: the binding vocabulary in the renderer's order, and the renderer's compatibility version.\nexport const RENDERER_VERSION = ${renderer.version};\nexport const RENDERER_DIGEST = ${JSON.stringify(renderer.digest)};\nexport const VOCAB: string[] = ${JSON.stringify(vocabulary.map(([key]) => key))};\n`);
  let levels = '';
  for (let d = 1; d <= DEPTH; d++) levels += level(d) + '\n';
  // Shapes (and the empty document) live apart from the renderer: the foundation imports
  // them in every engine, while the components, functions and vr-* keyframes compile
  // only into the doc engine (Exact embeds every keyframe name in each animated row).
  const all = core();
  const cut = all.indexOf('keyframes vr-');
  const header = all.slice(0, all.indexOf('\nshape Style'));
  const shapes = all.slice(0, cut) + `fn noStyle(): Style = ${noStyleBody()}\n` + EMPTY_DOC;
  await writeFile(join(out, 'shapes.contract'), shapes.replace('do not edit. The skin document renderer', 'do not edit. The skin document shapes'));
  const shapeNames = [...shapes.matchAll(/^(?:shape|fn) (\w+)/gm)].map(m => m[1]);
  const body = all.slice(cut).replace(/^fn noStyle\(\): Style = [^\n]*\n/m, '');
  await writeFile(join(out, 'levels.contract'), `${header}\nuse ${shapeNames.join(', ')} from "./shapes.contract"\n\n${body}\n${elements()}\n${levels}`);
}
if (import.meta.main) await generate();
