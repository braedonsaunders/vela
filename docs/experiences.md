# Experiences, one renderer, author tools (design, for approval)

Status: approved by the owner on 2026-11-24 (decisions below). Sports finishes first, then the
shared groundwork and Listen. It
extends [plugin screens](plugin-screens.md), which is approved and being built. This document is
being agreed with Ether's plugin-screens lead (thr_mmzvx5afhi) and music lead (thr_9ahkvmww6a).
The library field change (`Library.experience`) is landing separately as a clean cut
(thr_ngysnpwrwh).

## Summary for the owner

The aim is a skin and page system clearly ahead of other media players. Every page in Vela —
Vela's own, a plugin's, an overlay — becomes a document drawn by one renderer from one set of
blocks. Skins can restyle and rearrange anything, including the music app, and plugins can fill
named slots inside any experience.

1. **Named experiences.** A library opens as `watch`, `listen`, `read`, `gallery` or `live`. The
   set is open: an id Vela does not know opens as `watch`. An experience is a shell plus a set of
   page documents, and each one is native and best on its platform. On desktop, `listen` has a
   sidebar, a now-playing bar and a queue. On a phone it has a mini player and a sheet. On TV it
   has a focus layout.
2. **One renderer for everything.** Vela's default pages become built-in documents in the same
   language as skins and plugin screens. They are made of:
   - **simple blocks:** shelves, grids, track tables, headers, rails, bars, tabs, tables;
   - **rich native blocks:** player, reader, lyrics, guide, multiview, EQ, queue, photo viewer.

   Rich blocks keep their engines native, so playback, reading and the guide never become
   interpreted. They expose named parts that a document styles and arranges.
3. **Data from the same place for every page.** Pages read named sources with the
   records-and-revisions model of plugin screens. Plugin pages get their data from Ether. Vela's
   own pages get theirs from core, through the server adapter in use, so the built-in documents
   work the same on Ether, Jellyfin and Plex.
4. **Skins override, plugins fill slots.** A skin may replace any built-in page, or only named
   templates and parts inside one. Plugins can add screens, and can fill published slots inside
   experiences: an album-page panel, a Home row, a player overlay, a reader side panel.
5. **Author tools.** A live preview shows phone, tablet and TV frames side by side, reloads on
   save and runs against mock data or a real server. A validator, a versioned schema and
   measured TV performance budgets make it safe to publish skins and plugin documents.

The migration order is the one the owner asked for:

1. Sports (being built)
2. Listen
3. Read
4. Gallery
5. Watch pages

Each step reaches parity with today's pages before the code it replaces is deleted.

## Today

| Area | Today |
| --- | --- |
| Watch pages (home, library, title, person, collection, search, live home) | Already skin documents (`routes.*`) over a fixed vocabulary of app data (`vocabulary.ts`), with compiled widgets for the hard parts |
| Listen (the music app) | Hand-written React: `widgets/music/*` (shell, pages, bar, queue, lyrics, tracks), `widgets/media/player.tsx`. It follows the skin through `ui` tokens but cannot be rearranged. |
| Read | `widgets/media/reader*` (engine, layout, opening) and `app/read/[id].tsx` |
| Gallery | No dedicated experience; photos open as ordinary library pages |
| Live | The guide and multiview are native widgets and routes; Sports is moving to plugin documents |
| Plugin screens and surfaces | Approved, and being built on `plugin-screens/main` |

## 1. Named experiences

- `Library.experience` is an id: `watch | listen | read | gallery | live | (string)`. The server
  chooses it. A client that does not know an id draws `watch`. With no id, a client chooses by
  media class.
- An **experience** is defined by:
  - a **shell document** per form factor, which can show the active section's navigation, a
    persistent bar, a sidebar, and so on;
  - a set of **page documents**, for example `listen/home`, `listen/album`, `listen/artist`,
    `listen/playlist`, `listen/liked`, `listen/nowPlaying`, `listen/queue`, `listen/search`;
  - the **rich blocks** it needs;
  - the **slots** it publishes to plugins.
- **Built-in experiences** are documents bundled with Vela. Their ids are reserved names. A
  plugin library picks one of them by id. A plugin cannot define a new experience in version 1;
  it adds screens instead. A plugin-defined experience is an open question for later.
