# Skin schema

The canonical schema is [packages/protocol/skin.ts](../packages/protocol/skin.ts).
It defines schema-1 JSON documents, node types, bindings, conditions, styles,
motion and asset metadata. Consult its exported types for accepted fields;
[fixtures](../packages/protocol/fixtures) provide concrete documents.

Resolution lives in `packages/skin/src/resolve` and rendering in
`packages/skin/src/render.tsx`. Web and native style support can differ; inspect
the affected document on the target platform before claiming compatibility.

See [authoring](skin-authoring.md) and [distribution](skin-distribution.md).

## Renderer 19

Renderer 19 adds plugin screen and surface documents
([plugin-screens.md](plugin-screens.md), envelope in
[packages/protocol/screen.ts](../packages/protocol/screen.ts)). They share the node
language with skins, so these additions are available to both:

- `tv` style variants beside `small` and `wide`, applied last on a TV.
- `use.with` (read as `{arg.<name>}` in the template) and `use.children` (drawn at the
  template's `{ "type": "slot", "slot": "children" }`).
- `repeat.as`, `skip`, `exclude`, `key` and `asOf`; `image.fallback`; `onChange`;
  `needs`; `press.args` and `press.optimistic`; document keyframes animating `color`
  to a `$ui` token; the `ui` colours `highlight` and `positive`.
- The blocks `sections`, `shelf`, `grid`, `tabs`, `table`, `lineGraph`, `player`,
  `paramInput`, `titleCard` and `marquee`. They read a screen's data, so in a skin
  document they draw nothing.

Screen documents resolve with `resolveScreenDocument`
(`packages/skin/src/resolve/screen.ts`). Their holes read data paths instead of the
vocabulary, with the fixed pipes; any style value may hold a hole, validated once
filled; lengths in `pt` are points on every platform (`8pt` is 8 points on a TV and on Android
TV, where `px` scales, and 8 CSS px on the web), in styles, tokens and values from data; border
widths are points too; literal colours are limited to white, black and the document's palette; the
`vela:*` kit templates (`packages/skin/src/screen/kit.ts`) draw in the active skin's
look. `bun tools/skin.ts check <document.json>` checks a screen document as it checks a
skin.

## Renderer 20

Renderer 20 adds the document system for experiences ([experiences.md](experiences.md)).
A renderer-19 client refuses documents that need 20 on their version; renderer-19 plugin
documents draw unchanged.

- **Built-in page documents** (`packages/protocol/screen.ts`): the screen envelope with
  `owner: "vela"` and `experience`, bundled from
  `packages/protocol/fixtures/experiences/<experience>/<page>.json` (the generated
  `index.ts`), addressed as `vela:<experience>/<page>` and opened as the screen
  `vela.<experience>` (`packages/skin/src/resolve/builtin.ts`, `builtinDocument`). Their
  `vela.*` sources take any arguments; in a plugin document a `vela.*` source takes only
  `{context.*}` holes, and `vela.*` local actions (`press: {action: "plugin", args: {name:
  "vela.like"}}`) are refused (`velaUseProblems`). The published names are
  `packages/protocol/vela-sources.ts`.
- **Skin overrides** (`SkinDocument.experiences.<id>`: `pages`, `templates`, `parts`,
  `shell`), merged over the built-in pages at resolve time
  (`resolveScreenDocument(doc, viewport, locale, ui, { skin })`). An absent page keeps
  Vela's; a page drawn whole keeps the page's sources; a page may be a tree or
  `{tree, forms, platforms, loading, failure}`. The skin's tokens and strings are there for
  its overrides.
- **Platform and form variants:** `platforms: {ios, android, web, desktop, tv}` on a node is a
  style overlay applied last (after `small`, `wide`, breakpoints, `tv` and `fold`); on a page
  (`platforms`, `forms: {small, wide, tv, fold}`) it is a whole-tree replacement, a platform's
  winning over a form's. The form is `tv` on a TV, `fold` on a foldable held partly open
  (falling back to its width's form), `wide` in a window with room for two panes
  (`window-layout.ts`: 980 px, or a landscape 840 px), else `small`. A node's `fold` style
  applies on a partly open foldable.
- **Rich blocks** (`packages/protocol/rich-blocks.ts` lists each one's props, parts and part
  templates): `{type, props, parts, partTemplates, fallback}`. Part styles merge in the order
  the document's `parts`, the node's `parts`, the skin's `experiences.<id>.parts`; a part style
  is a style or layers (`style`, `small`, `wide`, `tv`, `fold`, `platforms`, `hover`,
  `focus`, `active`). A document template named after a part (`queue.row`) is its template;
  the node's `partTemplates` beat it and a skin override template of that name beats both. A
  part template reads `{item.*}`, the block's state as `{part.*}`, and `{$index}`. `player`
  with `channel` is the renderer-19 preview, without it the rich player; `visualizer` takes
  `mode` (`background` or `fullscreen`) and `sceneId`.
- **`fallback` on every block node:** drawn when the client does not know the block, when a
  rich block lacks a required prop, or (by the block) when it cannot run here.
- **Env keys:** `env.canVisualize` (a device capability; false where absent),
  `env.platform`, `env.form`, `env.fold` (`book`, `tabletop` or empty).
- **Slots:** a built-in page places a published slot with
  `{type: "slot", slot: "plugin:<slot id>", context: {…}, limit}`; plugins fill it with slot
  surfaces (presentation `slot` and `slot: <id>`). `homeRow`, `titlePanel`, `playerOverlay`
  (by anchor) and `toast` stay as aliases of `home.rows`, `title.panel`,
  `player.overlay.<anchor>` and `toast`. The list is `packages/protocol/experiences.ts`
  `SLOTS`.

The JSON Schema of every document, `packages/protocol/schemas/vela-document.v1.json`
(formerly `plugin-screen.v1.json`), is generated by `bun tools/screen-schema.ts write`. Its
root is the page document (`kind: "screen"`, which Ether validates plugin documents
against); skins are `#/$defs/SkinDocument`. Published lists are data, each a
`{const: [...]}`: `$defs.Slots`, `$defs.RichBlocks`, `$defs.VelaSources`,
`$defs.VelaActions` and `$defs.Renderer`. Its digest is recorded beside `RENDERER_VERSION`
(`VELA_DOCUMENT_SCHEMA_DIGEST`, alias `SCREEN_SCHEMA_DIGEST`), and
`bun tools/screen-schema.ts check` (run by the tests) fails when the types, the schema, the
built-in index or a fixture drift.

## Rows (Recommendations)

A row in `home.rows`, `library.rows` or `detail.related` binds these keys beside `row.id`,
`row.name`, `row.presentation` (`ranked` for a Top 10) and the others in
`packages/skin/src/vocabulary.ts`. They follow Ether's Recommendations pages; each is `''` (or
`false`) when the server did not set it:

| Key | Values |
| --- | --- |
| `row.layout` | `standard`, `hero`, `wide`, `tiles`, `tracks`. Any value Vela does not know reads `standard`. On Home, hero rows feed the hero band first; on a library page a `hero` row draws large art in place. A `tracks` row holds track leaves (each with a duration and an album or artist parent) and draws as a track list. |
| `row.card` | `poster`, `landscape`, `square`, `round`, or `''` (the skin's choice). On library pages the server falls back to the library's card. Unknown values read `''`. |
| `row.role` | The items' media role (`movie`, `show`, `episode`, `album`, `artist`, `track`, `playlist`, `audiobook`, `book`, `collection`, `channel`, …). Information only: an unknown role draws as a standard shelf. |
| `row.personal` | `true` when the titles differ per viewer. |
| `row.library` | The library of a one-row-per-library row. |
| `row.experience` | `watch`, `listen`, `read`, `gallery` or `live`. |

The retired wire field `style` is not read. A plugin's surface row (a `homeRow` surface) sits in
the list where the page put it, with no items; the renderer draws the surface's document in its
place on Home and library pages (or nothing when this client may not draw it).

Rows with a See all destination always end with a focusable See all card on every client. Row
headings are pointer conveniences only and never enter keyboard, D-pad or remote focus order.
Skins style the end card by overriding the inherited `velaSeeAll` template; its style, viewport
variants, hover and focus layers are retained while Vela supplies the row-opening behavior and
accessible label. It should use `align-self: stretch` so it matches the shelf's card height.

## Music visualizer

Now Playing and its visualizer are host widgets drawn in the skin's `ui` look; they are not
document nodes. The visualizer's style hooks are the parts `visualizer.scenePicker`,
`visualizer.sceneChip` (every choice in the picker, Off included), `visualizer.sceneChipActive`
and `visualizer.caption` (`apps/vela/src/visualizer/parts.ts`). The host supplies them through
`VisualizerPartsContext`; skin documents cannot set them yet.

Whether the visualizer runs is the viewer's choice, kept per profile on the device beside the
scene (`visualizer.enabled.<profile>` and `visualizer.scene.<profile>` preferences, where
`<profile>` is `["server","viewer"]`). The viewer turns it off with the picker's first choice,
Off, or with the Visualizer switch at the top of Now Playing's Sound tab; choosing any scene
turns it on again. A skin cannot turn it on or off. Off, Now Playing draws the artwork wash
(`$ui.page` over the item's accent and blurred cover) and no stage is created: no renderer, GPU
work or audio analysis, and no full-screen entry. Reduce Motion holds a still frame while it is
on.
