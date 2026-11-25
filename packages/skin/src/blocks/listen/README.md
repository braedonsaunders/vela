# Listen rich blocks

The music app's interactive parts as rich document blocks (docs/experiences.md: Blocks). Each block
is a native engine (moved here unchanged from `widgets/music`, deleted at the Listen hard cut)
that a document places, feeds and styles. A document never replaces an engine, its focus
management or its timing.

The registry — every block's props, parts, part templates and TV rules — is
[`packages/protocol/rich-blocks.ts`](../../../../protocol/rich-blocks.ts). It is pure data: the
resolver validates against it and the schema tool emits it as `$defs.RichBlocks`. Add to it
additively within a renderer version.

## Contract for a block

### The node

```jsonc
{ "type": "trackTable",
  "props": { "tracks": "{src.album.items}", "covers": "true", "sourceId": "{param.id}" },
  "parts": { "trackTable.activeRow": { "style": { "color": "$ui.accent" } } },
  "partTemplates": { "trackTable.row": { "type": "box", "children": [ … "{item.name}" … ] } },
  "fallback": { … } }
```

- **props** are templates. A prop that is a single hole (`"{src.album.items}"`) reads the raw value
  (a list, a record); anything else reads as text. Booleans are `"true"`/`"false"`. The registry
  gives each prop's type and default; the block applies defaults (`props.ts` `propDefault`).
- **parts** style named parts, `<block>.<part>`, as a Style or as layers
  `{ style, hover, focus, active }` (plus the viewport and platform variants the resolver picks).
  Precedence, low to high: the document's `parts`, the node's `parts`, the skin's
  `experiences.<id>.parts`. The resolver merges them; a block only ever reads `node.parts`.
