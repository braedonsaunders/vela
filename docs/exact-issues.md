# Exact issues found by Vela

One entry per Exact-side problem Vela hit, with a minimal repro, what it cost us, how Vela works
around it, and a proposed fix in Exact's terms. Nothing here goes upstream (no issue, no PR)
until the owner approves it and the fix is tested end to end. Each entry is also recorded with
`bun exact.mjs feedback note`.

Exact is pinned at `vendor/exact` (`EXACT_REVISION`). The repros are the measured cases cut down;
each is to be run as a standalone app before anything goes upstream. Measurements are on an M4 Pro, Chrome,
1440×900, the doc engine's development profile (`bun tools/check.ts doc --serve`), unless noted.

## 1. Every commit walks the whole document, so its cost grows with comment anchors

**What.** After every commit, the modes pass (`host/web-js/modes.js` `apply()`) does two things:
- it calls `document.getElementsByClassName(c)` for each of the app's token classes (`Vars`),
  about 254 in Vela;
- it calls `querySelectorAll('[data-x-b]')`.

Any DOM mutation in the commit invalidates those live collections, so each call walks the whole
document. The walk visits every node, including the comment anchors that Exact's control flow
leaves (issue 7). A large or region-heavy view therefore pays a full-document walk per commit,
roughly 255 times over, even when nothing colour-related changed.

**Repro.** Use any app with a theme axis and about 10,000 DOM nodes (for example, a list of 2,000
rows each under three `if`s), plus a button that increments an unrelated state. Time
`apply()` per press, or measure it directly:

```js
// in the page: one mutation, then the pass's lookups
const t0 = performance.now();
document.body.appendChild(document.createElement('div')).remove();
for (let i = 0; i < 254; i++) for (const e of document.getElementsByClassName('c' + i));
document.querySelectorAll('[data-x-b]');
performance.now() - t0;
```

**Impact.** Measured per commit, Chrome, M4 Pro, release builds:
- Vela's doc engine: 1,416 elements and 48,820 comments, 50.2 ms.
- Compiled Cinematic: 1,050 elements and 1,358 comments, 2.2 ms.

Both builds commit equally often while scrolling (607 and 743 microtask commits for the same
scroll), driven by intersections and image-loading policy. So scrolling ran at 44 fps with
200–450 ms long tasks against 107 fps. This hurts any large Exact app, not only Vela.

**Workaround (Vela).** The renderer was rewritten to open almost no regions per node:
- The parent resolves each child's context, bindings, state and visibility in one kid list.
- Each child renders exactly one element, so its loop row needs no anchors.
- Pager edges became synthetic children.
- Widgets sit in a `display: contents` box.

Comments went from 48,820 to 4,444, and the per-commit walk from 50 ms to 4.3 ms.

**Fix, on a branch (not upstream).** Branch `vela/perf-modes-presence` in
`~/.scratch/vela-build/exact-patched`, based on the pinned revision, changes `modes.js` only:
- A MutationObserver's records, taken at each pass, give the elements added and those whose `class` or `data-x-b`
  changed. The class fix-up and the boundary set look only at those.
- The first pass and a page rendered ahead keep the whole-document path.

Results:
- Compiled Cinematic is pixel-identical, and the related web-js tests pass.
- On Vela's current doc engine, where the walk is already ~7 ms after the anchor cut, scroll script falls
  1.71/1.64 s → 1.55/1.50 s and scroll goes 80/83 → 84/88 fps.
- On a page as the doc engine was before (50 ms per walk), this pass is most of the commit cost.
- The PR text is in `~/.scratch/vela-build/exact-pr-modes.md` and waits for the owner's go.

**Proposed fix (as first written).**
- Track which elements gained or lost a token class or `data-x-b` from the commit's own
  mutations (the runtime already observes them for presence), and touch only those.
- Or keep a registry: elements register when their class or boundary row is written, so no
  document query is needed.
- At minimum, skip the class loop when the commit created no elements.

