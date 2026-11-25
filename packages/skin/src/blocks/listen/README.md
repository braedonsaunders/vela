# Listen rich blocks

The music app's interactive parts as rich document blocks (docs/experiences.md: Blocks). Each block
is a native engine (moved here unchanged from `widgets/music`, which is deleted at Listen parity)
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
| `queue` | `queue.tsx` (`QueuePanel`) | Engine moved; block next |
| `lyrics` | `lyrics.tsx` (`LyricsPanel`) | Engine moved; block next (word timing, translation) |
| `rail` | `rail.tsx` (`Sidebar`, `NavItem`) | Engine moved; block next |
| `nowPlaying`, `player` | `widgets/media/player.tsx` (`NowPlaying`, `MiniPlayer`) | Next |
| `eq` | `blocks/sound` (`SoundBlock`, `EqBlock`) | Next |
| `recap`, `playlistImport`, `duplicates` | `blocks/recap`, `blocks/import`, `blocks/duplicates` | Next |
| `visualizer` | `apps/vela/src/visualizer`, `packages/visualizer` | The visualizer lead's, hosted by `nowPlaying`'s `nowPlaying.background` template |

### Hosting a background (the visualizer)

`nowPlaying` publishes a `nowPlaying.background` part template, drawn behind the artwork stage
and taking no focus, with `{part.playing}` and `{part.accent}` in scope. A document places the
visualizer there:

```jsonc
{ "type": "nowPlaying", "partTemplates": { "nowPlaying.background":
  { "type": "visualizer", "mode": "background", "when": [{ "if": "env.canVisualize" }] } } }
```

The visualizer block's own contract (agreed with its lead): props `mode`
(`background | fullscreen`, required) and `sceneId`; a generic fallback; `env.canVisualize`;
the `vela.setVisualizerScene` action; parts `visualizer.scenePicker`, `visualizer.sceneChip`,
`visualizer.sceneChipActive`, `visualizer.caption`. The visualizer Off switch (the Sound panel)
and the Sound header button stay in `nowPlaying`.

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