- **Platform best:** a document may hold platform variants beyond the viewport classes (`small`,
  `wide`, `tv`):
  - `platforms: { ios, android, web, desktop, tv }`, each a style overlay or a whole replacement
    tree;
  - shells differ by form factor by design: on desktop, `listen` has a sidebar, a bar and a
    queue panel; on a phone, a mini player and a Now Playing sheet; on TV, a focus layout.

## 2. One renderer for everything

### Documents

Two document kinds share one resolver, one renderer, one `RENDERER_VERSION` and one schema:

- **Skin documents:** tokens, `ui`, fonts, motion, slots, and now `experiences` overrides (below).
- **Page documents:** a plugin's screens and surfaces, and Vela's built-in pages. Built-in pages
  carry `owner: "vela"` and `experience`.

### Blocks

| Simple blocks (documents arrange them freely) | Rich native blocks (native engine, styleable named parts) |
| --- | --- |
| `sections`, `shelf`, `grid`, `tabs`, `table`, `marquee`, `titleCard`, `paramInput` (plugin screens) | `player`: playback surface, transport, scrubber, quality and audio menus |
| `trackTable`: virtualised rows (number, title, artist, album, duration, like, menu); multi-disc; drag-reorder in playlists | `nowPlaying`: artwork stage with ambient tint, transport |
| `header`: art, title, facts and actions band, tinted from artwork | `queue`: now playing, next in queue, next from the source; drag reorder |
| `rail`: a vertical navigation list with collapse (Your Library) | `lyrics`: synced lines that follow playback, tap to seek |
| `bar`: a persistent bottom or top bar host (the now-playing bar) | `reader`: book and comic engine, paging, progress |
| `segmented`, `list`, `hero` (today's widgets, generalised) | `guide`: Live TV grid |
| | `multiview`: tiles and focus |
| | `eq`: equaliser bands |
| | `photoViewer`: zoom, swipe, slideshow, EXIF panel |
| | `timeline`: date-scrubbed grid for galleries |

- **Parts:** a rich block publishes named parts, such as `player.scrubber`, `player.transport`,
  `queue.row`, `lyrics.line`, `lyrics.activeLine`, `reader.toolbar`, `trackTable.row` and
  `trackTable.activeRow`.
  - A document styles them: `parts: { "lyrics.activeLine": Style }`.
  - It can replace a part's template where the block allows it. For example, `queue.row` is a
    node template that reads `{item.*}`.
  - It cannot replace engines, focus management or timing.
- Every block keeps the plugin-screen rules: tokens only, bounded data, fixed actions, and TV focus
  owned by the block.

### Sources for Vela's own pages

Built-in documents read sources, as plugin documents do. Core answers them locally through the
active server adapter (`packages/core/src/screens/local.ts`; the list, arguments and value shapes are
`packages/protocol/vela-sources.ts`). "Yes" means the source answers; "no" means it answers
`unsupported`, so the document hides that part. Ether's music parts answer only where the server
advertises them (in parentheses). The Jellyfin and Plex columns are proven by routed-fetch tests
(`packages/core/test/local-sources-native.test.ts`) and match what today's music app shows there.

| Source (`from`) | Answers with | Ether | Jellyfin / Emby | Plex |
| --- | --- | --- | --- | --- |
| `vela.title` (`id`) | The title: its `item:` record and what a detail read adds | yes | yes | yes |
| `vela.children` (`id`, `role`) | Children, paged | yes | yes | yes |
| `vela.rows` (`placement`, `titleId`, `libraryId`, `tab`) | Rows: Home's, a title's related ones, a library's (its home tab by default) | yes | yes | yes |
| `vela.library` (`id`, sort, filters, `tab`, `limit`) | The library listing, paged | yes | yes | yes |
| `vela.favorites` (`role`, `class`, `library`) | Liked items | yes (role lists, else the Favorites playlist) | yes, with `library`: the library's favourite filter on the role's tab | no (Plex keeps no favourites) |
| `vela.playlists`, `vela.playlist` (`id`) | The viewer's playlists; one playlist and its entries | yes (playlists) | no | no |
| `vela.recent` | Recent play contexts | yes (play contexts) | no | no |
| `vela.search` (`q`, `kind`, `library`) | The audio app's search: the list, the top match, the list by role | yes | yes | yes |
| `vela.musicHome` (`library`) | Music Home: quick tiles, Vela's own recent shelves, the library's rows | yes | yes (rows and search only: no tiles without likes, playlists or recent) | yes (as Jellyfin) |
| `vela.libraryInfo` (`id`), `vela.viewer` | What a library holds and the music features offered; the viewer | yes | yes | yes |
| `vela.queue`, `vela.nowPlaying` | The live queue record; the live record, updated about once a second while bound | yes (on the device) | yes | yes |
| `vela.lyrics` (`id`, `translate`) | Lyrics, with word timing, translation and romanisation when sent | yes (lyrics) | no | no |
| `vela.guide` (`day`) | A day of the Live TV guide as `channel:` records | yes (Live TV) | yes (a tuner) | yes (a DVR) |
| `vela.readingProgress` (`id`) | Reading progress | yes (reading) | yes (books) | no |
| `vela.recap` (`period`, `at`, `library`) | A listening recap (Rewind) | yes (history recap) | no | no |
| `vela.duplicates` (`libraryId`), `vela.recording` (`id`) | Duplicate recordings; a recording's releases | yes (duplicates) | no | no |
| `vela.import` | The playlist import in progress (`import:` record) | yes (playlist import) | no (the record stays idle; the action refuses) | no |
| `vela.visualizer` | The viewer's visualizer setting on this device | yes (on the device) | yes | yes |

Actions answer the same way: `vela.play`, `vela.playNext`, `vela.addToQueue` and `vela.startRadio`
play through the audio store on every server (radio adds the server's continuation where it has
one). `vela.like` is the server's favourite: Ether and Jellyfin keep it, Plex refuses it.
`vela.lyrics` `translate` is not sent yet: no adapter and no wire route takes a language, so lyrics
come in the language the server has.

These are the same `{$record}` model with the same revisions: `item:`, `channel:`, plus local
`queue:` and `nowPlaying:` records that never leave the device. The source list is versioned with
`RENDERER_VERSION`. A source the active adapter cannot answer, such as lyrics on a server without
them, answers `errors.<id> = {code: "unsupported"}`, and the document hides that part. Vela's
fixed vocabulary for skins (`card.*`, `hero.*`, `detail.*`) stays valid. It is a projection over
these sources, so existing skin documents keep working unchanged.

### Skins override, plugins fill slots

- **Skin overrides:** a skin document gains
  `experiences: { listen: { pages: { album: Node }, templates: { "trackTable.row": Node }, parts: { … }, shell: { wide: Node } } }`.
  - The resolver merges a skin's overrides over the built-in documents, as it already merges
    routes over the Vela base. An absent page keeps Vela's.
  - So Broadcast can lay out the music app's album page differently, and Mochi can give the
    queue rows its own template.
- **Slots:** built-in documents declare plugin slots with the existing slot node:
  `{ "type": "slot", "slot": "plugin:listen.album.panel" }`. The published slot list is versioned:

  | Slot | Where |
  | --- | --- |
  | `home.rows` | Home |
  | `title.panel` | The title page, per kind |
  | `listen.album.panel` | The album page |
  | `listen.artist.panel` | The artist page |
  | `listen.nowPlaying.panel` | Now Playing |
  | `read.sidePanel` | The reader |
  | `gallery.photo.panel` | The photo viewer |
  | `player.overlay.*` | The three player-overlay anchors |
  | `toast` | The alert stack |

  A plugin fills a slot with a surface (plugin screens § Surfaces; presentation `slot`, with the
  slot id). The approved `homeRow`, `titlePanel` and `playerOverlay` kinds become slot surfaces
  with the same rules. Slots carry the same bounds as surfaces: box, focus, clipping, at most N
  per slot, and an owner-set order.

### The language as built (renderer 20)

[skin-schema.md § Renderer 20](skin-schema.md#renderer-20) is the reference. In short:

- Built-in pages: `owner: "vela"`, `experience`; address `vela:<experience>/<page>`, screen
  `vela.<experience>`; bundled from `packages/protocol/fixtures/experiences/<experience>/`.
  A shell is the page `shell`, with `forms: {small, wide, tv, fold}`.
- Skin overrides: `experiences.<id>.{pages, templates, parts, shell}`, merged at resolve time.
- Variants: `platforms` (node style overlay; page whole tree) and `forms` (page whole tree).
- Rich blocks: `{type, props, parts, partTemplates, fallback}` against
  `packages/protocol/rich-blocks.ts`; `fallback` is generic on every block.
- Slots: `{type: "slot", slot: "plugin:<id>", context}` in pages; surfaces with presentation
  `slot` and `slot: <id>`; the list is `$defs.Slots`. Slot contexts: a title's slots give
  `title` (`item:`) and `titleKind` (picks by `when.titleKind`, never sent); the player
  overlays give the player context.

## 3. Author tools

- **Live preview:**
  - `bun tools/skin.ts serve <document>` watches a skin or page document and serves it to the
    Vela web app's preview mode (`/vela/?preview=<url>`).
  - The preview shows phone, tablet, desktop and TV frames side by side, drawn by the real
    renderer.
  - It runs against the mock server's fixtures or a real server (same-origin through a proxy).
    It reloads on save, keeps the scroll and focus position, and overlays validator findings on
    the nodes they concern.
  - Ether Studio's preview (Ether E6) embeds the same mode.
- **Validator:**
  - `bun tools/skin.ts check` covers skins and page documents (built in, plugin, skin
    overrides): schema, limits, literal colours, tokens, icons, actions, slots, and per-page
    budgets.
  - It produces a JSON report for Studio and CI, plus readable output.
  - Ether runs the same checks at install against the vendored schema.
- **Versioned schema:** `vela-document.v1.json` (formerly `plugin-screen.v1.json`; renderer 20) is generated from
  the TypeScript types, with a digest beside `RENDERER_VERSION`. Changes within version 1 are
  additive; anything else is a new major version. Docs are generated from the schema's comments.
- **TV performance budgets:**
  - The static budgets that exist today: nodes, nodes per item, images per item, endless motion,
    blurs.
  - New measured budgets from a perf harness on the reference Android TV (an emulator on
    gpu-workstation, matched to a low-end Google TV device):
    - first frame at most 400 ms;
    - focus move at most 16 ms for p95;
    - a live record push re-renders only its readers, at most 2 frames.
  - The validator warns from the static budgets. The harness gates built-in documents in CI and
    reports for plugin documents in Studio.

## 4. Migration order

Each step lands behind a development flag, reaches parity under the approved rule (at most 1% of
pixels differ, nothing moves more than 2 px, every difference reviewed) on web, phone and TV, and
then deletes the code it replaces in the same release. There are no long-lived dual paths.

1. **Sports** (in progress). It proves the renderer, sources, records, live updates, surfaces,
   parity tooling and the hard cut.
2. **Listen.** The music app becomes the `listen` experience:
   - shell documents for desktop, phone and TV;
   - page documents for home, artist, album, playlist, liked, search, Now Playing and queue;
   - the native blocks `player`, `nowPlaying`, `queue`, `lyrics`, `trackTable`, `eq`, `rail` and
     `bar`;
   - slots for album, artist and Now Playing panels.

   Data comes from `vela.*` sources over the music API that thr_9ahkvmww6a's plan adds to
   Ether. The plan's Ether model work is unchanged; only the Vela drawing becomes documents.
   `widgets/music/*` is deleted at parity.
3. **Read.** Library pages and a `reader` block with styleable chrome. The reader engine stays
   native.
4. **Gallery.** A `timeline` grid, a `photoViewer` block, and albums and people pages.
5. **Watch pages.** Today's `routes.*` move onto `vela.*` sources and blocks. Skins keep their
   documents, because the vocabulary becomes a projection, and gain page overrides. This step is
   mostly convergence, since these pages are already documents.

Live, meaning the guide and multiview as rich blocks inside a `live` experience document, follows
Watch, or rides along with step 1's surfaces if the owner wants it earlier.

## 5. Ether's part (to agree)

- `Library.experience` ids, sent on every library, with plugins naming their library's
  experience in the manifest (the clean cut is in progress).
- Slot surfaces: `contributes.surfaces` with presentation `slot` and a slot id from the
  published list, served and capped like the other surfaces.
- The music API in thr_9ahkvmww6a's plan and the Mornye contract below back the `vela.*` sources
  for `listen`. The Jellyfin and Plex adapters answer the same sources where their servers can.
- Hosting and vendoring the one schema, with Studio preview through Vela's preview mode.

### Agreed with Ether's music lead (2026-11-24)

- **Experience ids:**
  - Already on Ether: `library.experience` on every library, the manifest
    `mediaKinds[].library.experience` with any id matching the slug pattern, defaults by media
    class, and `features.libraryExperiences.experiences`.
  - Ether accepts any id, so plugin-defined experiences later need no Ether change.
- **`live`:**
  - Live TV is its own section, not a library. Vela maps its Live TV section onto the `live`
    experience itself, so Ether changes nothing.
  - Only a kind that declares `live`, such as Sports, sends it on a library.
- **The music contract** (the agreed refinements in the Mornye plan) appears to documents as:

  | Kind | Names |
  | --- | --- |
  | Record fields | `media.loudness` (with `trim` and fades), `media.quality`, `media.recordingId`, `media.bpm` on `item:` records; `audioQuality` and `loudness` of the playing file on `nowPlaying:` |
  | Sources | `vela.lyrics` (`id`, `translate`; lines with word timing, translation and romanisation), `vela.recap` (`period`, `at`, `library`), `vela.duplicates` (`libraryId`), `vela.recording` (`id`) |
  | Local actions | Answered by core, with the same answer shape as plugin actions: `vela.playlistImport` (start, which polls its progress into a local `import:` record; then `vela.playlistImportSave`), `vela.duplicatePreference`, `vela.like`, `vela.playNext`, `vela.addToQueue`, `vela.startRadio`, and so on. A flow such as the import is a page document (`listen/import`) over the `import:` record, not a new mechanism. |

- **Artist extras** (bio, upcoming concerts) come as an `ether.music` surface in
  `listen.artist.panel` once slot surfaces exist. No music-specific fields go into core.
- **Sequencing:** the music section-B work happening now in `widgets/music` puts its engines in
  core stores and in the rich blocks. These engines are AutoMix and crossfade, EQ, levelling,
  word-timed lyrics, recap charts and the import flow. That way they carry over to documents
  unchanged, and only the drawing is replaced at Listen parity.
- **Jellyfin and Plex:** `unsupported` per part. Nothing changes on Ether.

### Agreed with Ether's plugin-screens lead (2026-11-24)

- **`Library.experience`:**
  - One field on every library, and `mediaKinds[].experience` in the manifest.
  - Ether validates it as an open-set slug (`^[a-z][a-z0-9-]{0,31}$`).
  - When a kind leaves it out, Ether infers it: video → `watch`; music, audiobook and podcast →
    `listen`; book → `read`; photo → `gallery`; a live tab → `live`. Existing plugins keep
    working unchanged.
  - The music lead owns the Library model side. The plugin-screens lead owns manifest validation
    and the inference table.
- **Slot surfaces:**
  - Presentation `slot` with a slot id. `homeRow`, `titlePanel` and `playerOverlay` stay as
    aliases for the Sports release, then fold in.
  - The slot list is data in the generated schema, in `$defs.Slots`:
    `[{id, context: [{name, ref?: event|channel|item}], cap: {perPlugin?, perSlot?}, version}]`.
    Ether reads it from the vendored schema, so a new slot is a re-vendor and needs no Ether
    code change.
  - Caps across plugins follow the owner's order (2 per `player.overlay.*` anchor). Caps per
    plugin come from the list.
- **`vela.*` sources:**
  - These are resolved by the client. Ether accepts `from: "vela.<name>"` only for names in the
    schema's published list, derives `deps` as usual, and skips them in data reads, with no value
    and no error.
  - Plugin documents in slots may read them, read-only.
  - In a **plugin** document, a `vela.*` source's arguments may only be `{context.*}` holes, so a
    plugin can never name another title or plugin. Ether enforces this at compile time.
    Built-in documents, which Ether never serves, take any arguments (route params).
- **The schema:** `vela-document.v1.json`, with its digest. Ether re-vendors it, and plugin
  documents are still validated as `kind: "screen"` against it.
- **Studio preview:** through Vela's preview mode (Ether E6). Drafts are served to the owner only,
  uncached, and re-validated on every save.
- Neither side builds past Sports before the owner approves.

## 6. Effort and risks

| Step | Vela effort (worker-days) |
| --- | --- |
| Shared groundwork: local `vela.*` sources and records, skin `experiences` overrides, platform variants, rich-block parts API, slot surfaces, preview mode, measured TV budgets | 12 to 16 |
| Listen | 15 to 20 |
| Read | 8 to 10 |
| Gallery | 10 to 12 |
| Watch | 8 to 12 |

Risks:

- **Rich-block boundaries:** too rigid and skins cannot restyle enough; too loose and engines
  leak into documents. The mitigation is a published parts list per block, grown as skins ask.
- **TV performance of interpreted pages:** the mitigations are measured budgets and per-record
  subscriptions, and native engines stay native.
- **Adapter parity:** Jellyfin and Plex lack some sources. The mitigation is the `unsupported`
  error, so documents degrade per part.
- **Scope:** the order keeps each step shippable on its own.

## Owner decisions

The owner approved this design on 2026-11-24:

1. **The unified model:**
   - experiences as built-in documents;
   - one renderer and schema for skins, built-in pages and plugin documents;
   - local `vela.*` sources;
   - skin overrides;
   - slot surfaces.
2. **The order:** Sports, Listen, Read, Gallery, Watch, then Live.
3. **Plugin-defined experiences** are allowed later. The contract stays open for them now:
   - `Library.experience` is an open slug;
   - built-in experience documents are addressed by id, as plugin screens are;
   - slots, sources and schema carry nothing that assumes Vela-only experiences.
4. **TV performance floor:**
   - The floor is a budget Google TV stick (onn 4K or Chromecast with Google TV class).
   - Apple TV 4K is the high end.
   - Measured budgets run on an Android TV emulator profile matched to that floor: 2 GB RAM, a
     quad-core A55-class CPU throttled to match, and 1080p output.

## Build plan: shared groundwork and Listen (approved 2026-11-24)

The owner approved this plan. Building starts once three things are done:

1. 0.2.63 is on production.
2. The native downloads are out.
3. The iPhone Duo branch is merged (thr_s8fgkaujwe: the music wide shell, Now Playing side by side by width, and the fold module).

Listen builds on those layouts. The rules are the same as for Sports:

- Parity comes first (at most 1% of pixels differ, nothing moves more than 2 px, and every remaining difference is reviewed).
- `widgets/music` is cut hard in the same release.
- Everything is built on an integration branch, `experiences/main`, kept green and rebased on main.

### Workers

| Worker | Provider | Scope | Owns |
| --- | --- | --- | --- |
| G1, local sources | Claude | `vela.*` sources and records answered by core through the active adapter (Ether, Jellyfin, Plex), with `unsupported` per part, plus local actions (`vela.like`, `playNext`, `addToQueue`, `startRadio`, `playlistImport` and save, `duplicatePreference`) | `packages/core/src/screens/local*`, adapter glue |
| G2, document system | Claude | Built-in documents (bundled; `owner: "vela"`), skin `experiences` overrides merged over them, `platforms` variants, the rich-block parts API, slot surfaces (`presentation: "slot"` and `$defs.Slots` in the generated schema, with the Sports aliases kept), and the schema renamed to `vela-document.v1.json` | `packages/skin/src/resolve*`, `screen/*`, `packages/protocol` |
| G3, author tools | Gemini (commits and pushes after every working step; the lead checks its branch at least hourly, and moves the scope to a Claude worker at the first stall) | `bun tools/skin.ts serve <document>` plus a preview mode for skins and built-in pages (the device frames: phone, tablet, desktop, TV), the validator's JSON report, and the TV perf harness (`tools/perf`) as a gate for built-in documents | `tools/*` |
| L1, Listen blocks | Claude | The rich blocks `player`, `nowPlaying`, `queue`, `lyrics`, `trackTable`, `eq`, `rail` and `bar`, wrapping today's engines and the section-B blocks (`blocks/sound`, `recap`, `import`, `duplicates`) unchanged, with their parts lists | `packages/skin/src/blocks/listen/*` |
| L2, Listen documents and parity | Claude | The `listen` shell documents (wide, phone, TV, fold) and the page documents (home, artist, album, playlist, liked, search, Now Playing, queue, import, Rewind, duplicates); legacy baselines first (web, phone, fold, Apple TV, Android TV), then parity, then the hard cut of `widgets/music` | `packages/protocol/fixtures/experiences/listen/*`, `tools/parity` |

### Order

1. **Contract:** G2 lands the document envelope changes and the slot list, and G1 lands the source list, before anything else builds on them.
2. **Legacy baselines:** L2 captures them from the merged iPhone Duo build, before any change.
3. **Blocks and documents:** L1 and L2 iterate against G1's sources.
4. **Author tools:** G3 runs in parallel throughout.
5. **Parity:** on every platform.
6. **Release:** the hard cut, then the lab gate and the production gate, as for Sports.

### Ether

Ether needs no new design:

- the slot list is vendored from the schema;
- the music API and the Mornye contract are already agreed;
- the music plugin's row purposes and layouts are already live.

It re-vendors the renamed schema.