## 2. The modes pass walks every colour boundary after every commit

**What.** An element that binds `color-scheme` (or `-exact-mode`) is a colour boundary
(`data-x-b`, `host/web-js/src/modes.rs`). After every commit `modes.js` `apply()` runs
`querySelectorAll('[data-x-b]')`. For each boundary, for each of 7 colour channels, it walks
the ancestors and their class lists (`channel()`). The cost is
boundaries × 7 × depth per commit, whether or not anything colour-related changed.

**Repro.**

```contract
component Row
  props
    i: number
  view
    box color-scheme=(i % 2 == 0 ? "dark" : "dark") padding=4
      text `${i}`

component App
  state n = 0
  view
    column
      button "tick" press=tick testId="tick"
      for i in range(0, 1500) key=`${i}`
        Row(i=i)
  action tick
    n = n + 1
```

Every press of `tick` walks 1,500 boundaries, although `n` is read nowhere.

**Impact.** The renderer's box bound `color-scheme` on every node, so 1,088 boundaries were on
home against 2 for compiled Cinematic. In the scroll profile, `apply`/`channel` plus
`querySelectorAll` were the top JS self-time: about 1.8 s of 5.9 s of script.

**Workaround (Vela).** Only a tree's root binds `color-scheme` (`RootEl`), and the resolver refuses
it on any other node. That brings home down to 7 boundaries.

**Proposed fix.**
- Run the pass only for boundaries whose own rows, pins or ancestors' colour rows changed in this
  commit: the commit already knows which bindings wrote.
- Or memoise `channel()` per element per commit.
- Either way, skip the pass entirely when no colour-reading row and no boundary changed.

## 3. Actions receive every prop and inject of their component, deep-checked on every call

**What.** Inlining closure-converts a component's props and injects into hidden action parameters
(`contract/syntax/src/inline/use_node.rs`, `@capture:…`). It does this for every non-action prop
and inject, whether or not the action reads it. On the web each call type-checks every argument
deeply (`rt.js` `act` → `shape.js` `conforms`, with no previous value to skip unchanged parts). A
hover handler that only sets `over = v` therefore re-checks the component's whole data.

**Repro.**

```contract
shape Item
  id: string
  tags: string[]

component Card
  props
    items: Item[]
  state over = false
  action hovering(v: bool)
    over = v
  view
    box hover=hovering padding=8
      text (over ? "over" : "out")

component App
  state items: Item[] = []
  view
    Card(items=items)
```

With 10,000 items in `items`, every pointer enter or leave on the card checks all 10,000 records.

**Impact.** Renderer levels carried the node subtree (type string about 4.3 KB), the context, and
the full environment (the style table plus the home model). Each hover, pointer, key, image-load
and intersection event re-checked them all. The route view's actions re-checked every model on
the page per card impression. Shape checks alone were about 0.8 s per scroll run (`conforms` +
`skip`), on top of the commits those events caused.

**Workaround (Vela).** Renderer components declare no actions that read their props:
- Events go to app-level actions (`client/skins/doc/members.contract`) with a few string arguments.
- Hover, press and group hover are CSS rules the resolver writes (`statesCss`).
- A fading image keeps its load state in a leaf component whose props are strings.

**Proposed fix.**
- Capture only the props and injects the action body reads; the inliner already walks the body
  for called action props.
- Skip the conformance check for compiler-supplied hidden arguments: they are typed by
  construction, and `emit.rs` already marks them, since their numbers need not be finite.

## 4. Presence probes run for every element that binds an exit or layout transition

**What.** An element with a bound `-exact-exit-animation` or `-exact-layout-transition` registers
a presence probe (`presence-bindings.js` `px`/`lt`). Before every commit, `captureExits()` and
`gains()` evaluate every probe in a fresh scope and read `getPropertyValue`. This happens even
when the bound value is empty and has never changed.

**Repro.** 1,000 boxes with `-exact-layout-transition=(flag ? "200ms ease" : "")`, `flag` false,
and a button that increments an unrelated state: each press runs 2,000 probe evaluations.

