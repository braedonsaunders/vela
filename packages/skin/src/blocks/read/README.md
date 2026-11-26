# Read rich blocks

Read documents place and style the components used for book detail pages, series
pages and the full-screen reader. The registry in
[`packages/protocol/rich-blocks.ts`](../../../../protocol/rich-blocks.ts)
defines props, parts and templates for validation and schema generation.

Each block takes an `item` from `vela.title`. `seriesHero` and `bookSeriesList`
also take `items` from `vela.children`. For a book’s series shelf, use
`{src.title.seriesId}` as the children source’s id. Use `limit: 1000` to match the existing series grid’s
initial read. A title’s card carries its
reading fraction and label. `vela.readingProgress` also exposes them alongside
its locator for document bindings.

| Block | Named parts | Rendering |
| --- | --- | --- |
| `reader` | `reader.page`, `reader.toolbar`, `reader.title`, `reader.progress`, `reader.button`, `reader.panel` | Page surround, both toolbars, the toolbar title, position labels, toolbar buttons and side panels. The engine owns the book’s type and page layout. |
| `bookHero` | `bookHero.title`, `bookHero.author`, `bookHero.series`, `bookHero.progress` | Title, author and series links, metadata and reading progress. The cover and action have optional templates. |
| `bookCover` | `bookCover.root` | Bound cover artwork and its wrapper. |
| `bookReadAction` | `bookReadAction.button`, `bookReadAction.message` | Read, Continue reading or Read again. On TV, the existing explanation takes the button’s place. |
| `bookSummary` | `bookSummary.root` | Serif synopsis with the book or series spacing. |
| `bookFacts` | `bookFacts.root` | Book metadata labels and values. |
| `seriesHero` | `seriesHero.title`, `seriesHero.author` | Cover fan, series metadata and an action for the next title. |
| `bookSeriesList` | `bookSeriesList.root` | Related books on book pages and the ordered book grid on a series page. Each tile is one focus target. |

`bookHero.cover` and `bookHero.action` templates receive the book as `{item}`.
By default the hero renders `bookCover` and `bookReadAction` into those slots.
Set the hero’s `cover` or `action` prop to `false` to place that piece elsewhere.

The app supplies `ReaderHostContext` for one reader session. It owns the reader
engine, the short-lived grant and resume position, settings persistence, progress
writes and closing the route. Reader chrome continues to own Back, key handling,
page turns and panel focus. A reader node without a session displays its fallback.

Audiobook parts and chapters use Listen’s `spokenItems` block.
