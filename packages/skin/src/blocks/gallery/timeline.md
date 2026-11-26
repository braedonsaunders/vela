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
