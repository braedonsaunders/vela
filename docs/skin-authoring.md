# Authoring a Vela skin

A skin is a compiled collection of Exact Contract components. It changes layout,
typography, imagery, geometry and motion. It receives data and callbacks from Vela's
foundation; it is not a JavaScript extension running in the authenticated origin.

Start with [the small example](../client/skins/example/slots.contract). It uses plain
lists and the same real callbacks as Cinematic and Index. Its guide, live status and
player compose Index's implementations, demonstrating safe reuse without copying an
engine. The example is compiled in the normal application build, but appears in the
picker only if the server advertises the installed `example` skin ID.

## Boundaries

A skin may hold presentation state: a hover, expanded panel, open settings, or the
currently focused control. It may use semantic native controls and foundation-supplied
artwork URLs. It must respect `small`, `viewport` and `still` to recompose for narrow
screens, keyboard use and reduced motion.

A skin must not declare resources, mutations, timers, credentials or network access.
Do not add JavaScript, inspect browser storage, resolve media, infer permissions, select
playback paths or call the engine directly. Do not filter, sort or re-rank server rows,
change item identities, or report a preload as a view. Foundation owns authentication,
search generations, routing, playback state and recommendation attribution.

Selection is `selectTitle(id, kind, receipt)`. Preserve all three arguments: a season
is not its show, an episode is not its season, and channels and collections have their
own routes. Play uses the exact title/episode ID; extras use `playExtra(extraId)`.
Disable unavailable actions rather than displaying a feature that cannot work.

Attach `intersect=observe(card.receipt)` to the actual card with no overscan. Forward
Exact's intersection entry unchanged. Never call observe from rendering, mount or
prefetch code. Foundation checks route and page visibility, positive intersection and
deduplication. Empty receipts mean the server supplied no reportable attribution.

## Layout

```text
client/skins/my-skin/
  slots.contract      # Shell, Home, SearchField, SearchSurface, Row, TitleCard, Detail
  player.contract     # PlayerChrome, if not composed from another skin
  guide.contract      # Guide
  live.contract       # LiveControls
client/foundation/
  models.contract     # shared discovery/detail records and accessible labels
  player-models.contract
  skin.contract       # explicit compile-time dispatch, never requests
client/strings/en.json # English copy, including accessibility labels
client/app.tamber     # shared and namespaced appearance tokens
```

All props are required; Exact action props are declared `action`, with argument types
inferred from their calls. The definitive declarations and wiring are in
[foundation/skin.contract](../client/foundation/skin.contract). Keep a replacement's
names and prop types identical. No route state belongs in a skin.

| Slot | Inputs and content |
| --- | --- |
| Shell | viewer, skin, installed skins, viewport; canLive/canLibrary; chooseSkin/signOut/home/search/live/library actions; one children slot |
| Home | HomeModel, active, query, small, still, selectTitle, observe; one children slot for SearchField |
| SearchField | query and edit(string) |
| SearchSurface | fast, descriptive and AI SearchModel values; query, generation, loading/error, aiAvailable, small/still, selectTitle and observe |
| Row | FeedRow, small/still, selectTitle and observe |
| TitleCard | Card, small/still, selectTitle and observe; normally composed by the skin's own Row |
| Detail | DetailModel, small/still, play, playExtra, selectTitle and observe |
| PlayerChrome | PlayerView, title, visible, small/still, busy, serverError; command(kind,value), seek(seconds), editing(bool), close |
| Guide | GuideModel, small; watch(channelId), previous and next |
| LiveControls | lowDelay, reconnecting, delivery, drift, driftLabel, canCatchUp; toggleLowDelay and catchUp |

`HomeModel.rows` and each row's `items` are already ordered. Optional hero/detail
records use zero-or-one arrays. Blank image URLs and zero optional numeric metadata
mean absent; do not manufacture content. Cards include structured metadata and
locale-formatted labels as well as the compact facts string. Server title names,
people, genres and descriptions remain server content.

Only display a search lane when its query and generation match the current request.
An AI lane is independent: it must never block fast matches or show another query's
results. Related recommendations load independently of title details; a slow or
failed related request cannot hide metadata or playback actions.

A skin exports `detailPresentation(width)` (`fullscreen`, `modal` or empty) and
`detailSplit(width)` (`none` or a split list width). Foundation binds them to Exact
navigation attributes and retains stack entries. Preserve navigation keys, semantic
focusable controls and accessible names so Back restores browsing state and focus.
Cinematic's frame is an artwork overlay; Index uses a split pane on wide screens.

## A minimal card

This is the card pattern used by the example. The selection, attribution and
accessibility meaning stay the same if its visual layout changes completely.

```contract
use Card, cardName from "../../foundation/models.contract"

component TitleCard
  props
    card: Card
    small: bool
    still: bool
    selectTitle: action
    observe: action
  view
    row intersect=observe(card.receipt) gap=12 padding=10
      button press=selectTitle(card.id, card.kind, card.receipt)
        aria-label=cardName(card) flex=1
        text card.name
      text card.facts
```

The complete example supplies the other slots, loading/error states, asynchronous
lanes, exact-ID actions and the registered presentation functions. It intentionally
adds no animation or artwork effects; it is a functional starting point, not a mock.

## Appearance manifest