**Impact.** `dc.$presence`, `getPropertyValue` and the probe scopes cost about 0.6 s per scroll
run, and they allocate on every commit. Still open: Vela cannot avoid these probes without the per-call-site code doubling of issue 6.

**Fix, on the same branch (not upstream), commit 1bf8223ce.** `tree.js` `S` tells the probes its
effect and whether its last write was empty. A probe is skipped when three things hold:
- that effect is clean;
- the last write was empty;
- no region around the element took a new value for this commit. A first version checked only the effect, and
  failed 12 of 28 `layout-transition` tests: `present()` writes a moved row's item or index, or an arm's value,
  without staling effects. This version tracks those writes.

All related web-js tests pass. On top of the modes fix, Vela's scroll script falls 1.55/1.50 s → 1.34/1.22 s,
scroll goes 84/88 → 90/94 fps, and the longest task 123/119 → 92/91 ms. The PR text is in
`~/.scratch/vela-build/exact-pr-presence.md`. Vela meanwhile binds motion only on route levels 1-6 and in the
shell (MOTION_DEPTH).

**Proposed fix.**
- Register a probe only while its binding's value is non-empty: an empty value cannot animate.
- Re-evaluate a probe only when its binding's dependencies changed.

## 5. A `sharedElement` binding wraps every commit in a view transition

**What.** An element with a bound `sharedElement`, even an empty one, makes every commit run inside
`document.startViewTransition`. The transition's overlay on `<html>` takes pointer events while it
runs, so clicks during a commit land on `<html>`.

**Repro.**

```contract
component App
  state n = 0
  view
    column
      box sharedElement=(n < 0 ? "x" : "") width=10 height=10
      button "inc" press=inc testId="inc"
  action inc
    n = n + 1
```

Press `inc` repeatedly: some presses are lost while a transition is running.

**Impact.** Under the doc engine, clicks were intermittently lost (fixed in b45a8fe).

**Workaround (Vela).** The renderer binds no `sharedElement`. `client/player/theme.ts` injects
`::view-transition { pointer-events: none }`.

**Proposed fix.**
- Start a view transition only when a commit changes which element holds a shared name.
- Make the transition overlay pass pointer events through, as the platform's default for
  same-document transitions allows.

## 6. Per-call-site inlining multiplies code, and `children` is inlined at every occurrence

**What.** A component is inlined at each use (`inline.rs`), and a slot's `children` is inlined
afresh at each `children` node. So a component that chooses between two wrappers of its
children (`if a` → box A + children, `else` → box B + children) doubles the children's code.
Inside a recursive-by-levels renderer that doubling compounds: 2^depth.

**Repro.**

```contract
component Wrap
  props
    mo: bool
  slot
  view
    if mo
      box padding=4
        children
    else
      box padding=8
        children
```

Nest `Wrap` six deep; the plan grows 2^6.

**Impact.**
- The renderer cannot switch its element per node (for example, a variant without presence
  bindings, issue 3).
- Every level is a full copy of the element, about 38 KB of development JS per level.
- An earlier pager design duplicated child loops and its lowering exploded.

**Workaround (Vela).** One element per level. Variant behaviour is pushed into data (bound values)
or into separate components used only at roots.

**Proposed fix.** Lower a `children` fill once per use, as a function, and call it from each
`children` site, which is how a fill would behave as a closure. Only one arm renders at a time,
so the instances can share their code.

## 7. Control-flow regions cost DOM comment anchors even with one row

**What.** Every `if` emits two comment anchors. Every `for` emits two, plus two per row whose
content is not a single element. A one-element `for x in [expr]` is the only way to bind a value
once in a view (props and derives are substituted at each use), so a value-heavy view pays about
4 comments per bound value.

**Impact.** 52,322 comment nodes on doc home against 1,358 for compiled, which made every commit's
document walk (issue 1) 20× slower. They cost DOM memory, and
make insertion slower and region bookkeeping heavier.