- **partTemplates** replace the drawing inside a part where the registry lists the part in
  `templates`. A document template named after the part (`templates: { "queue.row": … }`) applies
  to every such block in the document. A template reads `{item.*}` (the row's data), `{part.*}`
  (the state the block hands it, listed in `templateScope`) and `{$index}`. The block keeps the
  row's press, menu, focus and drag: the template only draws.
- **fallback** draws when the client does not know the block or a required prop is missing.

### The runtime

The resolver emits `{ kind: 'rich', block, props, parts, templates, fallback }`; render.tsx hands
it to `RichBlock` (`rich.tsx`), which:

1. reads records through the block's own tracked reader (`useScopedReads`), so a pushed `item:`
   record redraws only that block;
2. fills the parts once per draw (`part-style.ts` `fillParts`) and publishes them, with the part
   templates, to the engine (`look.tsx` `ListenLookProvider`);
3. reads the props (`readProps`) and draws the engine.

An engine asks for a part with `usePart(name | names[], state)` (box and text styles, layered over
its own look) or `usePartStyler(names)` (a function of state, for a control whose style depends on
hover and focus). With no block around it (the music app as drawn today) there are no parts and no
templates, so the engine draws exactly as before.

### Data

- Lists come from G1's `vela.*` list sources, which all answer `{ items: [{$record}], more,
  total? }`; `item:` records hold core's `Card` (`props.ts` `listOf`, `asCard`, `tableTracks`).
  A playlist's `vela.playlist {id}` also answers `entryIds`, parallel to `items`.
- Live playback state is read from the audio store directly (`useVelaState(s => s.audio)`:
  `queue, phase, positionSeconds, durationSeconds, rate, volume, muted, chapters, sleep, sound`)
  and driven through `store.audio` (`toggle, seek, skip, next, previous, toggleShuffle,
  cycleRepeat, setVolume, toggleMute, setRate, setSleep, setSound, jump, remove, move,
  clearQueued`). The `queue:current` and `nowPlaying:current` records carry the same state for
  documents' own text nodes.
- Navigation, playing a list, the card menu, likes and the playlist drawer go through the
  `MusicApp` context (`app.tsx`) the experience host provides, as today. Document nodes use G1's
  local actions (`vela.like`, `vela.play`, …), which call the same store methods.
- Shell state (the queue or Sound panel open, the rail collapsed) is the document's state flags:
  the bar toggles `queueFlag` / `soundFlag` (one side panel at a time), and the shell document
  shows the `queue` or `eq` block while its flag is set.

### Blocks

| Block | Engine | Status |
| --- | --- | --- |
| `trackTable` | `track-table.tsx` (`TrackList`) | Block, parts, row template, multi-disc, web drag reorder in playlists, progressive rows |
| `bar` | `bar.tsx` (`NowPlayingBar`, `BarPanelView`) | Block and parts |
| `queue` | `queue.tsx` (`QueuePanel`) | Block, parts, row template, web drag to move upcoming rows |
| `lyrics` | `lyrics.tsx` (`LyricsPanel`) | Block, parts, word timing, translation |
| `rail` | `rail.tsx` (`Sidebar`, `RailIcons`, `RailChips`) | Block: expanded, collapsed, auto, embedded, TV icons, phone chips |
| `nowPlaying` | `widgets/media/player.tsx` (`NowPlaying`) | Block, parts, `nowPlaying.background` template, visualizer button and switch |
| `player` | `widgets/media/player.tsx` (`MiniPlayer`) | Block (the mini player), parts; the quality and audio menus are not in today's engine |
| `eq` | `blocks/sound` (`SoundBlock`, `EqBlock`) | Block: the Sound panel or the bands |
| `recap`, `playlistImport`, `duplicates` | `blocks/recap`, `blocks/import`, `blocks/duplicates` | Blocks (libraryId; period and name as document state) |
| `visualizer` | `visualizer.tsx` over `apps/vela/src/visualizer` | Block; the stage comes from the app's host |

### Page-level blocks

The pieces of today's music pages, so page documents can arrange them (`page-blocks.tsx` over
`pages.tsx`, `parts.tsx`, `spoken.tsx`, `search.tsx`, `albums.tsx`; each page is composed of exactly
these components, so the same paddings around them reproduce it):

| Block | Draws |
| --- | --- |
| `wash`, `collectionHeader` (+ `collectionHeader.cover`, `.byline` templates), `cover`, `actionBar`, `byline` | A collection page's top |
| `musicShelf`, `tileGrid` | Shelves and paged grids of music tiles over list sources |
| `quickTiles`, `homeShelves`, `genres` | Music Home |
| `artistHero`, `artistLiked`, `discography` | The artist page |
| `continueListening`, `spokenCredits`, `spokenFacts`, `spokenProgress`, `spokenPlay`, `spokenItems`, `spokenAbout` | Spoken word's Home and title pages (the kind is picked from the item) |
| `searchField`, `recentSearches`, `searchResults` | Search (they share core's search query) |
| `listenSearch`, `spokenHome`, `spokenTitle`, `albumsGrid` | Whole pages, kept while documents replace them |

### Hosting a background (the visualizer)

`nowPlaying` publishes a `nowPlaying.background` part template, drawn behind the artwork stage
and taking no focus, with `{part.playing}` and `{part.accent}` in scope. A document places the
visualizer there:

```jsonc
{ "type": "nowPlaying", "props": { "closeFlag": "nowPlaying", "visualizerFlag": "visualizer" },
  "partTemplates": { "nowPlaying.background": { "type": "visualizer", "mode": "background" } } }
```

The visualizer block (`visualizer.tsx`) re-hosts the shipped visualizer: the node's fields `mode`
(`background | fullscreen`, required) and `sceneId`; its `fallback` where no stage can draw
(`env.canVisualize` false, or no host); parts `visualizer.scenePicker`, `visualizer.sceneChip`,
`visualizer.sceneChipActive`, `visualizer.caption`. The app hands the stage in through
`VisualizerHostContext` (apps/vela/src/visualizer/host.tsx, provided at the app root), so the
skin package never imports the app. The visualizer Off switch (Now Playing's Sound tab) and the
Sound header button stay in `nowPlaying`; with `visualizerFlag`, the header's visualizer button
sets that flag and the page shows a full-screen visualizer block while it is set (hide the
background one meanwhile, `when: state.visualizer not`, so only one stage runs).

## TV and performance rules

- The TV floor is a budget Google TV stick (the `tools/perf` `vela-tv-floor` profile); Apple TV 4K
  is the high end.
- A block owns its focus: rows are single focus targets, groups are TV focus guides that remember
  their last child (`FocusGroup`), and nothing inside a row takes focus.
- Live playback position redraws only what shows it (the bar's times and scrubber, the active
  lyric line), never the lists. A queue redraws when the queue changes.
- Long lists draw their first 60 rows with the page and 120 more per frame (`nextRowCount`).
- Parts are styles only: no endless motion, no blur, no images beyond the engine's own.
- Part templates count against the document's node budget per drawn row.
- A block never starts playback on its own: only a viewer's press does.
