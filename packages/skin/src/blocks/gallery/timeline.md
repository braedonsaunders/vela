# Gallery timeline

The `timeline` block reads a `ListValue` and requests the next page via
`vela.more` when the end enters view. Give it a bounded region and let it own
vertical scrolling. Only the visible rows and their overscan are mounted.

| Part | Styles |
| --- | --- |
| `timeline.month` | Month or Undated heading |
| `timeline.day` | Day heading in a dense month |
| `timeline.tile` | Square photo tile |

The block owns the row heights, tile size and focus targets. Select opens the
photo. Web arrow keys move among tiles and skip headings.

The timeline page reserves its `children` slot above the scroller for the
library header and tabs. The grid aligns with the shared library gutter. Dense
day subheadings show the full date in the active locale, including the year.

Album and person pages use `timeline` with `groupByDate: false` so the photo
grid follows the source's order. The `galleryDirectory` block reuses that
bounded scroller and draws an album cover or a person portrait, name and count.
Its parts are `galleryDirectory.tile`, `galleryDirectory.name` and
`galleryDirectory.count`. Select opens the corresponding page in the Gallery
experience.