**Workaround (Vela).** The renderer's levels open almost no regions: the parent resolves a child's
values in one kid list and the child renders one element (issue 1), 4,444 comments on home.

**Proposed fix.**
- A view-level `let name = expr` (a memo with no region).
- Or no anchors for a `for` over a literal one-element list.

## 8. The contract build's type check uses the debug compiler

**What.** `bun exact.mjs contract build app.contract` type-checks `app.ts` with the debug
`exact-web-js` unless `EXACT_WEB_COMPILER` names the optimised one. On the doc engine the debug
compiler is about 10× slower, past the build's 10-minute bound.

**Workaround (Vela).** `tools/check.ts` sets `EXACT_WEB_COMPILER` to
`vendor/exact/target/host-dev/exact-web-js` when it exists.

**Proposed fix.** Use the optimised compiler for checks by default, or build it on first use as
`contract build` builds the compiler itself.

## 9. Secret store keys must be lowercase and need a grant

**What.** `secret.keep` refuses keys outside `[a-z0-9._-]`, and the app needs a `secret.keep`
grant. Neither is stated where the store is introduced. A camelCase key fails at run time.

**Impact.** The cold-start skin-document cache broke document loading until the key became
`vela.skin-doc` and the grant was added (Index's fix).

**Proposed fix.**
- Refuse a non-conforming literal key at compile time, naming the rule.
- Document the grant beside the call.

## 10. `border-radius` with `var()` or `calc()` is dropped

**What.** A bound `border-radius` whose value is `var(--…)` or `calc(…)` is dropped (the row is
written as unset) rather than passed through.

**Impact.** Documents cannot use theme radii or computed radii. The resolver resolves radii to
literals, and corner tokens are unavailable.

**Proposed fix.** Pass `var()`/`calc()` through for `border-radius`, as Exact does for colours,
or refuse them at the binding with a diagnostic.

## 11. `secret.keep` is the only store the data module can write

**What.** A data module (`app.ts`) can persist only through the secret store. There is no plain
key-value store for non-secret data, such as a cached skin document.

**Impact.** Vela keeps the last skin document (non-secret, up to 512 KiB) in the secret store.

**Proposed fix.** A data-module key-value store with the same grant model and no secrecy
semantics.

## 12. A foundation action named like a host command cannot be called from another action

**What.** An action named `close` or `observe` (both host commands) is callable from handlers,
but a call `close()` inside another action is refused as ambiguous (`syntax-call-ambiguous`).
The fix the diagnostic offers (rename the action) is not available to code that does not own it.

**Workaround (Vela).** `members.contract` inlines the two bodies (`nav = back(nav)`, the
impression receipt).

**Proposed fix.** Allow a qualified call (`Client.close()`), or resolve a call inside an action
to the app's own action and reach the host command through a namespace.

## 13. Tamber token references are rewritten only in literal rows

**What.** Contract rewrites a token reference such as `var(--media.ground)` to the page's
property (`var(--x-media-ground)`) or to the folded value, but only in view literals. A value
computed at run time and bound to a row reaches CSS as written. The dotted name is then an invalid
custom property, and the declaration silently computes to its initial value.

**Repro.**

```contract
component App
  state shadow = "0 0 0 3px var(--media.ground)"
  view
    box box-shadow=shadow width=40 height=40
```

The computed `box-shadow` is `none`. Written as a literal, the same value draws.

**Impact.** Compiled Cinematic and Mochi never drew their framed title's shadow, because
`skinTraits(...).detailShadow` is runtime data. The doc resolver had already worked around the
same problem for documents.

**Workaround (Vela).** The skin registry maps `var(--a.b)` in trait values to `--x-a-b` or the
folded value (7c4971a). The doc resolver does the same for document values (`cssVar`).

**Proposed fix.** Rewrite token references in bound values at run time, as the colour rows
already resolve a bare token name. Or refuse a dotted `var()` name in a bound value with a
diagnostic.