Every skin supplies a manifest so the shared appearance picker
(`foundation/skin-picker.contract`, presented by every skin's profile or settings menu)
can show it as a large preview card. Create `client/skins/<id>/manifest.contract`:

```contract
use SkinManifest from "../../foundation/models.contract"

fn manifest(): SkinManifest = SkinManifest(id="my-skin", name=t("skin.my-skin.name"), tagline=t("skin.my-skin.tagline"), preview="assets/skins/my-skin.jpg", swatches=["#101418", "#f4efe6", "#d0a46c"])
```

| Field | Meaning |
| --- | --- |
| `id` | The compiled skin id, as accepted by the foundation and advertised by the server. |
| `name` | Translated display name (the same text `skinLabel` returns for the id). |
| `tagline` | One translated line, under about 70 characters, saying what the look is. |
| `preview` | App-relative asset path of a real miniature of the skin's home: a 1440x900 capture of the home on the mock (real-looking mock art, no error overlays, reduced motion so no trailer frame), scaled to 720x450, JPEG quality ~82, saved as `client/assets/skins/<id>.jpg`. |
| `swatches` | 3 to 5 CSS colours from the skin's palette, its page ground first (the card shows the ground until the preview loads). |

Register the manifest with one branch in `skinManifest` in
`foundation/skin-picker.contract` (`use manifest as MySkinManifest from "../skins/my-skin/manifest.contract"`).
The picker lists the ids the root offers the viewer, marks the current one, and is a
radio group: arrow keys move between looks, Enter or Space chooses, Escape closes. A
skin presents it by keeping a `pickerOpen` state and rendering
`SkinPicker(skins, current, small, still, choose, dismiss)` as the last child of a
viewport-sized, `position="relative"` Shell root (it covers its positioned ancestor);
`choose` is the Shell's `chooseSkin`. The root dissolves the app into the newly chosen
skin from that skin's page ground; reduced motion shortens it to a quick fade.

## Size: assets, not components

Exact inlines a component at every place it is used. An icon or illustration
written as an `svg` component therefore copies its whole tree into the compiled
plan once per use: one skin's 30-glyph icon component used across its views
measured 32,520 plan nodes, over half of the whole app. Keep the plan small:

- Icons are assets. Use a built-in role (`image "symbol:play-fill"`) where one
  fits; otherwise save the glyph as `client/assets/icons/<skin>-<name>.svg`,
  declare it in `app.tamber`'s `icons` (`icon.<skin>-<name> = icon(svg
  "icons/<skin>-<name>.svg")`) and draw it with
  `image "symbol:icon.<skin>-<name>" width=.. height=..`: one node per use.
- Illustrations, mascots and decorative art are image assets
  (`image "assets/<skin>/<name>.svg"`), not drawn trees.
- Keep heavy components behind few call sites (for example one placeholder
  component reused by a loop, not several hand-unrolled copies).
- Measure: `bun exact.mjs contract build app.contract --map -o /tmp/app.plan`
  writes a map whose nodes name their source file and component; count nodes per
  file to see what your skin adds.

## Register and build

1. Add the Contract files under `client/skins/<id>/`. Use Tamber tokens for appearance;
   add namespaced tokens to app.tamber where a shared role does not fit.
2. Import the components and presentation functions in foundation/skin.contract with a
   distinct prefix. Add the ID branch to every relevant wrapper. Reusing an existing
   slot is supported; make that choice explicit, as the example does.
3. Add the compiled ID to foundation/behavior.contract's accepted IDs and app.contract's
   installed-picker filter. Add its translated label to skinLabel in models.contract.
   Unknown IDs fall back to Cinematic; never advertise an uncompiled package.
4. Have the server advertise the installed ID in capabilities.skins. Its bootstrap
   defaultSkinId selects the initial package; the viewer's persisted picker overrides
   that default. Do not change server ranking when switching skins.
5. If the package needs a distinct root surface palette, add its page/ink token mapping
   in foundation alongside the existing Index mapping. Keep the navigation host intact.
6. Compile once from client: `bun exact.mjs contract build app.contract --json --errors-only`.
   Use `bun tools/dev.ts` from the repository root for one desktop/mobile look. Stop the
   owned supervisor with `bun tools/dev.ts stop`. Never start a second app web loop.

Do not edit vendor/exact, add CI, test harnesses or lint configurations, or run Exact
maintainer checks. Coordinate shared root and foundation changes with the orchestrator.

## Copy and formatting

Use `t("key", name=value)` for every authored label, message, placeholder and accessible
name. English lives in strings/en.json; named placeholders contain whole formatted
values so translators can change word order and punctuation. Avoid concatenating
English sentence fragments. Machine enum values, IDs, routes and CSS are not copy.

Numbers, dates, times and durations from sources are formatted by Intl using the
user's formatLocale/timeZone. The text language is resolvedLocale, a separate concern.
Use the supplied yearLabel, progressLabel, episodeNumberLabel, resumePosition,
expiresLabel and guide time labels; keep raw numbers for seek ranges, geometry and
ARIA numeric attributes. Never hand-build AM/PM or force a regional date order.

To translate, add strings/<locale>.json. Exact discovers it; tools/locales.ts generates
the catalog registry used by source-side messages before dev and release builds.
Restart dev or run that generator after adding a file; do not edit catalogs.ts by hand.
English is the only shipped language. A language setting can call Exact's setLocale;
locale context changes refresh the presentation resources without a polling clock.

Player chrome receives the same PlayerView in every skin. Render only capabilities
actually offered; preserve subtitle-off and automatic-quality choices. Keep controls
keyboard reachable, hold editing(true) while a settings popover is open, and respect
busy during server-authorized seeks or source changes. Skins send commands; they never
choose a decoder, create sessions or fake recovery states.
